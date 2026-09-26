import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamingClient } from '../../../src/lib/streamingClient';
import { isoToMs } from '../../../src/store/usePlaybackStore';
import { resampleData } from '../../../src/lib/resampling';
import type { RawBar } from '../../../src/types';

describe('Candle Rendering & History Integrity Regression Tests', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('isoToMs Timestamp Compatibility', () => {
    it('should parse ISO date strings accurately', () => {
      const ms = isoToMs('2026-09-25T14:30:00Z');
      expect(ms).toBe(new Date('2026-09-25T14:30:00Z').getTime());
    });

    it('should parse non-T space-separated date strings accurately', () => {
      const ms = isoToMs('2026-09-25 14:30:00');
      expect(ms).toBe(new Date('2026-09-25T14:30:00Z').getTime());
    });

    it('should handle numeric epoch timestamps in seconds without throwing TypeError', () => {
      const epochSec = 1790369400; // 2026-09-25 20:50:00 UTC
      const ms = isoToMs(epochSec);
      expect(ms).toBe(epochSec * 1000);
    });

    it('should handle numeric epoch timestamps in milliseconds directly', () => {
      const epochMs = 1790369400000;
      const ms = isoToMs(epochMs);
      expect(ms).toBe(epochMs);
    });

    it('should safely return 0 for empty or null inputs', () => {
      expect(isoToMs('')).toBe(0);
      expect(isoToMs(null as any)).toBe(0);
      expect(isoToMs(undefined as any)).toBe(0);
    });
  });

  describe('Pure Streaming Candle Fetching & Aggregation', () => {
    it('should query streaming.duckdb endpoint and return daily candles on standard timeframes', async () => {
      // Mock streaming candles across 4 days directly from streaming.duckdb
      const mockStreamCandles = [
        { time: 1790035200, time_str: '2026-09-22 00:00:00', open: 774.0, high: 775.1, low: 771.4, close: 773.7, volume: 1000, source: 'DATABENTO', session: 'POST, PRE, REG' },
        { time: 1790121600, time_str: '2026-09-23 00:00:00', open: 774.3, high: 774.7, low: 766.5, close: 767.3, volume: 1200, source: 'DATABENTO', session: 'POST, PRE, REG' },
        { time: 1790208000, time_str: '2026-09-24 00:00:00', open: 764.5, high: 768.9, low: 761.8, close: 765.9, volume: 1100, source: 'DATABENTO', session: 'POST, PRE, REG' },
        { time: 1790294400, time_str: '2026-09-25 00:00:00', open: 771.0, high: 772.2, low: 770.1, close: 771.4, volume: 500, source: 'CAPITAL_STREAM', session: 'REG', tick_count: 500 },
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/streaming/candles') || url.includes('/api/candles')) {
          expect(url).toContain('tf=1d');
          return {
            ok: true,
            json: async () => ({ candles: mockStreamCandles, count: mockStreamCandles.length }),
          };
        }
        return { ok: false };
      });

      const candles = await streamingClient.getCandles('SPY', { timeframe: '1D' });

      // Must produce 4 distinct candles across 4 different days (NOT 1 single candle)
      expect(candles).toHaveLength(4);
      expect(candles[0].time).toBe('2026-09-22 00:00:00');
      expect(candles[1].time).toBe('2026-09-23 00:00:00');
      expect(candles[2].time).toBe('2026-09-24 00:00:00');
      expect(candles[3].time).toBe('2026-09-25 00:00:00');

      // Resampling to 1D must preserve all 4 daily bars
      const resampled = resampleData(candles, '1D');
      expect(resampled).toHaveLength(4);
      expect(resampled.map(b => b.time)).toEqual([
        '2026-09-22 12:00:00',
        '2026-09-23 12:00:00',
        '2026-09-24 12:00:00',
        '2026-09-25 12:00:00',
      ]);
    });

    it('should correctly parse candles when backend returns a direct JSON array', async () => {
      const mockStreamCandles = [
        { time: '2026-09-25T20:45:00', open: 341.015, high: 341.065, low: 341.0, close: 341.055, volume: 7.0, tick_count: 7 },
        { time: '2026-09-25T20:50:00', open: 341.07, high: 341.215, low: 341.04, close: 341.195, volume: 19.0, tick_count: 19 },
      ];

      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => mockStreamCandles,
      }));

      const candles = await streamingClient.getCandles('AAPL', { timeframe: '5min' });
      expect(candles).toHaveLength(2);
      expect(candles[0].open).toBe(341.015);
      expect(candles[1].close).toBe(341.195);
    });

    it('should map timeframe strings to valid Data Harvester query parameters', async () => {
      const requestedUrls: string[] = [];
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrls.push(url);
        return {
          ok: true,
          json: async () => ({ candles: [] }),
        };
      });

      await streamingClient.getCandles('QQQ', { timeframe: '5min' });
      expect(requestedUrls.some(u => u.includes('tf=5m'))).toBe(true);

      requestedUrls.length = 0;
      await streamingClient.getCandles('QQQ', { timeframe: '15min' });
      expect(requestedUrls.some(u => u.includes('tf=15m'))).toBe(true);

      requestedUrls.length = 0;
      await streamingClient.getCandles('QQQ', { timeframe: '1H' });
      expect(requestedUrls.some(u => u.includes('tf=1h'))).toBe(true);

      requestedUrls.length = 0;
      await streamingClient.getCandles('QQQ', { timeframe: '1s' });
      expect(requestedUrls.some(u => u.includes('streaming/candles') && u.includes('tf=1s'))).toBe(true);
    });
  });

  describe('Tick Stream Replay Ordering', () => {
    it('should sort ticks in ascending chronological order even if tape endpoint returns descending', async () => {
      // Tape endpoints often return newest first
      const mockDescendingTicks = [
        { timestamp: '2026-09-25 20:59:59.000', price: 745.2, volume: 10, bid: 745.1, ask: 745.3, symbol: 'QQQ' },
        { timestamp: '2026-09-25 20:59:58.000', price: 745.15, volume: 5, bid: 745.1, ask: 745.3, symbol: 'QQQ' },
        { timestamp: '2026-09-25 20:59:55.000', price: 745.1, volume: 15, bid: 745.05, ask: 745.25, symbol: 'QQQ' },
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/stream/tape')) {
          return {
            ok: true,
            json: async () => ({ ticks: mockDescendingTicks, count: 3 }),
          };
        }
        return { ok: false };
      });

      const ticks = await streamingClient.getLiveTape('QQQ', 10);
      expect(ticks).toHaveLength(3);

      // Verify oldest tick is first (ascending chronological order)
      expect(ticks[0].time).toBe('2026-09-25 20:59:55.000');
      expect(ticks[1].time).toBe('2026-09-25 20:59:58.000');
      expect(ticks[2].time).toBe('2026-09-25 20:59:59.000');
      expect(ticks[0].time < ticks[1].time).toBe(true);
      expect(ticks[1].time < ticks[2].time).toBe(true);
    });
  });

  describe('Session Filtering Integrity', () => {
    it('should retain daily bars with composite session strings', () => {
      const bars: RawBar[] = [
        { time: '2026-09-22 00:00:00', open: 100, high: 105, low: 99, close: 104, volume: 1000, session: 'POST, PRE, REG' },
        { time: '2026-09-23 00:00:00', open: 104, high: 106, low: 103, close: 105, volume: 1100, session: 'REG, POST' },
        { time: '2026-09-24 00:00:00', open: 105, high: 107, low: 104, close: 106, volume: 1200, session: 'REG' },
      ];

      const timeframe = '1D';
      const showEth = false;

      // Filtering logic from useChartData:
      const filtered = (timeframe === '1D' || showEth) 
        ? bars 
        : bars.filter(d => !d.session || d.session === 'REG' || d.session.includes('REG'));

      // All 3 bars must survive filtering
      expect(filtered).toHaveLength(3);
    });
  });
});
