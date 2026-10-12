import { describe, it, expect } from 'vitest';
import { ReplaySession } from '../../src/lib/orderSimulator/replay';
import { BTCUSD_RULES, trainingProfile } from '../../src/lib/orderSimulator/profiles';
import type { Quote } from '../../src/lib/orderSimulator/types';

/**
 * SIM-VERIFY-02 — dense replay and seek must not revive a freeze, drop events, or duplicate fills.
 *
 * These are guards rather than benchmarks: the time bounds are generous enough to survive a busy CI
 * machine, and their job is to fail loudly if a change makes replay quadratic, re-delivers quotes, or
 * silently stops advancing after a rewind.
 */

const SYMBOL = 'BTCUSD';
const QUOTE_COUNT = 20_000;
const STEP_MS = 10;
const END_MS = QUOTE_COUNT * STEP_MS;

/** A dense tape with a gentle oscillation, so triggers and limits are actually evaluated. */
function denseTape(count = QUOTE_COUNT): Quote[] {
  return Array.from({ length: count }, (_, i) => {
    const drift = Math.round(Math.sin(i / 40) * 100) / 100;
    const bid = Math.round((100 + drift) * 100) / 100;
    return { symbol: SYMBOL, bid, ask: Math.round((bid + 0.05) * 100) / 100, replayMs: i * STEP_MS, seq: i + 1 };
  });
}

function newSession(): ReplaySession {
  const session = new ReplaySession({ sessionId: 'perf', instruments: [BTCUSD_RULES], profile: trainingProfile() });
  session.replaceTape(SYMBOL, denseTape());
  return session;
}

describe('dense replay', () => {
  it('advances through 20,000 quotes in one batch without freezing or dropping any', () => {
    const session = newSession();
    const started = performance.now();
    const report = session.advanceTo(END_MS, 'PLAY');
    const elapsed = performance.now() - started;

    // Reported, not asserted: the verifier needs the actual throughput to judge headroom, and the
    // ceiling below is deliberately loose so a slow machine does not fail the guard spuriously.
    console.log(
      `PERF dense-batch quotes=${report.quotesFed} batchMs=${elapsed.toFixed(1)} ` +
        `quotesPerSecond=${Math.round((report.quotesFed / elapsed) * 1000)}`,
    );

    expect(report.frozen).toBe(false);
    expect(report.quotesFed).toBe(QUOTE_COUNT);
    expect(report.quotesSkipped).toBe(0);
    expect(session.state().nowMs).toBe(END_MS);
    expect(elapsed).toBeLessThan(4_000);
  });

  it('produces the same digest whether the tape is fed in one frame or in 200', () => {
    const oneFrame = newSession();
    oneFrame.advanceTo(END_MS, 'PLAY');

    const manyFrames = newSession();
    for (let t = STEP_MS * 100; t <= END_MS; t += STEP_MS * 100) manyFrames.advanceTo(t, 'PLAY');

    expect(manyFrames.eventDigest()).toBe(oneFrame.eventDigest());
  });

  it('never delivers the same quote twice', () => {
    const session = newSession();
    const first = session.advanceTo(END_MS / 2, 'PLAY');
    // Re-advance to the same instant, then beyond it.
    const repeated = session.advanceTo(END_MS / 2, 'PLAY');
    const second = session.advanceTo(END_MS, 'PLAY');

    expect(second.frozen).toBe(false);
    // Nothing was re-fed: the instant already consumed is not replayed, and the two halves of the
    // tape add up to exactly one delivery of every quote.
    expect(repeated.quotesFed).toBe(0);
    expect(first.quotesFed + second.quotesFed).toBe(QUOTE_COUNT);
  });
});

describe('dense seek', () => {
  it('rewinds and re-advances without stalling or losing the digest', () => {
    const straight = newSession();
    straight.advanceTo(END_MS, 'PLAY');
    const expected = straight.eventDigest();

    const session = newSession();
    session.advanceTo(END_MS, 'PLAY');
    const started = performance.now();
    session.seekTo(END_MS / 4);
    const rewindMs = performance.now() - started;
    const forward = session.advanceTo(END_MS, 'PLAY');
    const forwardMs = performance.now() - started - rewindMs;

    console.log(
      `PERF dense-seek quotes=${QUOTE_COUNT} rewindToMs=${END_MS / 4} rewindMs=${rewindMs.toFixed(1)} ` +
        `forwardMs=${forwardMs.toFixed(1)} totalMs=${(rewindMs + forwardMs).toFixed(1)}`,
    );

    expect(rewindMs).toBeLessThan(4_000);
    expect(forwardMs).toBeLessThan(4_000);
    expect(forward.frozen).toBe(false);
    // A rewind to a point and a re-advance is the same journey, so it ends at the same state.
    expect(session.eventDigest()).toBe(expected);
    expect(session.state().nowMs).toBe(END_MS);
  });

  it('keeps a batch of live instructions correct across a dense run', () => {
    const session = newSession();
    session.advanceTo(0, 'PLAY');

    // Two instructions that will each execute once, plus one that will never be reached.
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: 0.01 });
    session.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'STOP', size: 0.01, level: 99.5 });
    // A buy limit far below the oscillating range: this one must still be working at the end, which
    // is what distinguishes "no fills were dropped" from "no fills happened at all".
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: 0.01, level: 90 });

    // The last quote in the tape is one step before END_MS: an exposed symbol is clamped to the
    // data that exists, so the run ends there rather than being declared exhausted.
    const lastQuoteMs = END_MS - STEP_MS;
    const startedAt = performance.now();
    const report = session.advanceTo(lastQuoteMs, 'PLAY');
    const state = session.state();
    const elapsed = performance.now() - startedAt;

    console.log(
      `PERF instruction-batch quotes=${report.quotesFed} fills=${state.fills.length} ms=${elapsed.toFixed(1)}`,
    );

    expect(report.frozen).toBe(false);
    // No duplicate economics: one fill per fill id, and one id per fill.
    const fillIds = state.fills.map((f) => f.fillId);
    expect(new Set(fillIds).size).toBe(fillIds.length);
    // The market order and the stop both executed; the far-away limit never did.
    expect(state.fills).toHaveLength(2);
    expect(state.orders.filter((o) => o.type === 'LIMIT')[0].state).toBe('WORKING');
    // And no position was created twice for the same fill.
    const positionIds = state.positions.map((p) => p.positionId);
    expect(new Set(positionIds).size).toBe(positionIds.length);
  });
});
