/**
 * Daily (1D) bar bucketing index.
 *
 * WHY THIS EXISTS
 *
 * The 1D chart build path used to re-derive, for every elapsed tick, the bucket and
 * RTH eligibility of every bar in `masterData`:
 *
 *     for (const tick of newlyElapsedTicks) {
 *       for (const bar of masterData) {          // up to ~5000 one-minute bars
 *         if (bar.symbol && bar.symbol.toUpperCase() !== sym) continue;
 *         if (!isRthBar(bar, ticker, timeframe)) continue;
 *         const barMs = isoToMs(bar.time);       // new Date(<string>) per bar
 *         if (getBucketTime(barMs, '1D') === bucketTime && barMs <= evalTimeMs) { ... }
 *       }
 *     }
 *
 * Everything in that inner loop except the final `barMs <= evalTimeMs` comparison is
 * **invariant with respect to the tick** — it depends only on the bar. So the loop did
 * O(ticks x bars) work per frame, each iteration paying a string parse (`ioToMs`), a
 * `Date` construction, an RTH classification and a `toUpperCase` allocation.
 *
 * Measured on this repository (see the probe in the PR description):
 *
 *   M=5000 bars, T=50 ticks/frame -> 190.61 ms/frame  (1143% of a 60fps frame budget)
 *   M= 960 bars, T=50 ticks/frame ->  36.55 ms/frame  ( 219% of budget)
 *   M= 960 bars, T= 1 tick /frame ->   0.70 ms/frame
 *
 * The cost therefore exploded exactly when the market was busiest (a 25x replay can
 * deliver 20-50 ticks in one frame), which is when dropped frames are most visible.
 *
 * With the index, the per-bar facts are computed once per session load and each tick
 * becomes a map lookup plus cheap numeric comparisons:
 *
 *   M=5000 bars, T=50 ticks/frame -> 0.09 ms/frame   (~2000x faster)
 *   index build                    -> 4-5 ms, once per session load
 *
 * SEMANTICS
 *
 * The index preserves the original behaviour exactly:
 *   * bars are filtered by the same symbol and `isRthBar` predicates,
 *   * bars are grouped by the same `getBucketTime(barMs, timeframe)` value,
 *   * within a bucket, bars keep their original `masterData` order, so
 *     `firstBarOpen` (first match wins) and `lastBarClose` (last match wins) are
 *     unchanged, and
 *   * the tick-dependent `barMs <= evalTimeMs` test is still evaluated per tick.
 *
 * Safe to cache by `masterData` reference because `masterData` is always replaced
 * wholesale (`setMasterData`) and never mutated in place.
 */
import type { RefObject } from 'react';
import { isRthBar } from './timezones';
import { isoToMs } from '../store/usePlaybackStore';
import { TF_SECONDS, type RawBar, type Timeframe } from '../types';

/** Bucket start (Unix seconds) for a timestamp, matching the chart's time axis. */
export const getBucketTime = (timestampMs: number, tf: Timeframe): number => {
  const date = new Date(timestampMs);
  if (tf === '1D') {
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0) / 1000);
  }
  const durationSec = TF_SECONDS[tf] || 60;
  const bucketStartMs = Math.floor(timestampMs / (durationSec * 1000)) * (durationSec * 1000);
  return Math.floor(bucketStartMs / 1000);
};

export interface DailyBucketEntry {
  barMs: number;
  bar: RawBar;
}

export interface DailyIndex {
  /** Identity of the source array; a new reference invalidates the index. */
  masterData: RawBar[];
  sym: string;
  ticker: string;
  timeframe: Timeframe;
  byBucket: Map<number, DailyBucketEntry[]>;
}

/** Builds the index. O(bars), once per session load — not per frame, not per tick. */
export function buildDailyIndex(
  masterData: RawBar[],
  sym: string,
  ticker: string,
  timeframe: Timeframe,
): DailyIndex {
  const byBucket = new Map<number, DailyBucketEntry[]>();
  for (const bar of masterData) {
    if (bar.symbol && bar.symbol.toUpperCase() !== sym) continue;
    if (!isRthBar(bar, ticker, timeframe)) continue;
    const barMs = isoToMs(bar.time);
    const bucketTime = getBucketTime(barMs, timeframe);
    let list = byBucket.get(bucketTime);
    if (!list) {
      list = [];
      byBucket.set(bucketTime, list);
    }
    list.push({ barMs, bar });
  }
  return { masterData, sym, ticker, timeframe, byBucket };
}

/**
 * Returns the cached index for this chart, rebuilding only when the source data or the
 * symbol/ticker/timeframe identity changes.
 *
 * Takes the ref rather than closing over one so it can be called from a subscription
 * callback without stale-closure concerns.
 */
export function resolveDailyIndex(
  ref: RefObject<DailyIndex | null>,
  masterData: RawBar[],
  sym: string,
  ticker: string,
  timeframe: Timeframe,
): DailyIndex {
  const cached = ref.current;
  if (
    cached &&
    cached.masterData === masterData &&
    cached.sym === sym &&
    cached.ticker === ticker &&
    cached.timeframe === timeframe
  ) {
    return cached;
  }
  const built = buildDailyIndex(masterData, sym, ticker, timeframe);
  ref.current = built;
  return built;
}
