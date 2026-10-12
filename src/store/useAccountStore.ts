import { create } from 'zustand';
import { ReplaySession } from '../lib/orderSimulator/replay';
import { BTCUSD_RULES, createInstrumentRegistry, trainingProfile } from '../lib/orderSimulator/profiles';
import { projectAccountTotals, type AccountTotals } from '../lib/orderSimulator/accountProjection';
import type {
  AccountState,
  InstrumentRules,
  LatencyProfile,
  OrderId,
  PositionId,
  Side,
} from '../lib/orderSimulator/types';

/**
 * The one shared account.
 *
 * Every economic fact in the simulated terminal lives here, produced by the engine. There is exactly
 * one session per account, so two charts showing the same symbol are two *views* of one set of
 * positions — not two positions.
 *
 * The rule this store exists to enforce: **the only way to change economic state is to dispatch an
 * engine command.** There is no `setPnl`, no `addPosition`, no per-chart accumulator, and nothing
 * here can be nudged by a React selector, a chart primitive, a badge effect or a Strict Mode
 * remount. The selectors at the bottom are reads.
 */

export interface AccountStoreState {
  session: ReplaySession;
  state: AccountState;
  totals: AccountTotals;
  /** Bumped whenever the engine produces a new event, so views can re-render. */
  revision: number;
  notices: readonly string[];
  /**
   * Whether playback is currently stalled for want of market data.
   *
   * Kept as state rather than inferred from the notice log: the log is an append-only audit trail,
   * so the newest line in it is not necessarily what is happening now. A freeze that has been
   * resolved must stop being displayed.
   */
  frozen: boolean;
  frozenReason: string | null;

  // -- the only mutators: engine commands -----------------------------------
  openPosition: (input: {
    symbol: string;
    side: Side;
    type?: 'MARKET' | 'LIMIT' | 'STOP';
    size: number;
    level?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
  }) => { ok: boolean; orderId: OrderId | null; error: string | null };
  closePosition: (positionId: PositionId) => { ok: boolean; error: string | null };
  amendOrder: (orderId: OrderId, version: number, level: number) => { ok: boolean; error: string | null };
  cancelOrder: (orderId: OrderId) => { ok: boolean; error: string | null };
  /** Attach or replace protection on an open position. Opt-in; never applied by default. */
  protect: (positionId: PositionId, protection: { stopLoss?: number | null; takeProfit?: number | null }) => void;
  /** Advance the shared account with the replay playhead. */
  advanceTo: (targetMs: number, reason?: Parameters<ReplaySession['advanceTo']>[1]) => void;
  seekTo: (targetMs: number) => void;
  reset: (newSessionId?: string) => void;
  /** Re-read the engine. Safe to call any number of times: it never mutates economics. */
  refresh: () => void;
  registerTape: (symbol: string, quotes: Parameters<ReplaySession['replaceTape']>[1]) => void;
  configure: (options: { instruments?: InstrumentRules[]; profile?: LatencyProfile; sessionId?: string }) => void;
}

/** Default protections are OFF. An entry with no explicit protection gets none. */
export const DEFAULT_ATTACHMENTS_ENABLED = false;

function rulesFor(list: InstrumentRules[], symbol: string): InstrumentRules | null {
  try {
    return createInstrumentRegistry(list)(symbol);
  } catch {
    return null;
  }
}

export const useAccountStore = create<AccountStoreState>((set, get) => {
  let instruments: InstrumentRules[] = [BTCUSD_RULES];
  let profile: LatencyProfile = trainingProfile();
  let session = new ReplaySession({ sessionId: 'account-1', instruments, profile, startMs: 0 });

  const publish = () => {
    const state = session.state();
    set((prev) => ({ state, totals: projectAccountTotals(state), revision: prev.revision + 1 }));
  };

  return {
    session,
    state: session.state(),
    totals: projectAccountTotals(session.state()),
    revision: 0,
    notices: [],
    frozen: false,
    frozenReason: null,

    configure: ({ instruments: nextInstruments, profile: nextProfile, sessionId }) => {
      if (nextInstruments) instruments = nextInstruments;
      if (nextProfile) profile = nextProfile;
      session = new ReplaySession({ sessionId: sessionId ?? session.currentSessionId, instruments, profile, startMs: 0 });
      publish();
    },

    registerTape: (symbol, quotes) => {
      session.replaceTape(symbol, quotes);
      publish();
    },

    openPosition: ({ symbol, side, type = 'MARKET', size, level = null, stopLoss = null, takeProfit = null }) => {
      const rules = rulesFor(instruments, symbol);
      if (!rules) {
        return { ok: false, orderId: null, error: `Unsupported symbol "${symbol}": no instrument rules configured.` };
      }

      const outcome = session.submitOrder({
        symbol,
        side,
        type,
        size,
        level,
        // Attachments are opt-in and only included when explicitly asked for. Passing `undefined`
        // rather than a default object is what keeps a plain entry unprotected.
        attachments:
          stopLoss !== null || takeProfit !== null
            ? {
                ...(stopLoss !== null ? { stopLoss } : {}),
                ...(takeProfit !== null ? { takeProfit } : {}),
              }
            : undefined,
      });

      publish();
      if (!outcome.accepted) {
        return { ok: false, orderId: null, error: outcome.clientError ?? 'Command refused.' };
      }
      return { ok: true, orderId: outcome.orderId, error: null };
    },

    closePosition: (positionId) => {
      const outcome = session.closePosition(positionId);
      publish();
      return { ok: outcome.accepted, error: outcome.clientError };
    },

    amendOrder: (orderId, version, level) => {
      const outcome = session.amendOrder(orderId, version, level);
      publish();
      return { ok: outcome.accepted, error: outcome.clientError };
    },

    cancelOrder: (orderId) => {
      const outcome = session.cancelOrder(orderId);
      publish();
      return { ok: outcome.accepted, error: outcome.clientError };
    },

    /**
     * Attach protection to an ALREADY OPEN position.
     *
     * This is the second half of "SL/TP activate only after their entry fills": on the entry path
     * they are attached at fill time, and here they are attached to a position that is open now.
     * Either way a protective instruction never exists before the position it protects.
     */
    protect: (positionId, protection) => {
      const position = session.state().positions.find((p) => p.positionId === positionId);
      if (!position || position.state !== 'OPEN' || position.openSize <= 0) {
        set((prev) => ({ notices: [...prev.notices, `Cannot protect ${positionId}: it is not open.`] }));
        return;
      }
      session.attachProtection(positionId, protection);
      publish();
    },

    advanceTo: (targetMs, reason) => {
      const report = session.advanceTo(targetMs, reason ?? 'PLAY');
      // Notices are part of the account's observable state: a freeze, a refused branch or a late
      // tape page has to reach the user, not stay inside the session. `frozen` is the *current*
      // condition, so a stall stops being announced once it is over.
      set({ notices: [...session.notices], frozen: report.frozen, frozenReason: report.frozenReason });
      publish();
    },

    seekTo: (targetMs) => {
      const report = session.seekTo(targetMs);
      set({ notices: [...session.notices], frozen: report.frozen, frozenReason: report.frozenReason });
      publish();
    },

    reset: (newSessionId) => {
      session.reset(newSessionId);
      set({ notices: [...session.notices] });
      publish();
    },

    refresh: () => {
      publish();
    },
  };
});

// ---------------------------------------------------------------------------
// Reads. Pure selectors over the one account — never accumulators.
// ---------------------------------------------------------------------------

/** Realised PnL for the whole account. Identical no matter how many charts are open. */
export const selectRealizedPnl = (s: AccountStoreState): number => s.totals.realizedPnl;
export const selectUnrealizedPnl = (s: AccountStoreState): number => s.totals.unrealizedPnl;
export const selectTotalPnl = (s: AccountStoreState): number => s.totals.totalPnl;

/** The session id, so a view can tell when the account it is looking at has been replaced. */
export const selectSessionId = (s: AccountStoreState): string => String(s.state.sessionId);
