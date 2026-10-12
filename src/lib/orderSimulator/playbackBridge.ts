import type { MarketTick, RawBar } from '../../types';
import type { MovementReason, Quote, InstrumentRules, ReplayMs } from './types';
import type { AdvanceReport, ReplaySession } from './replay';

/**
 * Bridge between the existing replay playhead and the order simulator.
 *
 * The playhead is the source of truth for time; the simulator is a pure consumer of it. This module
 * contains the translation rules and is deliberately free of React, so the translation can be tested
 * against the real store without rendering anything.
 */

/** The subset of the playback store this bridge depends on. */
export interface PlaybackSnapshot {
  currentTime: number | null;
  currentTickIndex: number;
  currentTick: MarketTick | null;
  bufferedTicks: MarketTick[];
  seekEpoch: number;
  isPaused: boolean;
  /** Monotonic counter of buffer replacements, used to spot a tape swap. */
  bufferEpoch?: number;
}

export class UnsupportedTickError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedTickError';
  }
}

/**
 * Quote identity for a tick.
 *
 * `(timeMs * 1000 + ordinal)`. It depends only on the tick's own timestamp and its position among
 * ticks sharing that timestamp — never on an array index — so prepending history or replacing the
 * buffer cannot renumber, duplicate or drop a quote.
 */
export function tickSeq(tick: MarketTick, ordinal = 0): number {
  return isoToMs(tick.time) * 1000 + ordinal;
}

export function isoToMs(value: string | number): number {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`).getTime();
}

/**
 * Convert a tick into a quote.
 *
 * Ticks that carry a real bid and ask are used as-is. Ticks that carry only a print are converted
 * using a **one-tick spread**, which is a disclosed convention rather than a measurement: the tape
 * has no book, and inventing a spread silently would be worse than stating the rule. The pilot's
 * BTCUSD tape did show a constant one-tick (0.05) spread, which is why the convention is defensible,
 * but it is labelled `derived` on every quote it produces.
 */
export function tickToQuote(tick: MarketTick, rules: InstrumentRules, ordinal = 0): Quote {
  const replayMs = isoToMs(tick.time);
  const hasBook = typeof tick.bid === 'number' && typeof tick.ask === 'number' && tick.bid > 0 && tick.ask > 0;

  if (hasBook) {
    if (tick.bid! > tick.ask!) {
      throw new UnsupportedTickError(
        `Tick at ${tick.time} for ${tick.symbol} has bid ${tick.bid} above ask ${tick.ask}.`,
      );
    }
    return {
      symbol: tick.symbol.toUpperCase(),
      bid: tick.bid!,
      ask: tick.ask!,
      replayMs,
      seq: tickSeq(tick, ordinal),
    };
  }

  if (!Number.isFinite(tick.price) || tick.price <= 0) {
    throw new UnsupportedTickError(`Tick at ${tick.time} for ${tick.symbol} has no usable price.`);
  }

  const bid = round(tick.price, rules.priceDecimals);
  return {
    symbol: tick.symbol.toUpperCase(),
    bid,
    ask: round(bid + rules.tickSize, rules.priceDecimals),
    replayMs,
    seq: tickSeq(tick, ordinal),
    derived: true,
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Build the quote tape for one symbol from the playhead's own buffers. */
export function quotesFromTicks(ticks: readonly MarketTick[], symbol: string, rules: InstrumentRules): Quote[] {
  const wanted = symbol.toUpperCase();
  const out: Quote[] = [];
  let ordinal = 0;
  let lastMs = Number.NaN;
  for (const tick of ticks) {
    const tickSymbol = (tick.symbol || wanted).toUpperCase();
    const ms = isoToMs(tick.time);
    if (ms !== lastMs) ordinal = 0;
    lastMs = ms;
    if (tickSymbol !== wanted) continue;
    out.push(tickToQuote(tick, rules, ordinal));
    ordinal++;
  }
  return out;
}

/**
 * Decide how the playhead moved, from two store snapshots.
 *
 * `seekEpoch` is the store's own marker for a temporal discontinuity, so a changed epoch is a seek;
 * a strictly larger time without a changed epoch is ordinary playback. A caller that knows better
 * (a step button, a session reset) passes an explicit reason.
 */
export function movementReasonFor(prev: PlaybackSnapshot | null, next: PlaybackSnapshot): MovementReason {
  if (!prev) return 'SESSION_RESET';

  // A swapped tape is a data change, not a time change: it must be announced before anything else.
  // Note: `prev.bufferEpoch` being undefined is itself a difference — a store that has just started
  // reporting epochs has, as far as this bridge knows, swapped its tape.
  if (next.bufferEpoch !== undefined && prev.bufferEpoch !== next.bufferEpoch) {
    return 'BUFFER_REPLACED';
  }

  if (next.seekEpoch !== prev.seekEpoch) {
    const prevMs = prev.currentTime ?? 0;
    const nextMs = next.currentTime ?? 0;
    return nextMs < prevMs ? 'SEEK_BACKWARD' : 'SEEK_FORWARD';
  }

  return 'PLAY';
}

export interface SyncOptions {
  /** Override the inferred reason, for callers that know what happened. */
  reason?: MovementReason;
  /** Bars, used to advance when the tape has no ticks yet. */
  masterData?: RawBar[];
}

export interface SyncResult {
  readonly acted: boolean;
  readonly reason: MovementReason;
  readonly report: AdvanceReport | null;
  readonly skipped: string | null;
}

/**
 * Move the session to match a new playhead snapshot.
 *
 * Every tick the playhead crossed is handed to the session; the session decides what that means.
 * The playhead never advances when the session refuses (exposure freeze), so the two stay in step.
 */
export function syncSessionToPlayback(
  session: ReplaySession,
  prev: PlaybackSnapshot | null,
  next: PlaybackSnapshot,
  options: SyncOptions = {},
): SyncResult {
  const reason = options.reason ?? movementReasonFor(prev, next);
  const target = next.currentTime;

  if (target === null) {
    return { acted: false, reason, report: null, skipped: 'NO_PLAYHEAD' };
  }
  // The condition for doing nothing is that the playhead did not move — not that a flag says
  // "paused". A paused playhead can still be nudged by a step or a scrub, and the store's default
  // state is paused, so keying off the flag would silently ignore a caller that legitimately drives
  // `advanceSimulationTime` itself.
  if (prev && prev.currentTime === next.currentTime) {
    return { acted: false, reason, report: null, skipped: next.isPaused ? 'PAUSED' : 'STATIONARY' };
  }
  // Moving backwards outside an explicit seek is a branch, and a branch is destructive: refuse.
  if (prev && next.currentTime !== null && prev.currentTime !== null && next.currentTime < prev.currentTime && reason !== 'SEEK_BACKWARD') {
    return { acted: false, reason, report: null, skipped: 'BACKWARD_WITHOUT_SEEK' };
  }

  // A rewind must go through seekTo so it rebranches; a forward move replays the crossed path.
  if (reason === 'SEEK_BACKWARD') {
    const report = session.seekTo(target);
    return { acted: true, reason, report, skipped: null };
  }

  const report = session.advanceTo(target, reason === 'SEEK_FORWARD' ? 'SEEK_FORWARD' : reason);
  return { acted: true, reason, report, skipped: null };
}

/**
 * Register the tape the playhead holds for a symbol, so the session can consume ticks even for a
 * symbol that is not currently displayed but does carry exposure.
 */
export function registerPlaybackTape(
  session: ReplaySession,
  ticks: readonly MarketTick[],
  symbol: string,
  rules: InstrumentRules,
): { replaced: boolean; count: number } {
  const quotes = quotesFromTicks(ticks, symbol, rules);
  const before = session.quoteCount;
  session.replaceTape(symbol, quotes);
  return { replaced: before !== session.quoteCount, count: quotes.length };
}

/**
 * The bar-mode fallback: when no ticks exist, the playhead synthesises a price from the bar. That
 * price is a *view* of the bar, not market data, so it is converted with the same one-tick rule and
 * flagged as derived. Bar-mode prices must never be mistaken for observed quotes.
 */
export function quoteFromBar(bar: RawBar, targetMs: ReplayMs, rules: InstrumentRules, seq: number): Quote {
  const bid = round(bar.close, rules.priceDecimals);
  return {
    symbol: (bar.symbol || rules.symbol).toUpperCase(),
    bid,
    ask: round(bid + rules.tickSize, rules.priceDecimals),
    replayMs: targetMs,
    seq,
    derived: true,
  };
}
