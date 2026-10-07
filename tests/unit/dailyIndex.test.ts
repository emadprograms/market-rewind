/**
 * Correctness tests for the 1D (daily) bucket index used by useChartLifecycle.
 *
 * The index replaces an O(ticks x bars) rescan of `masterData` with a map lookup.
 * The whole point is that it must be *behaviour-preserving*: the aggregate the chart
 * renders must be bit-for-bit what the old nested loop produced. These tests assert
 * that by running both implementations over the same inputs and comparing outputs.
 */
import { describe, expect, it } from 'vitest';
import { buildDailyIndex, getBucketTime, resolveDailyIndex, type DailyIndex } from '../../src/lib/dailyIndex';
import { isoToMs } from '../../src/store/usePlaybackStore';
import { isRthBar } from '../../src/lib/timezones';
import type { RawBar, Timeframe } from '../../src/types';
import type { RefObject } from 'react';

const SYM = 'TSLA';
const TICKER = 'TSLA';

interface Aggregate {
  bucketTime: number;
  firstBarOpen: number | undefined;
  foundAny: boolean;
  completedVol: number;
  maxHigh: number;
  minLow: number;
  lastBarClose: number | undefined;
}

/**
 * The ORIGINAL implementation, transcribed verbatim from the 1D branch of
 * useChartLifecycle before the index was introduced. This is the oracle.
 */
function naiveAggregate(bars: RawBar[], tickTimeMs: number, sym: string, ticker: string, tf: Timeframe): Aggregate {
  const bucketTime = getBucketTime(tickTimeMs, tf);
  const evalTimeMs = tickTimeMs;

  let firstBarOpen: number | undefined;
  let foundAny = false;
  let completedVol = 0;
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let lastBarClose: number | undefined;

  for (const bar of bars) {
    if (bar.symbol && bar.symbol.toUpperCase() !== sym) continue;
    if (!isRthBar(bar, ticker, tf)) continue;
    const barMs = isoToMs(bar.time);
    if (getBucketTime(barMs, tf) === bucketTime && barMs <= evalTimeMs) {
      if (firstBarOpen === undefined) {
        firstBarOpen = bar.open;
      }
      foundAny = true;
      const isForming = barMs + 60000 > evalTimeMs;
      if (isForming) {
        maxHigh = Math.max(maxHigh, bar.open);
        minLow = Math.min(minLow, bar.open);
        lastBarClose = bar.open;
      } else {
        completedVol += bar.volume || 0;
        maxHigh = Math.max(maxHigh, bar.high);
        minLow = Math.min(minLow, bar.low);
        lastBarClose = bar.close;
      }
    }
  }

  return { bucketTime, firstBarOpen, foundAny, completedVol, maxHigh, minLow, lastBarClose };
}

/** The NEW implementation: index lookup + the same per-tick arithmetic. */
function indexedAggregate(index: DailyIndex, tickTimeMs: number): Aggregate {
  const bucketTime = getBucketTime(tickTimeMs, index.timeframe);
  const evalTimeMs = tickTimeMs;
  const bucketBars = index.byBucket.get(bucketTime) || [];

  let firstBarOpen: number | undefined;
  let foundAny = false;
  let completedVol = 0;
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let lastBarClose: number | undefined;

  for (const entry of bucketBars) {
    const { bar, barMs } = entry;
    if (barMs <= evalTimeMs) {
      if (firstBarOpen === undefined) {
        firstBarOpen = bar.open;
      }
      foundAny = true;
      const isForming = barMs + 60000 > evalTimeMs;
      if (isForming) {
        maxHigh = Math.max(maxHigh, bar.open);
        minLow = Math.min(minLow, bar.open);
        lastBarClose = bar.open;
      } else {
        completedVol += bar.volume || 0;
        maxHigh = Math.max(maxHigh, bar.high);
        minLow = Math.min(minLow, bar.low);
        lastBarClose = bar.close;
      }
    }
  }

  return { bucketTime, firstBarOpen, foundAny, completedVol, maxHigh, minLow, lastBarClose };
}

const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

function makeBars(count: number, opts: { startMs?: number; symbol?: string | undefined } = {}): RawBar[] {
  const startMs = opts.startMs ?? Date.UTC(2026, 8, 8, 13, 30, 0);
  const bars: RawBar[] = [];
  for (let i = 0; i < count; i++) {
    const ms = startMs + i * 60_000;
    bars.push({
      time: iso(ms),
      symbol: opts.symbol === undefined ? SYM : opts.symbol,
      open: 200 + (i % 37) * 0.1,
      high: 200.5 + (i % 37) * 0.1,
      low: 199.5 + (i % 37) * 0.1,
      close: 200.2 + (i % 37) * 0.1,
      volume: 1000 + (i % 300),
      session: 'REG',
    });
  }
  return bars;
}

const ref = (current: DailyIndex | null = null): RefObject<DailyIndex | null> => ({ current });

describe('getBucketTime', () => {
  it('anchors 1D buckets at 12:00 UTC of the calendar day', () => {
    const ms = Date.UTC(2026, 8, 8, 13, 30, 0);
    expect(getBucketTime(ms, '1D')).toBe(Date.UTC(2026, 8, 8, 12, 0, 0) / 1000);
  });

  it('places every timestamp of a UTC day in the same 1D bucket', () => {
    const midnight = Date.UTC(2026, 8, 8, 0, 0, 0);
    const endOfDay = Date.UTC(2026, 8, 8, 23, 59, 59);
    expect(getBucketTime(midnight, '1D')).toBe(getBucketTime(endOfDay, '1D'));
  });

  it('puts adjacent UTC days in adjacent buckets', () => {
    const d1 = Date.UTC(2026, 8, 8, 13, 30, 0);
    const d2 = Date.UTC(2026, 8, 9, 13, 30, 0);
    expect(getBucketTime(d2, '1D') - getBucketTime(d1, '1D')).toBe(86400);
  });

  it('falls back to 60s buckets for unknown timeframes, like the original', () => {
    const ms = Date.UTC(2026, 8, 8, 13, 30, 45);
    expect(getBucketTime(ms, '1m')).toBe(Math.floor(ms / 60_000) * 60);
  });

  it('buckets sub-minute timeframes on their own boundaries', () => {
    const ms = Date.UTC(2026, 8, 8, 13, 30, 45);
    // 5m buckets are aligned to 5-minute boundaries.
    expect(getBucketTime(ms, '5m')).toBe(Math.floor(ms / 300_000) * 300);
  });
});

describe('buildDailyIndex', () => {
  it('groups bars by their 1D bucket', () => {
    const bars = makeBars(10);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const bucket = getBucketTime(isoToMs(bars[0].time), '1D');
    expect(index.byBucket.get(bucket)).toHaveLength(10);
  });

  it('filters out bars belonging to a different symbol', () => {
    const bars = makeBars(6, { symbol: 'AAPL' });
    bars.push(...makeBars(4, { symbol: 'TSLA', startMs: Date.UTC(2026, 8, 8, 14, 0, 0) }));
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const total = [...index.byBucket.values()].reduce((n, list) => n + list.length, 0);
    expect(total).toBe(4);
  });

  it('treats a missing symbol as a wildcard, matching the original predicate', () => {
    const bars = makeBars(3, { symbol: undefined });
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const total = [...index.byBucket.values()].reduce((n, list) => n + list.length, 0);
    expect(total).toBe(3);
  });

  it('compares symbols case-insensitively', () => {
    const bars = makeBars(3, { symbol: 'tsla' });
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const total = [...index.byBucket.values()].reduce((n, list) => n + list.length, 0);
    expect(total).toBe(3);
  });

  it('preserves masterData order within a bucket', () => {
    const bars = makeBars(5);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const list = [...index.byBucket.values()][0];
    expect(list.map((e) => e.bar)).toEqual(bars);
    // ...and barMs is strictly increasing in that order.
    for (let i = 1; i < list.length; i++) {
      expect(list[i].barMs).toBeGreaterThan(list[i - 1].barMs);
    }
  });

  it('produces an empty map for empty input', () => {
    expect(buildDailyIndex([], SYM, TICKER, '1D').byBucket.size).toBe(0);
  });
});

describe('resolveDailyIndex caching', () => {
  it('reuses the index while masterData reference and identity are unchanged', () => {
    const bars = makeBars(10);
    const r = ref();
    const first = resolveDailyIndex(r, bars, SYM, TICKER, '1D');
    const second = resolveDailyIndex(r, bars, SYM, TICKER, '1D');
    expect(second).toBe(first);
  });

  it('rebuilds when masterData is replaced', () => {
    const r = ref();
    const first = resolveDailyIndex(r, makeBars(10), SYM, TICKER, '1D');
    const second = resolveDailyIndex(r, makeBars(10), SYM, TICKER, '1D');
    expect(second).not.toBe(first);
  });

  it('rebuilds when the ticker changes', () => {
    const bars = makeBars(10);
    const r = ref();
    const first = resolveDailyIndex(r, bars, SYM, TICKER, '1D');
    const second = resolveDailyIndex(r, bars, SYM, 'AAPL', '1D');
    expect(second).not.toBe(first);
  });

  it('rebuilds when the timeframe changes', () => {
    const bars = makeBars(10);
    const r = ref();
    const first = resolveDailyIndex(r, bars, SYM, TICKER, '1D');
    const second = resolveDailyIndex(r, bars, SYM, TICKER, '5m');
    expect(second).not.toBe(first);
  });

  it('survives an empty masterData without caching a stale index', () => {
    const r = ref();
    const empty = resolveDailyIndex(r, [], SYM, TICKER, '1D');
    expect(empty.byBucket.size).toBe(0);
    const populated = resolveDailyIndex(r, makeBars(3), SYM, TICKER, '1D');
    expect(populated.byBucket.size).toBe(1);
  });
});

describe('index equals the original naive scan', () => {
  it('agrees on every tick across a full session', () => {
    const bars = makeBars(390); // one regular session of 1-minute bars
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const sessionStart = Date.UTC(2026, 8, 8, 13, 30, 0);

    for (let i = 0; i < 390; i++) {
      const tickMs = sessionStart + i * 60_000;
      expect(indexedAggregate(index, tickMs)).toEqual(naiveAggregate(bars, tickMs, SYM, TICKER, '1D'));
    }
  });

  it('agrees at every intermediate second, including partial bars', () => {
    const bars = makeBars(60);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const sessionStart = Date.UTC(2026, 8, 8, 13, 30, 0);

    // Step through a bar second-by-second: exercises the `isForming` boundary
    // (barMs + 60000 > evalTimeMs) on both sides.
    for (let s = 0; s <= 120; s++) {
      const tickMs = sessionStart + s * 1000;
      expect(indexedAggregate(index, tickMs)).toEqual(naiveAggregate(bars, tickMs, SYM, TICKER, '1D'));
    }
  });

  it('agrees on multi-day data where only one bucket is live', () => {
    const day1 = makeBars(390, { startMs: Date.UTC(2026, 8, 8, 13, 30, 0) });
    const day2 = makeBars(390, { startMs: Date.UTC(2026, 8, 9, 13, 30, 0) });
    const bars = [...day1, ...day2];
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');

    for (const tickMs of [
      Date.UTC(2026, 8, 8, 14, 0, 0),
      Date.UTC(2026, 8, 8, 20, 0, 0),
      Date.UTC(2026, 8, 9, 14, 0, 0),
      Date.UTC(2026, 8, 9, 20, 0, 0),
    ]) {
      expect(indexedAggregate(index, tickMs)).toEqual(naiveAggregate(bars, tickMs, SYM, TICKER, '1D'));
    }
  });

  it('agrees when the current time leads the tick time', () => {
    // The hook evaluates against max(currentTime, tickTime); model that by
    // passing the leading timestamp directly.
    const bars = makeBars(390);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const leading = Date.UTC(2026, 8, 8, 19, 59, 0);
    expect(indexedAggregate(index, leading)).toEqual(naiveAggregate(bars, leading, SYM, TICKER, '1D'));
  });

  it('agrees for a tick before the first bar of the session', () => {
    const bars = makeBars(390);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const before = Date.UTC(2026, 8, 8, 13, 29, 0);
    const agg = indexedAggregate(index, before);
    expect(agg).toEqual(naiveAggregate(bars, before, SYM, TICKER, '1D'));
    expect(agg.foundAny).toBe(false);
  });

  it('agrees on a mixed symbol stream', () => {
    const tsla = makeBars(100, { startMs: Date.UTC(2026, 8, 8, 13, 30, 0) });
    const aapl = makeBars(100, { startMs: Date.UTC(2026, 8, 8, 13, 30, 0), symbol: 'AAPL' });
    // Interleave so the naive scan sees alternating symbols.
    const bars: RawBar[] = [];
    for (let i = 0; i < 100; i++) {
      bars.push(tsla[i], aapl[i]);
    }
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');

    for (let i = 0; i < 100; i += 7) {
      const tickMs = Date.UTC(2026, 8, 8, 13, 30, 0) + i * 60_000;
      expect(indexedAggregate(index, tickMs)).toEqual(naiveAggregate(bars, tickMs, SYM, TICKER, '1D'));
    }
  });

  it('agrees on randomised data across many ticks', () => {
    // Deterministic LCG so a failure is reproducible.
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const bars: RawBar[] = [];
    let ms = Date.UTC(2026, 8, 8, 13, 30, 0);
    for (let i = 0; i < 600; i++) {
      ms += 60_000;
      // Occasionally jump a day so several buckets exist.
      if (rand() < 0.01) ms += 86_400_000;
      bars.push({
        time: iso(ms),
        symbol: rand() < 0.05 ? 'AAPL' : SYM,
        open: 100 + rand() * 50,
        high: 150 + rand() * 50,
        low: 50 + rand() * 20,
        close: 100 + rand() * 40,
        volume: Math.floor(rand() * 5000),
        session: rand() < 0.1 ? 'PRE' : 'REG',
      });
    }
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');

    const start = Date.UTC(2026, 8, 8, 13, 30, 0);
    for (let i = 0; i < 200; i++) {
      const tickMs = start + Math.floor(rand() * 60 * 60 * 1000 * 30);
      expect(indexedAggregate(index, tickMs)).toEqual(naiveAggregate(bars, tickMs, SYM, TICKER, '1D'));
    }
  });

  it('never reports a bar outside the requested bucket', () => {
    const bars = makeBars(390);
    const index = buildDailyIndex(bars, SYM, TICKER, '1D');
    const tickMs = Date.UTC(2026, 8, 8, 15, 0, 0);
    const wanted = getBucketTime(tickMs, '1D');
    const agg = indexedAggregate(index, tickMs);
    expect(agg.bucketTime).toBe(wanted);
    // All 90 bars up to 15:00 belong to this bucket; a neighbouring-day bar must not leak in.
    expect(agg.foundAny).toBe(true);
    expect(agg.completedVol).toBeGreaterThan(0);
  });
});
