import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartViewport } from '../../../src/hooks/chart/useChartViewport';
import { createChartMock, mockTimeScale } from '../../helpers/chart-simulation';
import { streamingClient } from '../../../src/lib/streamingClient';

// Mock lightweight-charts
vi.mock('lightweight-charts', () => ({
  createChart: () => createChartMock(),
}));

describe('TSLA Historical Data Range & Prepend Regression Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useChartViewport Prepend Shift Correctness', () => {
    it('should correctly match oldFirstTime when given a numeric epoch timestamp (seconds)', () => {
      const initialRange = { from: 10, to: 110 };
      mockTimeScale.getVisibleLogicalRange.mockReturnValue(initialRange);

      const chartRef = { current: createChartMock() as any };
      const priceSeriesRef = { current: { data: vi.fn(() => []) } as any };
      const pendingHistoryPrependRef = { current: null as any };

      // Initial chart data: 100 bars from 2026-09-01 onwards
      // Notice: d.time in chartData is a string, e.g. "2026-09-01 09:30:00"
      // In lightweight charts, currentChartBars[0].time is numeric epoch seconds:
      const epochSeconds = Math.floor(new Date('2026-09-01T09:30:00Z').getTime() / 1000);

      // Prepend 50 bars from August 2026 before 2026-09-01
      const prependedBars = Array.from({ length: 50 }, (_, i) => ({
        time: `2026-08-${String(i + 1).padStart(2, '0')} 09:30:00`,
        open: 200, high: 205, low: 195, close: 202, volume: 1000,
      }));

      const existingBars = Array.from({ length: 100 }, (_, i) => ({
        time: i === 0 ? '2026-09-01 09:30:00' : `2026-09-01 09:${String(30 + i).padStart(2, '0')}:00`,
        open: 210, high: 215, low: 208, close: 212, volume: 1000,
      }));

      const combinedData = [...prependedBars, ...existingBars];

      pendingHistoryPrependRef.current = {
        oldFirstTime: epochSeconds, // Numeric epoch seconds as provided by priceSeries.data()[0].time
        oldLogicalRange: initialRange,
      };

      const { result } = renderHook(() =>
        useChartViewport({
          chartRef,
          priceSeriesRef,
          chartData: combinedData,
          pendingHistoryPrependRef,
        })
      );

      // Call syncViewport
      act(() => {
        result.current.syncViewport(true, initialRange);
      });

      // The newFirstIndex of '2026-09-01 09:30:00' in combinedData is 50.
      // Expected shifted logical range: from: 10 + 50 = 60, to: 110 + 50 = 160.
      expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({
        from: 60,
        to: 160,
      });
      // pendingHistoryPrependRef should be cleared
      expect(pendingHistoryPrependRef.current).toBeNull();
    });

    it('should correctly match oldFirstTime when given an ISO string format', () => {
      const initialRange = { from: 5, to: 105 };
      mockTimeScale.getVisibleLogicalRange.mockReturnValue(initialRange);

      const chartRef = { current: createChartMock() as any };
      const priceSeriesRef = { current: { data: vi.fn(() => []) } as any };
      const pendingHistoryPrependRef = { current: null as any };

      const prependedBars = Array.from({ length: 20 }, (_, i) => ({
        time: `2026-08-${String(i + 1).padStart(2, '0')} 10:00:00`,
        open: 200, high: 205, low: 195, close: 202, volume: 1000,
      }));

      const existingBars = [
        { time: '2026-09-01 09:30:00', open: 210, high: 215, low: 208, close: 212, volume: 1000 },
        { time: '2026-09-01 09:35:00', open: 212, high: 216, low: 210, close: 214, volume: 1000 },
      ];

      const combinedData = [...prependedBars, ...existingBars];

      pendingHistoryPrependRef.current = {
        oldFirstTime: '2026-09-01 09:30:00',
        oldLogicalRange: initialRange,
      };

      const { result } = renderHook(() =>
        useChartViewport({
          chartRef,
          priceSeriesRef,
          chartData: combinedData,
          pendingHistoryPrependRef,
        })
      );

      act(() => {
        result.current.syncViewport(true, initialRange);
      });

      // Shift = 20
      expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({
        from: 25,
        to: 125,
      });
    });
  });

  describe('Deduplication of History Chunks', () => {
    it('should not allow duplicate timestamps when prepending a chunk that touches the boundary candle', () => {
      const existingData = [
        { time: '2026-09-01 10:00:00', open: 210, high: 215, low: 205, close: 212, volume: 100 },
        { time: '2026-09-01 10:05:00', open: 212, high: 216, low: 210, close: 215, volume: 120 },
      ];

      // Chunk fetched with endTime = '2026-09-01 10:00:00'
      const chunk = [
        { time: '2026-09-01 09:50:00', open: 205, high: 208, low: 204, close: 207, volume: 90 },
        { time: '2026-09-01 09:55:00', open: 207, high: 210, low: 206, close: 209, volume: 95 },
        { time: '2026-09-01 10:00:00', open: 210, high: 215, low: 205, close: 212, volume: 100 }, // Duplicate!
      ];

      // Deduplication logic: chunk candles strictly before existingData[0].time
      const earliestExisting = existingData[0].time;
      const cleanChunk = chunk.filter(c => c.time < earliestExisting);
      const merged = [...cleanChunk, ...existingData];

      expect(cleanChunk.length).toBe(2);
      expect(merged.length).toBe(4);
      expect(merged.map(m => m.time)).toEqual([
        '2026-09-01 09:50:00',
        '2026-09-01 09:55:00',
        '2026-09-01 10:00:00',
        '2026-09-01 10:05:00',
      ]);
    });
  });

  describe('Deep Historical Data Accessibility', () => {
    it('should retrieve TSLA candles dating well before September 1st, 2026', async () => {
      // Query 5m candles up to Sept 8, 2026 with higher limit
      const candles = await streamingClient.getCandles('TSLA', {
        timeframe: '5min',
        endTime: '2026-09-08 23:59:59',
        limit: 15000,
      });

      expect(candles.length).toBeGreaterThan(5000);
      const earliest = candles[0].time;
      // Must reach well into 2025 or early 2026 (before September 1st, 2026)
      expect(earliest < '2026-06-01').toBe(true);
    });

    it('should retrieve TSLA 1D candles all the way back to March 2025 / Oct 2024', async () => {
      const candles = await streamingClient.getCandles('TSLA', {
        timeframe: '1D',
        endTime: '2026-09-08 23:59:59',
        limit: 5000,
      });

      expect(candles.length).toBeGreaterThan(300);
      const earliest = candles[0].time;
      expect(earliest.startsWith('2024') || earliest.startsWith('2025-03')).toBe(true);
    });
  });
});
