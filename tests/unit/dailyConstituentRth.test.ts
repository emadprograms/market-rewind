/**
 * RTH classification for the bars a daily candle is aggregated FROM.
 *
 * Root cause of the wrong 1D candle: the chart's
 * timeframe was passed as the *bar's* granularity, so `isRthBar(bar, ticker, '1D')` classified every
 * constituent 1-minute bar as an already-aggregated daily bar and exempted it from the RTH test.
 * Overnight (00:00 UTC = 20:00 ET), pre-market (12:00 UTC = 08:00 ET) and post-market minutes then
 * set the daily open/high/low and inflated the daily volume to a 24h total — while the snapshot path
 * filtered by an explicit RTH window and produced a different candle for the same day.
 *
 * These are EDT (UTC-4) timestamps; 2026-10-14 RTH is 13:30..20:00 UTC.
 */
import { describe, it, expect } from 'vitest';
import { isRthBar, isRthConstituentBar, sessionLabelFor } from '../../src/lib/timezones';
import { buildDailyIndex, getBucketTime } from '../../src/lib/dailyIndex';
import { isoToMs } from '../../src/store/usePlaybackStore';
import type { RawBar } from '../../src/types';

const bar = (time: string, session?: string, price = 250): RawBar =>
  ({ time, open: price, high: price + 1, low: price - 1, close: price, volume: 1000, session, symbol: 'TSLA' }) as RawBar;

describe('isRthConstituentBar', () => {
  it('rejects extended-hours minutes that are shaped like a daily bar', () => {
    // 00:00 UTC = 20:00 ET previous evening, 04:00 UTC = 00:00 ET, 12:00 UTC = 08:00 ET pre-market
    expect(isRthConstituentBar(bar('2026-10-14 00:00:00'), 'TSLA')).toBe(false);
    expect(isRthConstituentBar(bar('2026-10-14 04:00:00'), 'TSLA')).toBe(false);
    expect(isRthConstituentBar(bar('2026-10-14 05:00:00'), 'TSLA')).toBe(false);
    expect(isRthConstituentBar(bar('2026-10-14 12:00:00'), 'TSLA')).toBe(false);
  });

  it('accepts RTH minutes and rejects the rest of the overnight/pre/post window', () => {
    expect(isRthConstituentBar(bar('2026-10-14 08:00:00'), 'TSLA')).toBe(false); // 04:00 ET pre
    expect(isRthConstituentBar(bar('2026-10-14 13:29:00'), 'TSLA')).toBe(false); // 09:29 ET pre
    expect(isRthConstituentBar(bar('2026-10-14 13:30:00'), 'TSLA')).toBe(true); //  09:30 ET open
    expect(isRthConstituentBar(bar('2026-10-14 19:59:00'), 'TSLA')).toBe(true); //  15:59 ET
    expect(isRthConstituentBar(bar('2026-10-14 20:00:00'), 'TSLA')).toBe(false); // 16:00 ET post
    expect(isRthConstituentBar(bar('2026-10-14 23:30:00'), 'TSLA')).toBe(false); // 19:30 ET post
  });

  it('still trusts an explicit session label when the source provides one', () => {
    expect(isRthConstituentBar(bar('2026-10-14 14:00:00', 'PRE'), 'TSLA')).toBe(false);
    expect(isRthConstituentBar(bar('2026-10-14 14:00:00', 'POST'), 'TSLA')).toBe(false);
    expect(isRthConstituentBar(bar('2026-10-14 02:00:00', 'REG'), 'TSLA')).toBe(true);
  });

  it('keeps 24h instruments RTH at any hour', () => {
    expect(isRthConstituentBar(bar('2026-10-14 03:00:00'), 'BTCUSD')).toBe(true);
    expect(isRthConstituentBar(bar('2026-10-14 12:00:00'), 'BTCUSD')).toBe(true);
  });

  it('is the predicate that differs from the trap it replaces', () => {
    const preMarketMinute = bar('2026-10-14 12:00:00');
    // The old call shape exempted this bar; the constituent predicate does not.
    expect(isRthBar(preMarketMinute, 'TSLA', '1D')).toBe(true);
    expect(isRthConstituentBar(preMarketMinute, 'TSLA')).toBe(false);
  });

  it('leaves isRthBar\'s documented daily-bar contract untouched', () => {
    // Session-less daily bars must still be preserved (tests/unit/dailyRthChart.test.ts).
    expect(isRthBar({ time: '2026-09-25 12:00:00' })).toBe(true);
    expect(isRthBar({ time: '2026-09-25 00:00:00' })).toBe(true);
    expect(isRthBar({ time: '2026-09-24T00:00:00' }, 'SPY')).toBe(true);
    expect(isRthBar({ time: '2026-09-24' }, 'SPY')).toBe(true);
    // Composite daily sessions keep their REG priority.
    expect(isRthBar({ time: '2026-09-24 00:00:00', session: 'POST, PRE, REG' })).toBe(true);
    expect(isRthBar({ time: '2026-09-24 00:00:00', session: 'PRE' })).toBe(false);
  });
});

describe('sessionLabelFor', () => {
  it('derives the label synthesized ticks must carry instead of inheriting a fabricated REG', () => {
    expect(sessionLabelFor(isoToMs('2026-10-14 12:00:00'), 'TSLA')).toBe('PRE');
    expect(sessionLabelFor(isoToMs('2026-10-14 13:30:00'), 'TSLA')).toBe('REG');
    expect(sessionLabelFor(isoToMs('2026-10-14 20:30:00'), 'TSLA')).toBe('POST');
    expect(sessionLabelFor(isoToMs('2026-10-14 01:00:00'), 'TSLA')).toBe('OTHER');
    expect(sessionLabelFor(isoToMs('2026-10-14 01:00:00'), 'BTCUSD')).toBe('REG');
  });
});

describe('buildDailyIndex', () => {
  const day = '2026-10-14';
  const constituents: RawBar[] = [
    bar(`${day} 00:00:00`, undefined, 100), // overnight, previous ET evening
    bar(`${day} 08:00:00`, undefined, 110), // pre-market
    bar(`${day} 12:00:00`, undefined, 112), // pre-market, daily-shaped timestamp
    bar(`${day} 13:30:00`, undefined, 250), // RTH open
    bar(`${day} 16:00:00`, undefined, 260), // RTH
    bar(`${day} 19:59:00`, undefined, 255), // RTH close
    bar(`${day} 20:30:00`, undefined, 240), // post-market
  ];

  it('buckets only RTH constituents into the daily bar', () => {
    const index = buildDailyIndex(constituents, 'TSLA', 'TSLA', '1D');
    const bucket = index.byBucket.get(getBucketTime(isoToMs(`${day} 13:30:00`), '1D')) || [];
    expect(bucket.map((e) => e.bar.time)).toEqual([
      `${day} 13:30:00`,
      `${day} 16:00:00`,
      `${day} 19:59:00`,
    ]);
  });

  it('makes the daily open/high/low/volume RTH-only', () => {
    const index = buildDailyIndex(constituents, 'TSLA', 'TSLA', '1D');
    const bucket = index.byBucket.get(getBucketTime(isoToMs(`${day} 23:00:00`), '1D'))!;
    const open = bucket[0].bar.open;
    const high = Math.max(...bucket.map((e) => e.bar.high));
    const low = Math.min(...bucket.map((e) => e.bar.low));
    const volume = bucket.reduce((s, e) => s + e.bar.volume, 0);
    expect(open).toBe(250); // not the overnight 100
    expect(high).toBe(261); // RTH high, not 261 from ETH levels
    expect(low).toBe(249); // not the overnight 99 or post-market 239
    expect(volume).toBe(3000); // 3 RTH minutes, not 7 x 24h minutes
  });
});
