import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlaybackStore, isoToMs } from '../store/usePlaybackStore';
import { ReplaySession } from '../lib/orderSimulator/replay';
import {
  movementReasonFor,
  quotesFromTicks,
  syncSessionToPlayback,
  type PlaybackSnapshot,
} from '../lib/orderSimulator/playbackBridge';
import { TRADEABLE_INSTRUMENTS, createInstrumentRegistry, trainingProfile } from '../lib/orderSimulator/profiles';
import type { AccountState, InstrumentRules, LatencyProfile, MovementReason } from '../lib/orderSimulator/types';

/**
 * React binding for the order simulator.
 *
 * The hook owns one `ReplaySession` for the lifetime of the component and keeps it in step with the
 * playhead. It is deliberately thin: every rule about *what* advancing means lives in
 * `ReplaySession` and is tested without React.
 *
 * The one thing this hook must get right is that the engine sees every tick the playhead crossed —
 * including ticks skipped by a fast frame or a seek — so it reads the playhead's own buffer rather
 * than the single "latest tick", which would silently drop everything in between.
 */

export interface UseOrderSimulatorOptions {
  symbols?: string[];
  instruments?: InstrumentRules[];
  profile?: LatencyProfile;
  sessionId?: string;
  /** Called once per movement that the engine acted on. */
  onAdvance?: (info: { reason: MovementReason; toMs: number; quotesFed: number }) => void;
}

export interface UseOrderSimulatorResult {
  session: ReplaySession;
  state: AccountState;
  exposedSymbols: string[];
  notices: readonly string[];
  /** Force a re-render after a command; the session itself is intentionally not reactive. */
  refresh: () => void;
}

export function useOrderSimulator(options: UseOrderSimulatorOptions = {}): UseOrderSimulatorResult {
  const { symbols, instruments, profile, sessionId, onAdvance } = options;

  const instrumentList = useMemo(() => instruments ?? TRADEABLE_INSTRUMENTS, [instruments]);

  const session = useMemo(
    () =>
      new ReplaySession({
        sessionId: sessionId ?? `sim-${Math.floor(Date.now() / 1000)}`,
        instruments: instrumentList,
        profile: profile ?? trainingProfile(),
        startMs: 0,
      }),
    // The session is intentionally created once per identity; changing it mid-flight would drop
    // exposure, which is exactly the "session reset" case that must be explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );

  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const prevSnapshot = useRef<PlaybackSnapshot | null>(null);
  const latest = useRef({ onAdvance });
  latest.current = { onAdvance };

  const rulesFor = useMemo(() => createInstrumentRegistry(instrumentList), [instrumentList]);

  // Keep the session's tapes aligned with the playhead's buffers. This runs whenever the buffered
  // tape or the symbol list changes, and is idempotent because tapes are keyed by quote identity.
  const bufferedTicks = usePlaybackStore((s) => s.bufferedTicks);
  const ticksBySymbol = usePlaybackStore((s) => s.ticksBySymbol);
  const watched = useMemo(() => symbols ?? TRADEABLE_INSTRUMENTS.map((r) => r.symbol), [symbols]);

  useEffect(() => {
    for (const symbol of watched) {
      const ticks = ticksBySymbol[symbol.toUpperCase()] ?? (bufferedTicks.some((t) => t.symbol?.toUpperCase() === symbol.toUpperCase()) ? bufferedTicks : []);
      if (ticks.length === 0) continue;
      let rules: InstrumentRules;
      try {
        rules = rulesFor(symbol);
      } catch {
        // An unconfigured symbol has no rules and is never given invented ones.
        continue;
      }
      session.replaceTape(symbol, quotesFromTicks(ticks, symbol, rules));
    }
  }, [session, bufferedTicks, ticksBySymbol, watched, rulesFor]);

  // Drive the session from the playhead. Subscribed with `subscribe` rather than through React
  // state so that a 25x playback does not force a re-render on every frame: the engine advances,
  // and React is told only when the account actually changed.
  useEffect(() => {
    const sync = (state: ReturnType<typeof usePlaybackStore.getState>, reason?: MovementReason) => {
      const snapshot: PlaybackSnapshot = {
        currentTime: state.currentTime,
        currentTickIndex: state.currentTickIndex,
        currentTick: state.currentTick,
        bufferedTicks: state.bufferedTicks,
        seekEpoch: state.seekEpoch,
        isPaused: state.isPaused,
      };
      const result = syncSessionToPlayback(session, prevSnapshot.current, snapshot, reason ? { reason } : {});
      prevSnapshot.current = snapshot;
      if (result.acted && result.report) {
        latest.current.onAdvance?.({
          reason: result.report.reason,
          toMs: result.report.toMs,
          quotesFed: result.report.quotesFed,
        });
        if (result.report.quotesFed > 0 || result.report.reason !== 'PLAY') refresh();
      }
    };

    sync(usePlaybackStore.getState());

    return usePlaybackStore.subscribe((state) => {
      sync(state, movementReasonFor(prevSnapshot.current, {
        currentTime: state.currentTime,
        currentTickIndex: state.currentTickIndex,
        currentTick: state.currentTick,
        bufferedTicks: state.bufferedTicks,
        seekEpoch: state.seekEpoch,
        isPaused: state.isPaused,
      }));
    });
  }, [session, refresh]);

  const state = useMemo(() => session.state(), [session, tick]);

  return {
    session,
    state,
    exposedSymbols: session.exposedSymbols,
    notices: session.notices,
    refresh,
  };
}

/** Convenience: the replay time of the last quote the engine has consumed. */
export function engineTimeMs(session: ReplaySession): number {
  return session.nowMs;
}

export { isoToMs };
