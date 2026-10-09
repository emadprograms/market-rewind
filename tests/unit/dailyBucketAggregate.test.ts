/**
 * Guards for the 1D daily-bucket aggregation used by playback subscriber 6.
 *
 * Context: a 60-minute forward seek on a dense session re-aggregated the whole day's bucket and
 * scanned the forming minute once PER CATCH-UP TICK. The forming-minute scan also started at the
 * end of the full buffered tape, so it walked every future tick on each call. Measured on a real
 * machine: 8.1 s of main-thread stall for one forward seek on a 72,935-tick tape.
 *
 * Two properties are pinned here:
 *   1. EQUIVALENCE: the memoised / binary-searched code produces exactly the same per-tick values
 *      as the original per-tick code. The oracle below is a verbatim copy of that original code,
 *      not a restatement of the new implementation, so the test fails if the refactor drifts.
 *   2. LOCALITY: the forming-minute scan reads only ticks at or before the evaluation time.
 *      Walking future ticks is what made the cost O(ticks x future ticks).
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateDailyBucket,
  applyDailyTickFallback,
  type DailyBucketAggregate,
} from '../../src/hooks/useChartLifecycle';
import { buildDailyIndex, getBucketTime } from '../../src/lib/dailyIndex';
import { isoToMs } from '../../src/store/usePlaybackStore';

const TICKER = 'SPY';
const SYM = 'SPY';
const DAY = '2026-09-25';
// Regular session in September (EDT): 13:30 - 20:00 UTC.
const RTH_START_MS = Date.parse(`${DAY}T13:30:00Z`);
const RTH_END_MS = Date.parse(`${DAY}T20:00:00Z`);

// Deterministic PRNG so a failure is reproducible.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const fmt = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
};

function buildFixture(rng: () => number) {
  // Minute bars: most minutes present, some missing, a few forming-minute-length gaps.
  const masterData: any[] = [];
  for (let m = RTH_START_MS; m < RTH_END_MS; m += 60000) {
    if (rng() < 0.08) continue;
    const open = 100 + rng() * 10;
    const high = open + rng() * 2;
    const low = open - rng() * 2;
    const close = low + rng() * (high - low);
    masterData.push({
      time: fmt(m).slice(0, 19),
      open, high, low, close,
      volume: Math.floor(rng() * 1000),
      symbol: SYM,
      session: 'REG',
    });
  }

  // Ticks: sorted, several per minute, some ETH (not RTH), some after the evaluation point.
  const ticks: any[] = [];
  let t = RTH_START_MS - 3600000;
  while (t < RTH_END_MS + 3600000) {
    t += Math.floor(rng() * 12000);
    const eth = rng() < 0.1;
    ticks.push({
      time: fmt(t),
      price: 100 + rng() * 10,
      volume: Math.floor(rng() * 500) + 1,
      symbol: SYM,
      session: eth ? 'PRE' : 'REG',
    });
  }
  return { masterData, ticks };
}

/**
 * ORIGINAL per-tick 1D aggregation, copied verbatim in shape from the pre-fix subscriber 6.
 * Returns the values the caller observes for one tick. This is the oracle.
 */
function referencePerTick(
  tick: any,
  index: ReturnType<typeof buildDailyIndex>,
  symbolTicks: any[] | undefined,
  currentTime: number | null,
  isSynthetic: boolean,
  ticker: string,
) {
  const tickTimeMs = isoToMs(tick.time);
  let completedVol = 0;
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let lastBarClose = tick.price;
  let firstBarOpen: number | undefined = undefined;
  let foundAny = false;
  const evalTimeMs = currentTime && currentTime > tickTimeMs ? currentTime : tickTimeMs;
  const bucketTime = getBucketTime(tickTimeMs, '1D');

  const bucketBars = index.byBucket.get(bucketTime) || [];
  for (const entry of bucketBars) {
    const bar = entry.bar;
    const barMs = entry.barMs;
    if (barMs <= evalTimeMs) {
      if (firstBarOpen === undefined) firstBarOpen = bar.open;
      foundAny = true;
      const isForming = barMs + 60000 > evalTimeMs;
      if (isForming) {
        maxHigh = Math.max(maxHigh, bar.open);
        minLow = Math.min(minLow, bar.open);
        lastBarClose = bar.open;
      } else {
        completedVol += (bar.volume || 0);
        maxHigh = Math.max(maxHigh, bar.high);
        minLow = Math.min(minLow, bar.low);
        lastBarClose = bar.close;
      }
    }
  }

  let formingMinuteVol = 0;
  const isRth = (t: any) => (t.session === 'REG');
  if (!isSynthetic && symbolTicks && symbolTicks.length > 0) {
    const currentMinuteStartMs = Math.floor(evalTimeMs / 60000) * 60000;
    for (let i = symbolTicks.length - 1; i >= 0; i--) {
      const t = symbolTicks[i];
      const tMs = isoToMs(t.time);
      if (tMs < currentMinuteStartMs) break;
      if (tMs <= evalTimeMs && isRth(t)) {
        formingMinuteVol += (t.volume ?? 1.0);
        maxHigh = Math.max(maxHigh, t.price);
        minLow = Math.min(minLow, t.price);
        lastBarClose = t.price;
      }
    }
  } else if (!isSynthetic && tick.price) {
    lastBarClose = tick.price;
    maxHigh = Math.max(maxHigh, tick.price);
    minLow = Math.min(minLow, tick.price);
    formingMinuteVol = tick.volume ?? 1.0;
  }

  return { completedVol, maxHigh, minLow, lastBarClose, firstBarOpen, foundAny, formingMinuteVol };
}

/** The NEW path, composed exactly as subscriber 6 composes it: memo per (bucket, evalTime), then the
 *  O(1) tick-dependent fallback applied per tick. */
function candidatePerTick(
  batch: any[],
  masterData: any[],
  symbolTicks: any[] | undefined,
  currentTime: number | null,
  isSynthetic: boolean,
  ticker: string,
) {
  const out: any[] = [];
  let dailyAggKey: string | null = null;
  let dailyAgg: DailyBucketAggregate | null = null;
  const dailyIndexRef = { current: null as any };
  for (const tick of batch) {
    const tickTimeMs = isoToMs(tick.time);
    const bucketTime = getBucketTime(tickTimeMs, '1D');
    const evalTimeMs = currentTime && currentTime > tickTimeMs ? currentTime : tickTimeMs;
    const aggKey = `${bucketTime}|${evalTimeMs}|${isSynthetic ? 1 : 0}`;
    if (dailyAgg === null || dailyAggKey !== aggKey) {
      dailyAgg = aggregateDailyBucket(dailyIndexRef, masterData, SYM, ticker, bucketTime, evalTimeMs, isSynthetic, symbolTicks);
      dailyAggKey = aggKey;
    }
    const agg = dailyAgg;
    const tickVol = tick.volume !== undefined && tick.volume !== null ? tick.volume : 1.0;
    const { maxHigh, minLow, lastBarClose, formingMinuteVol } =
      applyDailyTickFallback(agg, tick, tickVol, symbolTicks, isSynthetic);
    out.push({
      completedVol: agg.completedVol,
      maxHigh, minLow, lastBarClose,
      firstBarOpen: agg.firstBarOpen,
      foundAny: agg.foundAny,
      formingMinuteVol,
    });
  }
  return out;
}

describe('1D daily-bucket aggregation: equivalence with the original per-tick code', () => {
  it('matches the original per-tick values across seeded random batches', () => {
    let compared = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const rng = makeRng(seed * 7919);
      const { masterData, ticks } = buildFixture(rng);
      const index = buildDailyIndex(masterData, SYM, TICKER, '1D');
      const isSynthetic = seed % 5 === 0;
      // Half the trials use the real tape; the rest an empty symbol-tick list (fallback path).
      const symbolTicks = seed % 4 === 0 ? [] : ticks;

      // Pick an evaluation point inside the session, then a batch of ticks at or before it.
      let evalPoint = RTH_START_MS + Math.floor(rng() * (RTH_END_MS - RTH_START_MS));
      // Exact minute boundaries are where a completed bar and a forming bar are separated by a
      // single millisecond comparison (barMs + 60000 vs evalTime). Random ms almost never hits them.
      if (rng() < 0.4) evalPoint = Math.floor(evalPoint / 60000) * 60000;
      const eligible = ticks.filter((t) => isoToMs(t.time) <= evalPoint && isoToMs(t.time) >= RTH_START_MS);
      if (eligible.length === 0) continue;
      const batchLen = Math.min(eligible.length, 1 + Math.floor(rng() * 25));
      const batch = eligible.slice(eligible.length - batchLen);
      const currentTime = evalPoint;

      const expected = batch.map((tick) =>
        referencePerTick(tick, index, symbolTicks, currentTime, isSynthetic, TICKER));
      const actual = candidatePerTick(batch, masterData, symbolTicks, currentTime, isSynthetic, TICKER);

      expect(actual, `seed ${seed}`).toEqual(expected);
      compared += batch.length;
    }
    // Guard against the test passing vacuously because every trial was skipped.
    expect(compared).toBeGreaterThan(200);
  }, 60_000);

  it('covers the forming-minute and completed-bar branches, not just one of them', () => {
    const rng = makeRng(42);
    const { masterData, ticks } = buildFixture(rng);
    const evalPoint = RTH_START_MS + 3 * 3600000 + 17 * 60000 + 30000;
    const batch = ticks.filter((t) => isoToMs(t.time) <= evalPoint && isoToMs(t.time) >= RTH_START_MS).slice(-40);
    const rows = candidatePerTick(batch, masterData, ticks, evalPoint, false, TICKER);
    // A forming minute with real ticks must contribute volume; a completed bucket must too.
    expect(rows.some((r) => r.formingMinuteVol > 0)).toBe(true);
    expect(rows.some((r) => r.completedVol > 0)).toBe(true);
    expect(rows.some((r) => r.foundAny)).toBe(true);
  });
});

describe('1D daily-bucket aggregation: locality of the forming-minute scan', () => {
  it('never reads a tick that is later than the evaluation time', () => {
    const rng = makeRng(7);
    const { masterData, ticks } = buildFixture(rng);
    // Evaluate early in the session so that almost the whole tape is in the future.
    const evalPoint = RTH_START_MS + 20 * 60000 + 5000;
    const evalIdx = ticks.findIndex((t) => isoToMs(t.time) > evalPoint) - 1;
    expect(evalIdx).toBeGreaterThan(0);
    expect(ticks.length - evalIdx).toBeGreaterThan(1000);

    let reads = 0;
    let futureReads = 0;
    const counted = new Proxy(ticks, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const i = Number(prop);
          reads++;
          if (i > evalIdx) futureReads++;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    aggregateDailyBucket(
      { current: null } as any, masterData, SYM, TICKER,
      getBucketTime(evalPoint, '1D'), evalPoint, false, counted as any,
    );

    // A binary search probes O(log N) indices, some above the cut point; that is unavoidable and
    // cheap. The regression was a LINEAR walk from the end of the tape, which read every future
    // tick (~N - evalIdx of them). The bound separates the two by orders of magnitude.
    expect(futureReads).toBeLessThanOrEqual(Math.ceil(Math.log2(ticks.length)) + 2);
    expect(reads).toBeLessThan(200);
  });
});

describe('1D daily-bucket aggregation: fallbacks that random fixtures rarely reach', () => {
  it('a synthetic tick before any bar in its bucket falls back to its own price', () => {
    const rng = makeRng(3);
    const { masterData } = buildFixture(rng);
    // Before the session: no bar in this bucket is at or before the evaluation time.
    const evalPoint = RTH_START_MS - 10 * 60000;
    const tick = { time: fmt(evalPoint), price: 123.45, volume: 9, symbol: SYM, session: 'PRE' };
    const rows = candidatePerTick([tick], masterData, [], evalPoint, true, TICKER);
    const ref = referencePerTick(tick, buildDailyIndex(masterData, SYM, TICKER, '1D'), [], evalPoint, true, TICKER);
    expect(ref.foundAny).toBe(false);
    expect(rows[0].lastBarClose).toBe(123.45);
    expect(rows).toEqual([ref].map((r) => ({ ...r, lastBarClose: r.lastBarClose ?? tick.price })));
  });

  it('a forming bar exactly one minute old is completed, not forming (boundary at evalTime)', () => {
    // Single bar 13:30 with a distinct close; evaluation exactly at 13:31:00.000 means
    // barMs + 60000 === evalTime, so the bar is COMPLETE and its volume must be counted.
    const bar = { time: fmt(RTH_START_MS).slice(0, 19), open: 100, high: 105, low: 99, close: 104,
      volume: 777, symbol: SYM, session: 'REG' };
    const evalPoint = RTH_START_MS + 60000;
    const tick = { time: fmt(evalPoint), price: 104, volume: 1, symbol: SYM, session: 'REG' };
    const ref = referencePerTick(tick, buildDailyIndex([bar], SYM, TICKER, '1D'), [], evalPoint, false, TICKER);
    const rows = candidatePerTick([tick], [bar], [], evalPoint, false, TICKER);
    expect(ref.completedVol).toBe(777);
    expect(rows[0].completedVol).toBe(777);
    expect(rows[0].maxHigh).toBe(ref.maxHigh);
    expect(rows[0].lastBarClose).toBe(ref.lastBarClose);
  });
})
