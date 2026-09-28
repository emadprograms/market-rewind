import { describe, it, expect } from 'vitest';
import { getSessionType } from '../../src/lib/SessionShading';
import { getBucketTimestamp, applyTickToCandles } from '../../src/lib/candleSynthesizer';
import { buildCandleFromTickSlice } from '../../src/lib/tickSynthesizer';
import { resampleData } from '../../src/lib/resampling';
import type { RawBar, MarketTick } from '../../src/types';

describe('Chart Integrity Unit Tests: X-Axis, Shading, and Opening Price', () => {

  describe('1. Session Shading (SessionShading.ts)', () => {
    it('accurately identifies RTH, PRE, and POST given UTC timestamps for America/New_York', () => {
      // 2026-09-25 is EDT (UTC-4)
      // 09:30 AM ET market open = 13:30:00 UTC = 1790343000
      const openUtcSec = 1790343000;
      expect(getSessionType(openUtcSec)).toBe('RTH');

      // 09:29 AM ET pre-market = 13:29:00 UTC = 1790342940
      const preMarketUtcSec = 1790342940;
      expect(getSessionType(preMarketUtcSec)).toBe('PRE');

      // 04:00 PM ET market close = 20:00:00 UTC = 1790366400
      const postMarketUtcSec = 1790366400;
      expect(getSessionType(postMarketUtcSec)).toBe('POST');

      // 03:00 AM ET overnight = 07:00:00 UTC = 1790319600
      const overnightUtcSec = 1790319600;
      expect(getSessionType(overnightUtcSec)).toBe('OTHER');
    });
  });

  describe('2. X-Axis and Candle Bucket Timestamps (candleSynthesizer.ts)', () => {
    it('produces UTC bucket timestamps that align with America/New_York market hours', () => {
      // 13:30:00 UTC corresponds to 09:30:00 ET
      const targetUtcMs = new Date('2026-09-25T13:30:00.000Z').getTime();
      const bucket1m = getBucketTimestamp(targetUtcMs, '1min');

      expect(bucket1m).toBe('2026-09-25 13:30:00');

      // Daily bucket timestamp should have the date 2026-09-25
      const bucket1D = getBucketTimestamp(targetUtcMs, '1D');
      expect(bucket1D).toBe('2026-09-25 12:00:00');
    });
  });

  describe('3. Replay Candle Synthesis & Opening Price (tickSynthesizer.ts)', () => {
    it('builds a candle whose open price matches the first tick of the session', () => {
      const ticks: MarketTick[] = [
        { time: '2026-09-25 13:30:00.020', symbol: 'SPY', price: 768.47, volume: 100, session: 'REG' },
        { time: '2026-09-25 13:30:00.150', symbol: 'SPY', price: 768.80, volume: 200, session: 'REG' },
        { time: '2026-09-25 13:30:01.000', symbol: 'SPY', price: 768.10, volume: 50, session: 'REG' },
      ];

      const candle = buildCandleFromTickSlice(ticks, 0, ticks.length - 1, '2026-09-25 13:30:00', 'REG');
      expect(candle).not.toBeNull();
      // Open price MUST be the price of the first tick (768.47)
      expect(candle!.open).toBe(768.47);
      // High price MUST be max price (768.80)
      expect(candle!.high).toBe(768.80);
      // Low price MUST be min price (768.10)
      expect(candle!.low).toBe(768.10);
      // Close price MUST be last tick (768.10)
      expect(candle!.close).toBe(768.10);
      // Volume MUST be sum (350)
      expect(candle!.volume).toBe(350);
    });
  });

  describe('4. Daily Resampling (resampling.ts)', () => {
    it('resamples intraday candles into daily bars using strictly RTH hours (excluding PRE and POST)', () => {
      const bars: RawBar[] = [
        { time: '2026-09-25 12:00:00', open: 765.0, high: 766.0, low: 764.0, close: 765.5, volume: 500, session: 'PRE' },
        { time: '2026-09-25 13:30:00', open: 768.5, high: 770.0, low: 768.0, close: 769.0, volume: 1000, session: 'REG' },
        { time: '2026-09-25 19:59:00', open: 771.5, high: 772.0, low: 771.0, close: 772.0, volume: 2000, session: 'POST' },
      ];

      const daily = resampleData(bars, '1D');
      expect(daily).toHaveLength(1);
      expect(daily[0].time).toBe('2026-09-25 12:00:00');
      // Strictly reflects RTH hours (REG session):
      expect(daily[0].open).toBe(768.5);
      expect(daily[0].high).toBe(770.0);
      expect(daily[0].low).toBe(768.0);
      expect(daily[0].close).toBe(769.0);
      expect(daily[0].volume).toBe(1000);
      expect(daily[0].session).toBe('REG');
    });
  });
});
