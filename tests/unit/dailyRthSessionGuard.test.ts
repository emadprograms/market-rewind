/**
 * Regression: RTH isolation of the LIVE 1D daily candle built from the 1-minute tape.
 *
 * Root cause under test (see .planning/debug/daily-1d-rth-session-leak.md):
 *   1. The tick-lake candle endpoint emits no `session` column, and the client
 *      used to default missing sessions to 'REG', so pre/post-market 1-minute
 *      tape bars were indistinguishable from regular-session bars.
 *   2. The live 1D aggregation (buildDailyIndex -> aggregateDailyBucket) trusted
 *      those labels with no RTH wall-clock window, unlike the paused/snapshot
 *      path, so extended-hours OHLCV leaked into the daily candle.
 *   3. isRthBar's suffix heuristic treated any 12:00:00 timestamp as a daily
 *      bar, which mis-preserved a real 08:00 ET premarket 1-minute bar.
 *
 * Every fixture below uses the REAL backend row shape (sessionless 1m rows),
 * which no frontend fixture previously reproduced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildDailyIndex, getBucketTime } from '../../src/lib/dailyIndex';
import { aggregateDailyBucket } from '../../src/hooks/useChartLifecycle';
import { isRthBar, isRthIntradayBar, getSessionType } from '../../src/lib/timezones';
import { isoToMs } from '../../src/store/usePlaybackStore';
import { StreamingClient } from '../../src/lib/streamingClient';

const TICKER = 'SPY';
const SYM = 'SPY';
const DAY = '2026-10-02'; // EDT: UTC-4, RTH 13:30Z..20:00Z

// Real tick-lake candle row shape (verified against TickLakeReader): no session key.
const SESSIONLESS_LAKE_ROWS = [
  { time: `${DAY} 12:00:00`, open: 10, high: 10, low: 10, close: 10, volume: 100 },  // 08:00 ET PRE
  { time: `${DAY} 13:30:00`, open: 100, high: 100, low: 100, close: 100, volume: 1 }, // 09:30 ET RTH
  { time: `${DAY} 13:31:00`, open: 110, high: 110, low: 110, close: 110, volume: 2 }, // 09:31 ET RTH
  { time: `${DAY} 20:30:00`, open: 5, high: 5, low: 5, close: 5, volume: 999 },        // 16:30 ET POST
];

// Shape after streamingClient.getCandles used to remap every row (session || 'REG').
const MISLABELED_REG_ROWS = SESSIONLESS_LAKE_ROWS.map((row) => ({
  ...row, symbol: SYM, tickCount: 1, session: 'REG',
}));

const RTH_ORACLE = { open: 100, high: 110, low: 100, close: 110, volume: 3 };
const bucketTime = getBucketTime(isoToMs(`${DAY} 13:30:00`), '1D');

describe('live 1D RTH session guard', () => {
  describe('isRthIntradayBar wall-clock gate (intraday constituent bars only)', () => {
    it('rejects premarket and postmarket equity bars and accepts RTH bars', () => {
      expect(isRthIntradayBar({ time: `${DAY} 12:00:00` }, TICKER)).toBe(false); // 08:00 ET
      expect(isRthIntradayBar({ time: `${DAY} 13:29:00` }, TICKER)).toBe(false); // 09:29 ET
      expect(isRthIntradayBar({ time: `${DAY} 13:30:00` }, TICKER)).toBe(true);  // 09:30 ET open
      expect(isRthIntradayBar({ time: `${DAY} 19:59:00` }, TICKER)).toBe(true);  // 15:59 ET
      expect(isRthIntradayBar({ time: `${DAY} 20:00:00` }, TICKER)).toBe(false); // 16:00 ET close
      expect(isRthIntradayBar({ time: `${DAY} 20:30:00` }, TICKER)).toBe(false); // 16:30 ET
    });

    it('treats UTC-listed assets as around-the-clock RTH', () => {
      expect(getSessionType(isoToMs(`${DAY} 12:00:00`) / 1000, 'BTC')).toBe('RTH');
      expect(isRthIntradayBar({ time: `${DAY} 12:00:00` }, 'BTC')).toBe(true);
      expect(isRthIntradayBar({ time: `${DAY} 23:30:00` }, 'BTC')).toBe(true);
    });
  });

  describe('buildDailyIndex on the real sessionless lake row shape', () => {
    it('indexes only regular-session bars even though rows carry no session label', () => {
      const rows = SESSIONLESS_LAKE_ROWS.map((r) => ({ ...r, symbol: SYM, tickCount: 1 }));
      const idx = buildDailyIndex(rows as any, SYM, TICKER, '1D');
      const entries = idx.byBucket.get(bucketTime)!;
      expect(entries.map((e) => e.bar.time)).toEqual([
        `${DAY} 13:30:00`,
        `${DAY} 13:31:00`,
      ]);
    });

    it('rejects extended-hours bars even when a client mislabels every row session=REG', () => {
      const idx = buildDailyIndex(MISLABELED_REG_ROWS as any, SYM, TICKER, '1D');
      expect(idx.byBucket.get(bucketTime)!.map((e) => e.bar.time)).toEqual([
        `${DAY} 13:30:00`,
        `${DAY} 13:31:00`,
      ]);
    });

    it('keeps explicit PRE/POST labels excluded and explicit REG labels included', () => {
      const labeled = SESSIONLESS_LAKE_ROWS.map((row, i) => ({
        ...row, symbol: SYM, tickCount: 1,
        session: ['PRE', 'REG', 'REG', 'POST'][i],
      }));
      const idx = buildDailyIndex(labeled as any, SYM, TICKER, '1D');
      expect(idx.byBucket.get(bucketTime)!.length).toBe(2);
    });
  });

  describe('aggregateDailyBucket end-to-end values', () => {
    const cases: Array<[string, string]> = [
      ['mid-RTH cutoff', `${DAY} 16:00:00`],   // 12:00 ET
      ['post-close cutoff', `${DAY} 21:00:00`], // 17:00 ET, after POST
    ];
    for (const [label, cutoff] of cases) {
      it(`returns RTH-only OHLCV at ${label} with sessionless rows`, () => {
        const rows = SESSIONLESS_LAKE_ROWS.map((r) => ({ ...r, symbol: SYM, tickCount: 1 }));
        const ref: { current: any } = { current: null };
        const agg = aggregateDailyBucket(
          ref, rows as any, SYM, TICKER, bucketTime, isoToMs(cutoff), true, undefined,
        );
        expect({
          open: agg.firstBarOpen,
          high: agg.maxHigh,
          low: agg.minLow,
          close: agg.lastBarClose,
          volume: agg.completedVol,
        }).toEqual(RTH_ORACLE);
      });

      it(`returns RTH-only OHLCV at ${label} with mislabeled REG rows`, () => {
        const ref: { current: any } = { current: null };
        const agg = aggregateDailyBucket(
          ref, MISLABELED_REG_ROWS as any, SYM, TICKER, bucketTime, isoToMs(cutoff), true, undefined,
        );
        expect({
          open: agg.firstBarOpen,
          high: agg.maxHigh,
          low: agg.minLow,
          close: agg.lastBarClose,
          volume: agg.completedVol,
        }).toEqual(RTH_ORACLE);
      });
    }
  });

  describe('isRthBar suffix heuristic narrowing', () => {
    it('no longer treats an intraday 12:00Z bar as a daily bar when timeframe is explicit', () => {
      // 12:00Z = 08:00 ET premarket; with an explicit intraday timeframe the
      // daily-anchor suffix shortcut must not fire.
      expect(isRthBar({ time: `${DAY} 12:00:00` }, TICKER, '1min')).toBe(false);
      expect(isRthBar({ time: `${DAY} 20:30:00` }, TICKER, '5min')).toBe(false);
      expect(isRthBar({ time: `${DAY} 13:31:00` }, TICKER, '1min')).toBe(true);
    });

    it('preserves the legacy no-timeframe behavior for anchored daily bars', () => {
      // Pinned by tests/unit/dailyRthChart.test.ts — unchanged contract.
      expect(isRthBar({ time: '2026-09-25 12:00:00' })).toBe(true);
      expect(isRthBar({ time: '2026-09-25 00:00:00' })).toBe(true);
    });
  });

  describe('streamingClient session mapping', () => {
    let client: StreamingClient;
    beforeEach(() => {
      client = new StreamingClient();
      client.setServiceUrl('http://localhost:8765');
    });
    afterEach(() => vi.restoreAllMocks());

    it('does not fabricate REG for sessionless lake candle rows', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          candles: [
            { time: `${DAY} 12:00:00`, open: 10, high: 10, low: 10, close: 10, volume: 100, tick_count: 1 },
            { time: `${DAY} 13:30:00`, open: 100, high: 100, low: 100, close: 100, volume: 1, tick_count: 1, session: 'REG' },
          ],
        }),
      } as any);

      const bars = await client.getCandles(TICKER, { timeframe: '1min' } as any);
      expect(bars[0].session).toBe('');
      expect(bars[1].session).toBe('REG');
    });
  });
});
