import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { ReplaySession } from '../../src/lib/orderSimulator/replay';
import {
  movementReasonFor,
  quotesFromTicks,
  registerPlaybackTape,
  syncSessionToPlayback,
  tickSeq,
  tickToQuote,
  type PlaybackSnapshot,
} from '../../src/lib/orderSimulator/playbackBridge';
import { BTCUSD_RULES, trainingProfile } from '../../src/lib/orderSimulator/profiles';
import type { MarketTick } from '../../src/types';

/**
 * Drives the REAL playback store and asserts the engine receives every tick the playhead crossed.
 *
 * This is the SIM-REPLAY-03 acceptance harness: the existing dense replay/seek machinery is exercised
 * unchanged, and the simulator must not drop events or depend on frame size.
 */

const SYMBOL = 'BTCUSD';

function makeTicks(count = 120, startMs = Date.UTC(2026, 0, 5, 14, 30, 0)): MarketTick[] {
  const ticks: MarketTick[] = [];
  for (let i = 0; i < count; i++) {
    const price = Math.round((82_900 + Math.sin(i / 7) * 60 + i * 0.05) * 100) / 100;
    ticks.push({
      time: new Date(startMs + i * 1_000).toISOString(),
      symbol: SYMBOL,
      price,
      volume: 1,
      session: 'REG',
    });
  }
  return ticks;
}

function snapshotOf(): PlaybackSnapshot {
  const s = usePlaybackStore.getState();
  return {
    currentTime: s.currentTime,
    currentTickIndex: s.currentTickIndex,
    currentTick: s.currentTick,
    bufferedTicks: s.bufferedTicks,
    seekEpoch: s.seekEpoch,
    isPaused: s.isPaused,
  };
}

function newSession() {
  const session = new ReplaySession({
    sessionId: 'playback-test',
    instruments: [BTCUSD_RULES],
    profile: trainingProfile(),
    startMs: 0,
  });
  return session;
}

beforeEach(() => {
  usePlaybackStore.getState().reset();
});

describe('playback bridge — tick translation', () => {
  it('derives a one-tick spread from a bare print and labels the quote as derived', () => {
    const quote = tickToQuote({ time: '2026-01-05T14:30:00.000Z', symbol: SYMBOL, price: 82_946.8, volume: 1 }, BTCUSD_RULES, 0);
    expect(quote.bid).toBe(82_946.8);
    expect(quote.ask).toBe(82_946.85); // one tick of 0.05
    expect(quote.derived).toBe(true);
  });

  it('uses a real bid/ask when the tick carries one, without flagging it derived', () => {
    const quote = tickToQuote(
      { time: '2026-01-05T14:30:00.000Z', symbol: SYMBOL, price: 82_946.8, volume: 1, bid: 82_946.7, ask: 82_946.9 },
      BTCUSD_RULES,
      0,
    );
    expect(quote.bid).toBe(82_946.7);
    expect(quote.ask).toBe(82_946.9);
    expect(quote.derived).toBeUndefined();
  });

  it('refuses a crossed book rather than silently repairing it', () => {
    expect(() =>
      tickToQuote(
        { time: '2026-01-05T14:30:00.000Z', symbol: SYMBOL, price: 1, volume: 1, bid: 101, ask: 100 },
        BTCUSD_RULES,
        0,
      ),
    ).toThrow(/above ask/);
  });

  it('gives a tick an identity that does not depend on its array index', () => {
    const tick: MarketTick = { time: '2026-01-05T14:30:00.000Z', symbol: SYMBOL, price: 1, volume: 1 };
    const seq = tickSeq(tick, 0);
    // The same tick in a differently-positioned array still has the same identity.
    expect(tickSeq(tick, 0)).toBe(seq);
    expect(seq).toBe(Date.UTC(2026, 0, 5, 14, 30, 0) * 1000);
    // Two ticks at the same instant are distinguished by their ordinal, not by luck.
    expect(tickSeq(tick, 1)).toBe(seq + 1);
  });

  it('keeps equal-time ticks in source order', () => {
    const ticks: MarketTick[] = [
      { time: '2026-01-05T14:30:00.000Z', symbol: SYMBOL, price: 100, volume: 1 },
      { time: '2026-01-05T14:30:00.000Z', symbol: SYMBOL, price: 101, volume: 1 },
      { time: '2026-01-05T14:30:00.000Z', symbol: SYMBOL, price: 102, volume: 1 },
    ];
    const quotes = quotesFromTicks(ticks, SYMBOL, BTCUSD_RULES);
    expect(quotes.map((q) => q.bid)).toEqual([100, 101, 102]);
    expect(quotes.map((q) => q.seq)).toEqual([tickSeq(ticks[0], 0), tickSeq(ticks[1], 1), tickSeq(ticks[2], 2)]);
  });
});

describe('playback store integration — the engine sees every crossed tick', () => {
  it('consumes the whole buffer when playback runs to the end', () => {
    const ticks = makeTicks(120);
    usePlaybackStore.getState().setBufferedTicks(ticks);
    usePlaybackStore.getState().addSymbolTicks(SYMBOL, ticks);

    const session = newSession();
    registerPlaybackTape(session, ticks, SYMBOL, BTCUSD_RULES);
    session.registerExposure(SYMBOL);

    let prev: PlaybackSnapshot | null = null;
    const lastMs = ticks[ticks.length - 1].time;
    const endMs = new Date(lastMs.endsWith('Z') ? lastMs : `${lastMs}Z`).getTime();

    // Play forward in 1-second frames, exactly as the chart component does.
    for (let t = endMs - 119_000; t <= endMs; t += 1_000) {
      usePlaybackStore.getState().advanceSimulationTime(t);
      const next = snapshotOf();
      syncSessionToPlayback(session, prev, next);
      prev = next;
    }

    // Every tick in the buffer was handed to the session.
    expect(session.quoteCount).toBe(120);
    expect(session.nowMs).toBe(endMs);
  });

  it('produces the same result whether played in 1 s frames or one jump', () => {
    const ticks = makeTicks(60);
    const lastMs = new Date(ticks[ticks.length - 1].time).getTime();
    const firstMs = new Date(ticks[0].time).getTime();

    const coarse = newSession();
    registerPlaybackTape(coarse, ticks, SYMBOL, BTCUSD_RULES);
    coarse.advanceTo(lastMs, 'PLAY');

    const fine = newSession();
    registerPlaybackTape(fine, ticks, SYMBOL, BTCUSD_RULES);
    for (let t = firstMs; t <= lastMs; t += 1_000) fine.advanceTo(t, 'PLAY');

    expect(fine.eventDigest()).toBe(coarse.eventDigest());
    expect(fine.nowMs).toBe(lastMs);
  });

  it('never advances past a pause', () => {
    const ticks = makeTicks(20);
    usePlaybackStore.getState().setBufferedTicks(ticks);
    usePlaybackStore.getState().setPaused(true);

    const session = newSession();
    registerPlaybackTape(session, ticks, SYMBOL, BTCUSD_RULES);

    const pausedSnapshot = snapshotOf();
    const result = syncSessionToPlayback(session, pausedSnapshot, pausedSnapshot);
    // No playhead movement means no engine movement.
    expect(result.acted).toBe(false);
    expect(result.skipped).toBe('PAUSED');
    expect(session.nowMs).toBe(0);
  });

  it('reports a seek as a seek, not as ordinary playback', () => {
    const before: PlaybackSnapshot = {
      currentTime: 1_000,
      currentTickIndex: 1,
      currentTick: null,
      bufferedTicks: [],
      seekEpoch: 3,
      isPaused: true,
    };
    expect(movementReasonFor(before, { ...before, seekEpoch: 4, currentTime: 5_000 })).toBe('SEEK_FORWARD');
    expect(movementReasonFor(before, { ...before, seekEpoch: 4, currentTime: 500 })).toBe('SEEK_BACKWARD');
    expect(movementReasonFor(before, { ...before, currentTime: 2_000 })).toBe('PLAY');
    expect(movementReasonFor(null, before)).toBe('SESSION_RESET');
    expect(movementReasonFor(before, { ...before, bufferEpoch: 9 })).toBe('BUFFER_REPLACED');
  });

  it('rewinds through the store and rebuilds the branch', () => {
    const ticks = makeTicks(40);
    const startMs = new Date(ticks[0].time).getTime();
    const session = newSession();
    registerPlaybackTape(session, ticks, SYMBOL, BTCUSD_RULES);

    session.advanceTo(startMs + 20_000, 'PLAY');
    expect(session.nowMs).toBe(startMs + 20_000);

    // A seek backwards through the bridge must rebranch, not throw.
    const report = session.seekTo(startMs + 5_000);
    expect(report.reason).toBe('SEEK_BACKWARD');
    expect(session.nowMs).toBe(startMs + 5_000);
  });

  it('keeps the store’s dense replay behaviour intact (no dropped ticks)', () => {
    const ticks = makeTicks(300);
    usePlaybackStore.getState().setBufferedTicks(ticks);
    usePlaybackStore.getState().addSymbolTicks(SYMBOL, ticks);

    const lastMs = new Date(ticks[ticks.length - 1].time).getTime();
    const firstMs = new Date(ticks[0].time).getTime();

    const session = newSession();
    registerPlaybackTape(session, ticks, SYMBOL, BTCUSD_RULES);

    // Deliberately coarse, uneven frames: 7 s, then 1 s jitter. Frame size must not matter.
    let prev: PlaybackSnapshot | null = null;
    for (let t = firstMs; t <= lastMs; t += 7_000) {
      usePlaybackStore.getState().advanceSimulationTime(t);
      const next = snapshotOf();
      syncSessionToPlayback(session, prev, next);
      prev = next;
    }
    usePlaybackStore.getState().advanceSimulationTime(lastMs);
    const finalSnapshot = snapshotOf();
    syncSessionToPlayback(session, prev, finalSnapshot);

    expect(session.nowMs).toBe(lastMs);
    expect(session.quoteCount).toBe(300);
  });
});

describe('playback bridge — exposure symbols are consumed even when hidden', () => {
  it('consumes two symbols when only one is displayed', () => {
    const btc = makeTicks(30);
    const eth = makeTicks(30).map((t) => ({ ...t, symbol: 'ETHUSD', price: t.price / 20 }));
    const session = newSession();
    registerPlaybackTape(session, btc, SYMBOL, BTCUSD_RULES);
    registerPlaybackTape(session, eth, 'ETHUSD', { ...BTCUSD_RULES, symbol: 'ETHUSD' });
    session.registerExposure('ETHUSD'); // exposed but not "displayed"

    const lastMs = new Date(btc[btc.length - 1].time).getTime();
    const report = session.advanceTo(lastMs, 'PLAY');

    expect(report.frozen).toBe(false);
    expect(session.quoteCount).toBe(60);
  });

  it('freezes instead of advancing into a gap for an exposed symbol', () => {
    const btc = makeTicks(30);
    // ETHUSD only has the first 10 seconds of data.
    const eth = makeTicks(10).map((t) => ({ ...t, symbol: 'ETHUSD' }));
    const session = newSession();
    registerPlaybackTape(session, btc, SYMBOL, BTCUSD_RULES);
    registerPlaybackTape(session, eth, 'ETHUSD', { ...BTCUSD_RULES, symbol: 'ETHUSD' });
    session.registerExposure('ETHUSD');

    const lastMs = new Date(btc[btc.length - 1].time).getTime();
    const report = session.advanceTo(lastMs, 'PLAY');

    expect(report.frozen).toBe(true);
    expect(report.frozenReason).toBe('TAPE_EXHAUSTED');
    expect(report.toMs).toBe(new Date(eth[eth.length - 1].time).getTime());
  });
});
