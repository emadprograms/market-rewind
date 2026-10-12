import type {
  AccountState,
  AmendOrderInput,
  CancelOrderInput,
  ClosePositionInput,
  Command,
  InstrumentRules,
  LatencyProfile,
  MovementReason,
  OrderId,
  PositionId,
  Quote,
  ReplayMs,
  RequestId,
  SessionId,
  SubmitOrderInput,
} from './types';
import { OrderSimulatorEngine, type CommandOutcome } from './engine';

/**
 * Replay integration.
 *
 * The replay clock is the market tape. This module is the bridge between playback (which moves a
 * playhead, sometimes in huge jumps) and the engine (which must see every tick the playhead crossed,
 * in order, exactly once).
 *
 * The rules it enforces:
 *  - **Every crossed tick is consumed.** Advancing 60 s in one call and advancing in 60 one-second
 *    calls feed the engine the identical quote sequence, so fills and PnL cannot depend on frame
 *    size or playback speed.
 *  - **Deadlines and quotes merge chronologically.** Strictly-earlier work drains, then the quote
 *    lands, then work due at that instant runs. A deadline is never evaluated against a later quote.
 *  - **Quote identity is `(symbol, seq)`.** Never an array index, so a buffer that is prepended to or
 *    replaced cannot duplicate or drop economics.
 *  - **Rewinding branches.** A backward seek rebuilds state from the command log truncated at the
 *    target time. Abandoned instructions are removed, not replayed.
 *  - **A session reset is a new session.** Positions are dropped without fabricating a closing fill,
 *    so no phantom realised PnL appears.
 *  - **Exposure freezes advancement.** A symbol with live exposure and no usable tape stops the
 *    playhead rather than letting an order fill against a future or foreign quote.
 *
 * Nothing here reads a wall clock.
 */

export type FreezeReason = 'MISSING_TAPE' | 'TAPE_EXHAUSTED';

export interface MovementRecord {
  /** Monotonic within the session. */
  readonly movementSeq: number;
  readonly reason: MovementReason;
  readonly fromMs: ReplayMs;
  readonly requestedToMs: ReplayMs;
  readonly toMs: ReplayMs;
  /** Quotes that actually reached the engine. */
  readonly quotesFed: number;
  /** Quotes in the crossed range that were deliberately NOT delivered (late history). */
  readonly quotesSkipped: number;
  readonly eventsEmitted: number;
  readonly frozen: boolean;
  readonly frozenReason: FreezeReason | null;
}

export interface CommandRecord {
  readonly commandSeq: number;
  /** Replay time at which the client issued the instruction. */
  readonly atMs: ReplayMs;
  readonly command: Command;
}

export interface AdvanceReport extends MovementRecord {
  readonly notices: readonly string[];
}

export interface ReplaySessionOptions {
  sessionId: string;
  instruments: InstrumentRules[];
  profile: LatencyProfile;
  startMs?: ReplayMs;
}

function fmt(ms: number): string {
  return String(Math.round(ms * 1000) / 1000);
}

interface ReplayEvent {
  readonly t: ReplayMs;
  /** Quotes rank before commands at the same instant: the command could see that quote. */
  readonly rank: 0 | 1;
  readonly seq: number;
  readonly kind: 'QUOTE' | 'COMMAND';
  readonly quote?: Quote;
  readonly command?: CommandRecord;
}

export class ReplaySession {
  private readonly instruments: InstrumentRules[];
  private readonly profile: LatencyProfile;
  private readonly startMs: ReplayMs;

  private sessionId: SessionId;
  private engine: OrderSimulatorEngine;

  /** symbol -> seq -> quote. Identity is (symbol, seq): never an index. */
  private tapes = new Map<string, Map<number, Quote>>();
  /** Insertion order per symbol, so equal-time quotes keep their source order. */
  private tapeOrder = new Map<string, number[]>();

  private commands: CommandRecord[] = [];
  private exposed = new Set<string>();
  private movements: MovementRecord[] = [];
  private noticeLog: string[] = [];

  private movementSeq = 0;
  private commandSeq = 0;
  private cursorMs: ReplayMs;
  /**
   * Highest replay time already delivered to the engine.
   *
   * BUGFIX: this used to be inferred from the cursor, which starts at `startMs` and therefore
   * silently swallowed a quote at exactly t=0 — the session's opening quote was never fed, so an
   * order resting at the first tick could not be evaluated. Delivery is now tracked separately from
   * the playhead.
   */
  private lastDeliveredMs: ReplayMs = Number.NEGATIVE_INFINITY;
  private lateTapeNotices = new Set<string>();
  private eventsSeen = 0;

  constructor(options: ReplaySessionOptions) {
    this.instruments = options.instruments;
    this.profile = options.profile;
    this.startMs = options.startMs ?? 0;
    this.sessionId = options.sessionId as SessionId;
    this.cursorMs = this.startMs;
    this.engine = this.newEngine(this.sessionId);
  }

  // -- construction helpers -------------------------------------------------

  private newEngine(sessionId: SessionId): OrderSimulatorEngine {
    const engine = new OrderSimulatorEngine({
      sessionId,
      instruments: this.instruments,
      profile: this.profile,
      startMs: this.startMs,
    });
    this.eventsSeen = 0;
    return engine;
  }

  // -- tapes ----------------------------------------------------------------

  /**
   * Replace a symbol's tape. Deduplicated by `seq`, so re-supplying an overlapping buffer is
   * harmless and a prepended buffer cannot duplicate economics. Equal-time quotes keep source order.
   */
  replaceTape(symbol: string, quotes: readonly Quote[]): void {
    const key = symbol.toUpperCase();
    const bySeq = new Map<number, Quote>();
    const order: number[] = [];
    for (const quote of quotes) {
      if (!bySeq.has(quote.seq)) order.push(quote.seq);
      bySeq.set(quote.seq, quote);
    }
    this.tapes.set(key, bySeq);
    this.tapeOrder.set(key, order);
  }

  /** Merge additional quotes into an existing tape. Used when a page of history is prepended. */
  mergeTape(symbol: string, quotes: readonly Quote[], reason: MovementReason = 'BUFFER_REPLACED'): void {
    const key = symbol.toUpperCase();
    const bySeq = this.tapes.get(key) ?? new Map<number, Quote>();
    const order = this.tapeOrder.get(key) ?? [];
    for (const quote of quotes) {
      if (!bySeq.has(quote.seq)) order.push(quote.seq);
      bySeq.set(quote.seq, quote);
    }
    this.tapes.set(key, bySeq);
    this.tapeOrder.set(key, order);
    this.noticeLog.push(`${reason}: ${symbol} tape now holds ${bySeq.size} unique quotes.`);
  }

  /** Total number of distinct quotes known across every tape. */
  get quoteCount(): number {
    let total = 0;
    for (const tape of this.tapes.values()) total += tape.size;
    return total;
  }

  /** Quotes for a symbol in (fromMsExclusive, toMsInclusive], in (time, source order). */
  private quotesBetween(fromMsExclusive: number, toMsInclusive: number, symbolsFilter?: Set<string>): Quote[] {
    if (toMsInclusive < fromMsExclusive) return [];
    const out: Quote[] = [];
    for (const [symbol, tape] of this.tapes) {
      if (symbolsFilter && !symbolsFilter.has(symbol)) continue;
      for (const quote of tape.values()) {
        if (quote.replayMs > fromMsExclusive && quote.replayMs <= toMsInclusive) out.push(quote);
      }
    }
    // Sort by time, then by the symbol's tape order (source order for equal times), then by symbol
    // name so that the ordering is fully determined even when two tapes share a timestamp.
    const orderIndex = (q: Quote): number => {
      const order = this.tapeOrder.get(q.symbol.toUpperCase());
      const index = order ? order.indexOf(q.seq) : -1;
      return index;
    };
    out.sort(
      (a, b) =>
        a.replayMs - b.replayMs ||
        orderIndex(a) - orderIndex(b) ||
        a.symbol.localeCompare(b.symbol) ||
        a.seq - b.seq,
    );
    return out;
  }

  // -- exposure -------------------------------------------------------------

  /**
   * Mark a symbol as carrying exposure. Exposure symbols are consumed even when not displayed, and
   * advancement will not run past the end of their tape.
   */
  registerExposure(symbol: string): void {
    this.exposed.add(symbol.toUpperCase());
  }

  clearExposure(symbol: string): void {
    this.exposed.delete(symbol.toUpperCase());
  }

  get exposedSymbols(): string[] {
    return [...this.exposed];
  }

  /** How far the playhead may advance before an exposed symbol runs out of data. */
  private clampToExposure(targetMs: ReplayMs): { limitMs: ReplayMs; frozen: boolean; reason: FreezeReason | null } {
    if (this.exposed.size === 0) return { limitMs: targetMs, frozen: false, reason: null };

    let earliestEnd = Number.POSITIVE_INFINITY;
    for (const symbol of this.exposed) {
      const tape = this.tapes.get(symbol);
      if (!tape || tape.size === 0) {
        // No tape at all for an exposed symbol: freeze immediately rather than guess a price.
        return { limitMs: this.cursorMs, frozen: true, reason: 'MISSING_TAPE' };
      }
      let last = Number.NEGATIVE_INFINITY;
      for (const quote of tape.values()) last = Math.max(last, quote.replayMs);
      earliestEnd = Math.min(earliestEnd, last);
    }

    if (targetMs > earliestEnd) return { limitMs: earliestEnd, frozen: true, reason: 'TAPE_EXHAUSTED' };
    return { limitMs: targetMs, frozen: false, reason: null };
  }

  // -- movement -------------------------------------------------------------

  /**
   * Advance the playhead, feeding the engine every quote that was crossed.
   *
   * Batching is invisible to the engine: `advanceTo(60_000)` and sixty calls of
   * `advanceTo(n * 1_000)` deliver the identical quote sequence and therefore produce identical
   * fills and PnL.
   */
  advanceTo(targetMs: ReplayMs, reason: MovementReason = 'PLAY'): AdvanceReport {
    if (targetMs < this.cursorMs) {
      throw new Error(
        `advanceTo cannot move backwards (${fmt(this.cursorMs)} → ${fmt(targetMs)}). Use seekTo for a rewind.`,
      );
    }

    const { limitMs, frozen, reason: frozenReason } = this.clampToExposure(targetMs);
    const fromMs = this.cursorMs;
    const eventsBefore = this.engine.eventLog().length;

    // The floor is the last quote actually delivered — NOT the engine's clock, because the engine
    // can legitimately be at the opening instant with nothing delivered yet. A tape page that
    // arrives after the playhead passed it is filtered per quote in `deliverQuote`, which keeps the
    // opening quote deliverable while refusing to replay history as if it were live.
    const quotes = this.quotesBetween(this.lastDeliveredMs, limitMs);
    let fed = 0;
    for (const quote of quotes) if (this.deliverQuote(quote)) fed++;
    const skipped = quotes.length - fed;

    this.engine.runUntil(limitMs);
    this.cursorMs = Math.max(this.cursorMs, limitMs);

    const record: MovementRecord = {
      movementSeq: ++this.movementSeq,
      reason,
      fromMs,
      requestedToMs: targetMs,
      toMs: this.cursorMs,
      quotesFed: fed,
      quotesSkipped: skipped,
      eventsEmitted: this.engine.eventLog().length - eventsBefore,
      frozen,
      frozenReason,
    };
    this.movements.push(record);
    if (frozen) {
      this.noticeLog.push(
        `Advancement frozen at ${fmt(this.cursorMs)}: ${frozenReason === 'MISSING_TAPE'
          ? 'an exposed symbol has no tape'
          : 'an exposed symbol’s tape is exhausted'}. No order will fill against a missing quote.`,
      );
    }
    return { ...record, notices: [...this.noticeLog] };
  }

  /**
   * Deliver one quote at its exact instant.
   *
   * Strictly-earlier deadlines are drained first, then the quote becomes visible, then deadlines due
   * at this instant run and can see it. A deadline can therefore never be evaluated against a quote
   * that arrives later, and a quote-driven trigger cannot run twice for one order version because
   * each quote is delivered exactly once.
   */
  private deliverQuote(quote: Quote): boolean {
    const t = quote.replayMs;
    if (t < this.engine.now()) {
      // Late history: the playhead is already beyond this quote. Record it once and move on rather
      // than rewinding the engine's clock.
      const key = `LATE_TAPE:${quote.symbol}`;
      if (!this.lateTapeNotices.has(key)) {
        this.lateTapeNotices.add(key);
        this.noticeLog.push(
          `Late tape data for ${quote.symbol} ignored: quote at ${fmt(t)} arrived after the engine ` +
            `had already reached ${fmt(this.engine.now())}. History is never replayed as live.`,
        );
      }
      return false;
    }
    this.engine.runUntilBefore(t);
    this.engine.onQuote(quote);
    this.engine.runUntil(t);
    // Recorded here, not at the call sites, so that a rebuild or a rebranch — which deliver quotes
    // directly — cannot leave the delivery cursor stale and re-feed the tape on the next advance.
    this.lastDeliveredMs = Math.max(this.lastDeliveredMs, t);
    return true;
  }

  /**
   * Move the playhead to `targetMs`, choosing forward replay or a backward branch.
   */
  seekTo(targetMs: ReplayMs): AdvanceReport {
    if (targetMs >= this.cursorMs) {
      return this.advanceTo(targetMs, 'SEEK_FORWARD');
    }
    return this.rebranch(targetMs);
  }

  /**
   * Backward seek: discard everything after `targetMs` and rebuild by replaying the surviving
   * command log. Instructions issued after the target are truncated, not replayed, so forwarding
   * again never resurrects abandoned submissions.
   */
  rebranch(targetMs: ReplayMs): AdvanceReport {
    const kept = this.commands.filter((c) => c.atMs <= targetMs);
    const truncated = this.commands.length - kept.length;
    const fromMs = this.cursorMs;

    const sessionId = this.sessionId;
    this.engine = this.newEngine(sessionId);
    this.commands = [];
    this.cursorMs = this.startMs;
    this.lastDeliveredMs = Number.NEGATIVE_INFINITY;
    this.movementSeq = this.movementSeq; // movement history is monotonic across a branch

    const noticesBefore = this.noticeLog.length;
    if (truncated > 0) {
      this.noticeLog.push(
        `Rewound to ${fmt(targetMs)}. ${truncated} future instruction${truncated === 1 ? '' : 's'} discarded; ` +
          'a new branch starts here and those submissions will not replay.',
      );
    }

    const events = this.buildReplayEvents(kept, targetMs);
    let quotesFed = 0;
    let quotesSkipped = 0;
    const eventsBefore = this.engine.eventLog().length;
    for (const event of events) {
      if (event.kind === 'QUOTE') {
        if (this.deliverQuote(event.quote!)) quotesFed++;
        else quotesSkipped++;
      } else {
        this.executeRecorded(event.command!);
      }
    }
    this.engine.runUntil(targetMs);
    this.cursorMs = Math.max(this.cursorMs, targetMs);

    const record: MovementRecord = {
      movementSeq: ++this.movementSeq,
      reason: 'SEEK_BACKWARD',
      fromMs,
      requestedToMs: targetMs,
      toMs: this.cursorMs,
      quotesFed,
      quotesSkipped,
      eventsEmitted: this.engine.eventLog().length - eventsBefore,
      frozen: false,
      frozenReason: null,
    };
    const notices = this.noticeLog.slice(noticesBefore);
    this.movements.push(record);
    return { ...record, notices };
  }

  private buildReplayEvents(kept: readonly CommandRecord[], toMs: ReplayMs): ReplayEvent[] {
    const events: ReplayEvent[] = [];
    for (const quote of this.quotesBetween(Number.NEGATIVE_INFINITY, toMs)) {
      events.push({ t: quote.replayMs, rank: 0, seq: quote.seq, kind: 'QUOTE', quote });
    }
    for (const command of kept) {
      events.push({ t: command.atMs, rank: 1, seq: command.commandSeq, kind: 'COMMAND', command });
    }
    events.sort((a, b) => a.t - b.t || a.rank - b.rank || a.seq - b.seq);
    return events;
  }

  private executeRecorded(record: CommandRecord): void {
    this.commands.push(record);
    this.engine.dispatch(record.command);
  }

  /**
   * Begin a fresh session. Positions and orders are dropped WITHOUT a closing fill, so a reset
   * never fabricates realised PnL. The command log is cleared, so nothing from the old session can
   * leak into the new one.
   */
  reset(newSessionId?: string): AdvanceReport {
    const fromMs = this.cursorMs;
    const droppedPositions = this.engine.view().positions.filter((p) => p.state === 'OPEN' && p.openSize > 0).length;
    const droppedOrders = this.engine
      .view()
      .orders.filter((o) => o.state === 'WORKING' || o.state === 'ACCEPTED' || o.state === 'SUBMITTED').length;

    this.sessionId = (newSessionId ?? `${this.sessionId}-r${this.commandSeq + 1}`) as SessionId;
    this.engine = this.newEngine(this.sessionId);
    this.commands = [];
    this.cursorMs = this.startMs;
    this.lastDeliveredMs = Number.NEGATIVE_INFINITY;

    const notices = [
      `New session ${this.sessionId}. ${droppedPositions} open position(s) and ${droppedOrders} live ` +
        'instruction(s) were dropped without a closing fill: a reset must not invent realised PnL.',
    ];
    this.noticeLog.push(...notices);

    const record: MovementRecord = {
      movementSeq: ++this.movementSeq,
      reason: 'SESSION_RESET',
      fromMs,
      requestedToMs: this.startMs,
      toMs: this.startMs,
      quotesFed: 0,
      quotesSkipped: 0,
      eventsEmitted: 0,
      frozen: false,
      frozenReason: null,
    };
    this.movements.push(record);
    return { ...record, notices };
  }

  /**
   * Re-announce a view-only change (timeframe, or an ordinary symbol change) so that no exposure is
   * reset or relabelled. Returns the current state, unchanged.
   */
  viewChanged(detail: string): AccountState {
    this.noticeLog.push(`View change (${detail}): the session, its positions and its PnL are unchanged.`);
    return this.engine.view();
  }

  // -- commands -------------------------------------------------------------

  private record(command: Command): void {
    this.commands.push({ commandSeq: ++this.commandSeq, atMs: this.cursorMs, command });
  }

  private afterCommand(outcome: CommandOutcome, symbol?: string): CommandOutcome {
    // Exposure follows live instructions and positions automatically.
    if (symbol) this.registerExposure(symbol);
    return outcome;
  }

  submitOrder(input: SubmitOrderInput): CommandOutcome {
    const outcome = this.engine.submitOrder(input);
    this.record({
      kind: 'SUBMIT',
      requestId: outcome.requestId,
      input,
    });
    return this.afterCommand(outcome, outcome.accepted ? input.symbol : undefined);
  }

  closePosition(positionId: PositionId): CommandOutcome {
    const outcome = this.engine.closePosition(positionId);
    this.record({ kind: 'CLOSE', requestId: outcome.requestId, input: { positionId } });
    return outcome;
  }

  /**
   * Attach or replace protection on an open position, recorded in the command log so a rewind
   * branches it like any other instruction rather than leaving it applied to a rebuilt account.
   */
  attachProtection(positionId: PositionId, protection: { stopLoss?: number | null; takeProfit?: number | null }): CommandOutcome {
    const input = {
      positionId,
      ...(protection.stopLoss !== undefined && protection.stopLoss !== null ? { stopLoss: protection.stopLoss } : {}),
      ...(protection.takeProfit !== undefined && protection.takeProfit !== null
        ? { takeProfit: protection.takeProfit }
        : {}),
    };
    const outcome = this.engine.dispatch({
      kind: 'PROTECT',
      requestId: `R-PROTECT-${this.commandSeq + 1}` as RequestId,
      input,
    });
    this.commands.push({
      commandSeq: ++this.commandSeq,
      atMs: this.cursorMs,
      command: { kind: 'PROTECT', requestId: outcome.requestId, input },
    });
    return outcome;
  }

  cancelOrder(orderId: OrderId): CommandOutcome {
    const outcome = this.engine.cancelOrder(orderId);
    this.record({ kind: 'CANCEL', requestId: outcome.requestId, input: { orderId } });
    return outcome;
  }

  amendOrder(orderId: OrderId, version: number, level: number): CommandOutcome {
    const input: AmendOrderInput = { orderId, version, level };
    const outcome = this.engine.amendOrder(orderId, version, level);
    this.record({ kind: 'AMEND', requestId: outcome.requestId, input });
    return outcome;
  }

  /** Re-issue a raw command (used by tests and by restored command logs). */
  dispatch(command: Command): CommandOutcome {
    const outcome = this.engine.dispatch(command);
    this.commands.push({ commandSeq: ++this.commandSeq, atMs: this.cursorMs, command });
    return outcome;
  }

  // -- reads ----------------------------------------------------------------

  get nowMs(): ReplayMs {
    return this.cursorMs;
  }

  get currentSessionId(): SessionId {
    return this.sessionId;
  }

  get movementLog(): readonly MovementRecord[] {
    return this.movements;
  }

  get commandLog(): readonly CommandRecord[] {
    return this.commands;
  }

  get notices(): readonly string[] {
    return this.noticeLog;
  }

  get engineRef(): OrderSimulatorEngine {
    return this.engine;
  }

  state(): AccountState {
    return this.engine.view();
  }

  requestIdOf(command: Command): RequestId {
    return command.requestId;
  }

  /** Digest of the current event log, for cross-speed determinism assertions. */
  eventDigest(): string {
    const events = this.engine.eventLog();
    const parts = events.map((e) =>
      [e.seq, e.kind, Math.round(e.replayMs * 1000) / 1000, e.orderId ?? '-', e.positionId ?? '-'].join('|'),
    );
    let hash = 0x811c9dc5;
    const input = parts.join('\n');
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}
