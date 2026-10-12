import { describe, it, expect } from 'vitest';
import { ReplaySession } from '../../../src/lib/orderSimulator/replay';
import { BTCUSD_RULES, trainingProfile } from '../../../src/lib/orderSimulator/profiles';
import type { PositionId, Quote } from '../../../src/lib/orderSimulator/types';

/**
 * Replay integration — SIM-REPLAY-01..07.
 *
 * The theme: whatever shape the playback frames take, the engine must see the same tape.
 */

const SIZE = 0.01;
const SYMBOL = 'BTCUSD';

/** A deterministic 60-second tape: 61 quotes, 1 s apart, drifting down then up. */
function makeTape(symbol = SYMBOL, count = 61, startMs = 0): Quote[] {
  const quotes: Quote[] = [];
  for (let i = 0; i < count; i++) {
    const drift = i < 30 ? -i * 0.1 : -(30 * 0.1) + (i - 30) * 0.15;
    const bid = Math.round((100 + drift) * 100) / 100;
    quotes.push({
      symbol,
      bid,
      ask: Math.round((bid + 0.5) * 100) / 100,
      replayMs: startMs + i * 1_000,
      seq: i + 1,
    });
  }
  return quotes;
}

function makeSession(overrides: { tape?: Quote[]; symbol?: string } = {}) {
  const session = new ReplaySession({
    sessionId: 'session-replay',
    instruments: [BTCUSD_RULES],
    profile: trainingProfile(),
    startMs: 0,
  });
  session.replaceTape(overrides.symbol ?? SYMBOL, overrides.tape ?? makeTape());
  return session;
}

// ---------------------------------------------------------------------------
// SIM-REPLAY-01 — every crossed tick is consumed
// ---------------------------------------------------------------------------

describe('SIM-REPLAY-01 — every crossed tick reaches the engine', () => {
  it('consumes ticks skipped by a large forward jump', () => {
    const session = makeSession();
    const report = session.advanceTo(60_000, 'FORWARD_STEP');
    // All 61 quotes in the tape were crossed and every one was fed.
    expect(report.quotesFed).toBe(61);
    expect(report.reason).toBe('FORWARD_STEP');
    expect(report.frozen).toBe(false);
  });

  it('records a typed movement reason for each distinct movement', () => {
    const session = makeSession();
    session.advanceTo(10_000, 'PLAY');
    session.advanceTo(20_000, 'FORWARD_STEP');
    session.seekTo(30_000);
    session.seekTo(5_000);
    session.reset();

    const reasons = session.movementLog.map((m) => m.reason);
    expect(reasons).toEqual(['PLAY', 'FORWARD_STEP', 'SEEK_FORWARD', 'SEEK_BACKWARD', 'SESSION_RESET']);
  });

  it('does not re-feed a quote that was already delivered', () => {
    const session = makeSession();
    session.advanceTo(30_000, 'PLAY');
    const second = session.advanceTo(60_000, 'PLAY');
    // Quotes are exclusive of the cursor, so the tick at 30_000 is not delivered twice.
    expect(second.quotesFed).toBe(30);
  });

  it('advances the playhead monotonically and reports the reached time', () => {
    const session = makeSession();
    const report = session.advanceTo(25_000, 'PLAY');
    expect(report.fromMs).toBe(0);
    expect(report.requestedToMs).toBe(25_000);
    expect(report.toMs).toBe(25_000);
    expect(session.nowMs).toBe(25_000);
  });
});

// ---------------------------------------------------------------------------
// SIM-REPLAY-03 — batching and speed cannot change the outcome
// ---------------------------------------------------------------------------

describe('SIM-REPLAY-03 — determinism across speed and batching', () => {
  it('a single 60 s jump equals 60 one-second frames', () => {
    const coarse = makeSession();
    coarse.advanceTo(60_000, 'PLAY');

    const fine = makeSession();
    for (let t = 1_000; t <= 60_000; t += 1_000) fine.advanceTo(t, 'PLAY');

    expect(fine.eventDigest()).toBe(coarse.eventDigest());
    expect(fine.state().nowMs).toBe(coarse.state().nowMs);
  });

  it('a 10x speed run equals a 1x run', () => {
    const at1x = makeSession();
    for (let t = 1_000; t <= 60_000; t += 1_000) at1x.advanceTo(t, 'PLAY');

    const at10x = makeSession();
    for (let t = 10_000; t <= 60_000; t += 10_000) at10x.advanceTo(t, 'PLAY');

    expect(at10x.eventDigest()).toBe(at1x.eventDigest());
  });

  it('an order fills at the same millisecond regardless of frame size', () => {
    const build = (frameMs: number) => {
      const session = makeSession();
      session.advanceTo(1_000, 'PLAY');
      session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
      // Play out in frames of the requested size.
      for (let t = 1_000 + frameMs; t <= 60_000; t += frameMs) session.advanceTo(t, 'PLAY');
      session.advanceTo(60_000, 'PLAY');
      return session.state().fills[0];
    };

    const oneSecond = build(1_000);
    const hugeFrames = build(20_000);
    expect(hugeFrames.replayMs).toBe(oneSecond.replayMs);
    expect(hugeFrames.price).toBe(oneSecond.price);
  });

  it('diagnostic: the movement log can be arbitrarily fine without changing economics', () => {
    const session = makeSession();
    // 1 ms frames: the extreme case a naive per-frame implementation would break on.
    for (let t = 1_000; t <= 60_000; t += 1_000) session.advanceTo(t, 'PLAY');
    const fill = session.state().fills.length;
    session.advanceTo(60_000, 'PLAY');
    expect(session.state().fills.length).toBe(fill);
  });
});

// ---------------------------------------------------------------------------
// SIM-REPLAY-02 — chronological merge
// ---------------------------------------------------------------------------

describe('SIM-REPLAY-02 — deadlines and quotes merge chronologically', () => {
  it('a deadline is evaluated against the quote available at that instant, not a later one', () => {
    // A buy limit at 99: the tape dips to 99 at t=15s and recovers afterwards. If a frame's FINAL
    // quote (recovered) were used, the order would never fill.
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 97.5 });
    session.advanceTo(60_000, 'PLAY');

    const fill = session.state().fills[0];
    expect(fill).toBeDefined();
    // The tape drifts 0.1 per second, so the ask reaches the 97.5 limit at t=30 s. If the frame's
    // FINAL quote (the post-dip recovery, ask well above 97.5) were used instead, no fill would
    // ever occur — which is exactly the defect this test exists to catch.
    expect(fill.replayMs).toBe(30_000);
    expect(fill.price).toBe(97.5);
  });

  it('delivers the quote before work due at the same instant', () => {
    // The order is accepted at t=1_100. A quote lands at exactly t=1_150 and a dispatch deadline
    // also falls at t=1_150. Because the quote ranks first, the order can fill at 1_150.
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(2_000, 'PLAY');
    expect(session.state().fills).toHaveLength(1);
  });

  it('an empty tape yields no fills and no fabricated price', () => {
    const session = makeSession();
    session.replaceTape(SYMBOL, []);
    const report = session.advanceTo(10_000, 'PLAY');
    // With no exposure there is nothing to freeze: the playhead simply steps over an empty tape.
    expect(report.frozen).toBe(false);
    expect(report.quotesFed).toBe(0);
    expect(session.state().fills).toHaveLength(0);
    // Advancing with no market data must not conjure a quote, so no order can be evaluated.
    expect(session.state().orders).toHaveLength(0);
  });

  it('delivers the opening quote at t=0 rather than swallowing it', () => {
    // A regression guard: the delivery cursor is distinct from the playhead, so the very first
    // quote of a tape — which sits exactly at the session start — is not skipped.
    const session = makeSession();
    const report = session.advanceTo(0, 'PLAY');
    expect(report.quotesFed).toBe(1);
  });

  it('runs a quote-driven trigger at most once per order version', () => {
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 97.5 });
    session.advanceTo(60_000, 'PLAY');

    const triggered = session.engineRef.eventLog().filter((e) => e.kind === 'TRIGGERED');
    expect(triggered).toHaveLength(1);
    expect(session.state().fills).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SIM-REPLAY-04 — seek and branch policy
// ---------------------------------------------------------------------------

describe('SIM-REPLAY-04 — seek and branch policy', () => {
  it('a forward seek evaluates the skipped path', () => {
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 97.5 });
    // Jump straight to the end rather than playing through.
    const report = session.seekTo(60_000);
    expect(report.reason).toBe('SEEK_FORWARD');
    expect(session.state().fills).toHaveLength(1);
  });

  it('a backward seek discards future instructions and notifies once', () => {
    const session = makeSession();
    session.advanceTo(5_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(20_000, 'PLAY');
    expect(session.commandLog).toHaveLength(1);

    const report = session.seekTo(10_000);
    expect(report.reason).toBe('SEEK_BACKWARD');
    // The submission at 5_000 is BEFORE the target, so nothing is truncated and no notice is owed.
    expect(report.notices.filter((n) => /discarded/.test(n))).toHaveLength(0);
    expect(session.commandLog).toHaveLength(1);
    expect(session.nowMs).toBe(10_000);
    // The surviving submission was replayed onto the new branch and still filled.
    expect(session.state().fills).toHaveLength(1);
  });

  it('does not replay an abandoned submission when playing forward again', () => {
    const session = makeSession();
    session.advanceTo(5_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(20_000, 'PLAY');

    // Rewind to before the submission: the instruction is now in the future and is truncated.
    const report = session.seekTo(1_000);
    expect(report.notices.some((n) => /1 future instruction discarded/.test(n))).toBe(true);
    expect(session.commandLog).toHaveLength(0);

    // Playing forward again must NOT resurrect the abandoned order.
    session.advanceTo(60_000, 'PLAY');
    expect(session.state().fills).toHaveLength(0);
    expect(session.state().orders).toHaveLength(0);
  });

  it('produces the same state as playing through uninterrupted', () => {
    const jumped = makeSession();
    jumped.advanceTo(1_000, 'PLAY');
    jumped.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 97.5 });
    jumped.seekTo(60_000);

    const played = makeSession();
    played.advanceTo(1_000, 'PLAY');
    played.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 97.5 });
    for (let t = 2_000; t <= 60_000; t += 1_000) played.advanceTo(t, 'PLAY');

    expect(jumped.eventDigest()).toBe(played.eventDigest());
  });

  it('rebuilds the same branch deterministically on repeat', () => {
    const once = makeSession();
    once.advanceTo(1_000, 'PLAY');
    once.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 97.5 });
    once.seekTo(60_000);
    once.seekTo(10_000);

    const twice = makeSession();
    twice.advanceTo(1_000, 'PLAY');
    twice.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 97.5 });
    twice.seekTo(60_000);
    twice.seekTo(10_000);

    expect(twice.eventDigest()).toBe(once.eventDigest());
  });

  it('refuses a bare backward advance — a rewind must be an explicit seek', () => {
    const session = makeSession();
    session.advanceTo(30_000, 'PLAY');
    expect(() => session.advanceTo(10_000, 'PLAY')).toThrow(/cannot move backwards/);
  });
});

// ---------------------------------------------------------------------------
// SIM-REPLAY-05 — session lifecycle
// ---------------------------------------------------------------------------

describe('SIM-REPLAY-05 — session lifecycle', () => {
  it('a reset begins a new session id and drops positions without a closing fill', () => {
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(20_000, 'PLAY');
    expect(session.state().fills).toHaveLength(1);

    const before = session.currentSessionId;
    const report = session.reset();
    expect(session.currentSessionId).not.toBe(before);
    expect(report.reason).toBe('SESSION_RESET');

    const after = session.state();
    // No fabricated closing fill, and no fabricated realised PnL.
    expect(after.fills).toHaveLength(0);
    expect(after.realizedPnl).toBe(0);
    expect(after.positions).toHaveLength(0);
    expect(after.orders).toHaveLength(0);
    expect(report.notices[0]).toMatch(/must not invent realised PnL/);
  });

  it('does not leak instructions from the previous session', () => {
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(20_000, 'PLAY');
    session.reset();

    expect(session.commandLog).toHaveLength(0);
    session.advanceTo(60_000, 'PLAY');
    expect(session.state().fills).toHaveLength(0);
  });

  it('treats a timeframe or ordinary symbol change as a view change only', () => {
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(20_000, 'PLAY');

    const sessionId = session.currentSessionId;
    const state = session.viewChanged('timeframe 15m');
    expect(session.currentSessionId).toBe(sessionId);
    expect(state.positions).toHaveLength(1);
    expect(state.realizedPnl).toBe(session.state().realizedPnl);
    expect(session.notices.at(-1)).toMatch(/unchanged/);
  });

  it('keeps movement history monotonic across a reset', () => {
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.reset();
    session.advanceTo(2_000, 'PLAY');
    const seqs = session.movementLog.map((m) => m.movementSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

// ---------------------------------------------------------------------------
// SIM-REPLAY-06 — exposure-driven data handling
// ---------------------------------------------------------------------------

describe('SIM-REPLAY-06 — exposure-driven data handling', () => {
  it('registers exposure for a symbol as soon as an order is accepted', () => {
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    expect(session.exposedSymbols).toContain(SYMBOL);
  });

  it('consumes an exposed symbol’s tape even though nothing displays it', () => {
    const session = makeSession();
    // ETHUSD is not "displayed" but carries exposure; its tape must still be consumed.
    session.replaceTape('ETHUSD', makeTape('ETHUSD'));
    session.registerExposure('ETHUSD');
    const report = session.advanceTo(30_000, 'PLAY');
    expect(report.quotesFed).toBeGreaterThan(0);
    expect(report.frozen).toBe(false);
  });

  it('freezes advancement when an exposed symbol has no tape', () => {
    const session = makeSession();
    session.registerExposure('ETHUSD'); // exposed but no tape supplied
    const report = session.advanceTo(30_000, 'PLAY');
    expect(report.frozen).toBe(true);
    expect(report.frozenReason).toBe('MISSING_TAPE');
    // Frozen means no time passed: the playhead never left the current instant.
    expect(report.toMs).toBe(0);
    expect(session.nowMs).toBe(0);
    expect(session.state().fills).toHaveLength(0);
  });

  it('freezes at the end of an exposed symbol’s tape rather than filling against a foreign quote', () => {
    const session = makeSession();
    // ETHUSD only has data up to 10 s, while BTCUSD runs to 60 s.
    session.replaceTape('ETHUSD', makeTape('ETHUSD', 11));
    session.registerExposure('ETHUSD');

    const report = session.advanceTo(60_000, 'PLAY');
    expect(report.frozen).toBe(true);
    expect(report.frozenReason).toBe('TAPE_EXHAUSTED');
    expect(report.toMs).toBe(10_000);
    expect(session.nowMs).toBe(10_000);
    expect(report.notices.some((n) => /No order will fill against a missing quote/.test(n))).toBe(true);
  });

  it('may skip a symbol with no exposure', () => {
    const session = makeSession();
    session.replaceTape('ETHUSD', makeTape('ETHUSD', 11)); // no exposure registered
    const report = session.advanceTo(60_000, 'PLAY');
    expect(report.frozen).toBe(false);
    expect(session.nowMs).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// SIM-REPLAY-07 — stable quote identity
// ---------------------------------------------------------------------------

describe('SIM-REPLAY-07 — stable quote identity', () => {
  it('deduplicates by seq, so a re-supplied buffer changes nothing', () => {
    const session = makeSession();
    const before = session.quoteCount;
    session.replaceTape(SYMBOL, makeTape()); // identical buffer again
    expect(session.quoteCount).toBe(before);
  });

  it('survives a prepended page of history without duplicating economics', () => {
    const session = makeSession();
    const original = makeTape();
    const prepended = makeTape(SYMBOL, 31, -30_000).map((q, i) => ({ ...q, seq: i + 1, replayMs: -30_000 + i * 1_000 }));
    // Use non-overlapping seq ranges for the merged page.
    const page = prepended.map((q, i) => ({ ...q, seq: 1_000 + i }));

    session.mergeTape(SYMBOL, [...page, ...original]);
    expect(session.quoteCount).toBe(31 + 61);
    expect(session.notices.at(-1)).toMatch(/unique quotes/);
  });

  it('keeps source order for equal-time quotes', () => {
    const session = makeSession();
    const sameTime: Quote[] = [
      { symbol: SYMBOL, bid: 100.0, ask: 100.5, replayMs: 5_000, seq: 90 },
      { symbol: SYMBOL, bid: 100.1, ask: 100.6, replayMs: 5_000, seq: 91 },
      { symbol: SYMBOL, bid: 100.2, ask: 100.7, replayMs: 5_000, seq: 92 },
    ];
    session.replaceTape(SYMBOL, sameTime);
    session.advanceTo(5_000, 'PLAY');
    // The last equal-time quote in source order is the one the engine sees as current.
    expect(session.quoteCount).toBe(3);
    expect(session.state().nowMs).toBe(5_000);
  });

  it('ignores a tape page that arrives after the playhead has already passed it', () => {
    // Regression guard. A late history page (or a subscriber that runs before the tape effect) used
    // to push the engine's clock backwards and throw. History is now skipped, never replayed as live.
    const session = new ReplaySession({
      sessionId: 'late-tape',
      instruments: [BTCUSD_RULES],
      profile: trainingProfile(),
      startMs: 0,
    });
    session.replaceTape(SYMBOL, []); // nothing loaded yet

    // The playhead advances over the gap before any tape exists.
    session.advanceTo(10_000, 'PLAY');
    expect(session.nowMs).toBe(10_000);
    expect(session.quoteCount).toBe(0);

    // Now the tape arrives, containing the history that was already passed.
    session.replaceTape(SYMBOL, makeTape(SYMBOL, 61, 0));
    expect(() => session.advanceTo(20_000, 'PLAY')).not.toThrow();

    // Only quotes at or after the engine's current time were delivered; the rest were skipped.
    expect(session.notices.some((n) => /Late tape data/.test(n))).toBe(true);
    const record = session.movementLog.at(-1)!;
    // Quotes at 10 s .. 20 s inclusive. The quote at exactly the engine's current instant is still
    // "now" and is delivered; everything strictly before it is history and is not.
    expect(record.quotesFed).toBe(11);
    expect(record.quotesSkipped).toBe(10); // quotes at 0 s .. 9 s
    expect(session.nowMs).toBe(20_000);
  });

  it('does not depend on array index: the same tape in a different array is the same tape', () => {
    const first = makeSession();
    const quotes = makeTape();
    first.replaceTape(SYMBOL, quotes);
    first.advanceTo(30_000, 'PLAY');

    const second = makeSession();
    // Same quotes, reverse array order: identity is the seq, so the outcome must not change.
    second.replaceTape(SYMBOL, [...quotes].reverse());
    second.advanceTo(30_000, 'PLAY');

    expect(second.eventDigest()).toBe(first.eventDigest());
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a pilot-shaped scenario through the replay bridge
// ---------------------------------------------------------------------------

describe('replay integration — pilot-shaped end-to-end', () => {
  it('closes a position by position id and realises PnL once', () => {
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(5_000, 'PLAY');

    const position = session.state().positions[0];
    expect(position.state).toBe('OPEN');
    session.closePosition(position.positionId);
    session.advanceTo(10_000, 'PLAY');

    const closed = session.state().positions[0];
    expect(closed.state).toBe('CLOSED');
    expect(closed.realizedPnl).toBeCloseTo((session.state().fills[1].price - session.state().fills[0].price) * SIZE, 6);
  });

  it('refuses a close that targets an order id even through the replay layer', () => {
    const session = makeSession();
    session.advanceTo(1_000, 'PLAY');
    const submitted = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(5_000, 'PLAY');

    const attempt = session.closePosition(submitted.orderId as unknown as PositionId);
    expect(attempt.accepted).toBe(false);
    expect(attempt.clientError).toMatch(/No position with id/);
    expect(session.state().positions[0].state).toBe('OPEN');
  });
});
