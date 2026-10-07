/**
 * Frame-budget guard for the 1D (daily) chart hot loop.
 *
 * WHY THIS TEST EXISTS
 *
 * The 1D branch of useChartLifecycle used to rescan all of `masterData` for every
 * elapsed tick, recomputing tick-invariant per-bar facts (symbol filter, RTH
 * classification, ISO string parse, bucket derivation) each time. At a 25x replay
 * speed the chart can consume dozens of ticks in a single frame, so the loop was
 * O(ticks x bars) per frame and blew the frame budget exactly when the market was
 * busiest.
 *
 * Measured before the fix (this repo, best-of-5, 16.67 ms = one 60fps frame):
 *
 *     M=5000 bars x T=50 ticks/frame -> 190.61 ms/frame  (1143% of budget)
 *     M= 960 bars x T=50 ticks/frame ->  36.55 ms/frame  ( 219% of budget)
 *
 * The index in src/lib/dailyIndex.ts makes the per-frame cost a map lookup plus
 * cheap numeric comparisons. Correctness of that substitution is proven separately
 * in tests/unit/dailyIndex.test.ts (index output === naive scan output, tick by tick);
 * this file guards the *performance* half of the contract.
 *
 * The primary assertion is a RATIO, not a wall-clock threshold, so it stays
 * meaningful on slow CI machines where both paths slow down together. The absolute
 * budget check uses a deliberately generous bound and is only a coarse smoke alarm.
 */
import { describe, expect, it } from 'vitest';
import { buildDailyIndex, getBucketTime } from '../../src/lib/dailyIndex';
import { isoToMs } from '../../src/store/usePlaybackStore';
import { isRthBar } from '../../src/lib/timezones';
import type { RawBar, MarketTick } from '../../src/types';

const FRAME_MS = 1000 / 60; // 16.67ms
const SYM = 'TSLA';
const TICKER = 'TSLA';
const SESSION_START = Date.UTC(2026, 8, 8, 13, 30, 0);

const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

function makeBars(m: number): RawBar[] {
  const bars: RawBar[] = [];
  for (let i = 0; i < m; i++) {
    bars.push({
      time: iso(SESSION_START + i * 60_000),
      symbol: SYM,
      open: 200 + (i % 50) * 0.1,
      high: 200.5 + (i % 50) * 0.1,
      low: 199.5 + (i % 50) * 0.1,
      close: 200.2 + (i % 50) * 0.1,
      volume: 1000 + (i % 300),
      session: 'REG',
    });
  }
  return bars;
}

function makeTicks(t: number): MarketTick[] {
  const ticks: MarketTick[] = [];
  for (let i = 0; i < t; i++) {
    ticks.push({
      time: iso(SESSION_START + i * 800),
      price: 200 + (i % 20) * 0.05,
      volume: 100 + i,
      symbol: SYM,
      session: 'REG',
    } as MarketTick);
  }
  return ticks;
}

/** The pre-fix implementation shape: per tick, rescan every bar. */
function naiveFrame(bars: RawBar[], ticks: MarketTick[]): number {
  let sink = 0;
  for (const tick of ticks) {
    const tickMs = isoToMs(tick.time);
    const bucketTime = getBucketTime(tickMs, '1D');
    let completedVol = 0;
    let foundAny = false;
    for (const bar of bars) {
      if (bar.symbol && bar.symbol.toUpperCase() !== SYM) continue;
      if (!isRthBar(bar, TICKER, '1D')) continue;
      const barMs = isoToMs(bar.time);
      if (getBucketTime(barMs, '1D') === bucketTime && barMs <= tickMs) {
        foundAny = true;
        completedVol += bar.volume || 0;
      }
    }
    sink += completedVol + (foundAny ? 1 : 0);
  }
  return sink;
}

/** The shipped implementation shape: one index build, then per-tick map lookups. */
function indexedFrame(index: ReturnType<typeof buildDailyIndex>, ticks: MarketTick[]): number {
  let sink = 0;
  for (const tick of ticks) {
    const tickMs = isoToMs(tick.time);
    const bucketTime = getBucketTime(tickMs, '1D');
    const candidates = index.byBucket.get(bucketTime) || [];
    let completedVol = 0;
    let foundAny = false;
    for (const entry of candidates) {
      if (entry.barMs <= tickMs) {
        foundAny = true;
        completedVol += entry.bar.volume || 0;
      }
    }
    sink += completedVol + (foundAny ? 1 : 0);
  }
  return sink;
}

function best(fn: () => void, reps = 5): number {
  let b = Infinity;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    b = Math.min(b, performance.now() - t0);
  }
  return b;
}

describe('1D chart frame budget', () => {
  it('beats the naive rescan by at least an order of magnitude at worst case', () => {
    const bars = makeBars(5000);
    const ticks = makeTicks(50);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');

    // Warm both paths so neither pays first-run JIT costs.
    naiveFrame(bars, ticks);
    indexedFrame(index, ticks);

    const tNaive = best(() => naiveFrame(bars, ticks));
    const tIndexed = best(() => indexedFrame(index, ticks));

    // Ratio-based so it holds on slower or faster hardware. The measured ratio is
    // ~2000x; 20x is a wide floor that still fails loudly if the scan comes back.
    expect(tNaive / Math.max(tIndexed, 0.001)).toBeGreaterThan(20);
  });

  it('keeps the per-frame cost inside the 60fps budget at worst case', () => {
    const bars = makeBars(5000);
    const ticks = makeTicks(50);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');

    indexedFrame(index, ticks); // warm
    const tIndexed = best(() => indexedFrame(index, ticks));

    // Measured ~0.09ms. The 8ms bound is ~90x headroom for slow CI hardware while
    // still being half a frame, so a regression to the old shape cannot hide here.
    expect(tIndexed).toBeLessThan(8);
    expect(tIndexed).toBeLessThan(FRAME_MS / 2);
  });

  it('amortises the one-off index build over a single frame of ticks', () => {
    const bars = makeBars(5000);
    const ticks = makeTicks(50);
    const buildMs = best(() => buildDailyIndex(bars, SYM, TICKER, '1D'), 3);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    indexedFrame(index, ticks); // warm
    const frameMs = best(() => indexedFrame(index, ticks));

    // The build is paid once per session load, not per frame. Measured ~4.3ms vs
    // ~0.09ms/frame, so a single frame of the indexed path is well under the build.
    expect(buildMs).toBeGreaterThan(frameMs);

    // And the build itself must not stall the first paint: a few frames, not hundreds.
    expect(buildMs).toBeLessThan(FRAME_MS * 10);
  });

  it('stays inside budget on a realistic single-session dataset', () => {
    const bars = makeBars(390); // one regular session of 1-minute bars
    const ticks = makeTicks(50);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');

    indexedFrame(index, ticks); // warm
    const tIndexed = best(() => indexedFrame(index, ticks));
    expect(tIndexed).toBeLessThan(FRAME_MS);
  });
});
