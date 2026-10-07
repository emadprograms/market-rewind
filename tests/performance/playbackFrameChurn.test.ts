/**
 * Regression guard for per-frame state churn in the playback hot loop.
 *
 * PlaybackManager drives advanceSimulationTime() from requestAnimationFrame, so it runs
 * 60x/second for a whole replay no matter how many ticks actually elapse. At 25x with a
 * full session loaded, a tick elapses on only ~35% of frames.
 *
 * The bug this guards against: the action rebuilt and republished `latestTickBySymbol`
 * on EVERY frame, so identity-keyed subscribers (TimeAndSales, useChartData) re-rendered
 * 2.9x more often than there was new data, and updateBidAskPriceLines() pushed a fresh
 * price into applyOptions() each time -- invalidating every chart on the grid 60x/second
 * with nothing moving (measured 1,351,032 applyOptions calls per replay across 12 charts,
 * 65% of them redundant).
 *
 * The invariant: each slice's reference changes only when its value changes.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

const N = 4000;
const SYM = 'TSLA';
const SESSION_START = Date.UTC(2026, 8, 8, 13, 30, 0);
const SESSION_MS = 23400 * 1000;

function makeTicks(n: number): MarketTick[] {
  const ticks: MarketTick[] = [];
  const gap = SESSION_MS / n;
  for (let i = 0; i < n; i++) {
    ticks.push({
      time: new Date(SESSION_START + i * gap).toISOString().replace('T', ' ').slice(0, 19),
      price: 200 + (i % 50) * 0.05,
      volume: 100 + (i % 300),
      symbol: SYM,
      session: 'REG',
    } as MarketTick);
  }
  return ticks;
}

function seed(ticks: MarketTick[]) {
  usePlaybackStore.setState({
    bufferedTicks: ticks,
    ticksBySymbol: { [SYM]: ticks },
    masterData: [],
    currentTickIndex: -1,
    currentTick: null,
    currentTime: SESSION_START,
    latestTickBySymbol: {},
    isPaused: false,
    playbackSpeed: 25,
  } as any);
}

const store: any = usePlaybackStore;

describe('playback frame churn', () => {
  let ticks: MarketTick[];
  beforeEach(() => {
    ticks = makeTicks(N);
    seed(ticks);
  });

  it('reuses the latestTickBySymbol reference on frames that advance no tick', () => {
    const advance = store.getState().advanceSimulationTime;
    advance(SESSION_START + 5000); // settle into the steady-state path

    const before = store.getState().latestTickBySymbol;
    // 5ms of market time per frame is far below the ~5.8s tick gap at N=4000, so none
    // of these frames can advance a tick.
    for (let i = 0; i < 50; i++) {
      advance(SESSION_START + 5000 + i * 5);
    }
    const after = store.getState().latestTickBySymbol;
    expect(after).toBe(before);
  });

  it('does publish a new reference when a tick does elapse', () => {
    const advance = store.getState().advanceSimulationTime;
    const before = store.getState().latestTickBySymbol;
    advance(SESSION_START + SESSION_MS); // jump to the end, all ticks elapsed
    const after = store.getState().latestTickBySymbol;
    expect(after).not.toBe(before);
    expect(after[SYM]).toBeDefined();
  });

  it('notifies identity-keyed subscribers at roughly the tick rate, not the frame rate', () => {
    const advance = store.getState().advanceSimulationTime;
    const WALL_FRAME = 16.67;
    const marketPerFrame = WALL_FRAME * 25;

    let current = SESSION_START;
    const end = SESSION_START + SESSION_MS + 60000;
    let frames = 0;
    let tickFrames = 0;
    let churn = 0;
    let prevIdx = -1;
    let prevLatest = store.getState().latestTickBySymbol;

    const unsub = store.subscribe((s: any) => {
      if (s.latestTickBySymbol !== prevLatest) {
        churn++;
        prevLatest = s.latestTickBySymbol;
      }
    });

    while (current < end) {
      current += marketPerFrame;
      advance(current);
      frames++;
      const idx = store.getState().currentTickIndex;
      if (idx !== prevIdx) {
        tickFrames++;
        prevIdx = idx;
      }
    }
    unsub();

    // The action must not churn the reference on frames that carry no new tick. Allow a
    // frame of slack for the boundaries at each end of the run.
    expect(churn).toBeLessThanOrEqual(tickFrames + 2);
    // Sanity: this really is a minority of frames, which is what made it worth fixing.
    expect(tickFrames).toBeLessThan(frames * 0.6);
    expect(churn).toBeGreaterThan(0);
  });

  it('keeps currentTickIndex accurate while skipping no-op writes', () => {
    const advance = store.getState().advanceSimulationTime;
    advance(SESSION_START + SESSION_MS);
    const { currentTickIndex, latestTickBySymbol } = store.getState();
    expect(currentTickIndex).toBe(N - 1);
    expect(latestTickBySymbol[SYM]).toBe(ticks[N - 1]);
  });

  it('still pauses at the end of the data', () => {
    const advance = store.getState().advanceSimulationTime;
    advance(SESSION_START + SESSION_MS + 120000);
    expect(store.getState().isPaused).toBe(true);
  });

  it('advances monotonically across a replay without losing ticks', () => {
    const advance = store.getState().advanceSimulationTime;
    const WALL_FRAME = 16.67;
    const marketPerFrame = WALL_FRAME * 25;
    let current = SESSION_START;
    const end = SESSION_START + SESSION_MS + 60000;
    let maxIdx = -1;
    while (current < end) {
      current += marketPerFrame;
      advance(current);
      const idx = store.getState().currentTickIndex;
      expect(idx).toBeGreaterThanOrEqual(maxIdx); // never goes backwards
      maxIdx = idx;
    }
    expect(maxIdx).toBe(N - 1);
  });
});
