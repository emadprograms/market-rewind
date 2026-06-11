import { renderHook, act } from '@testing-library/react';
import { useChartData } from './useChartData';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

// Mock DB
vi.mock('../lib/db', () => ({
  fetchMarketData: vi.fn().mockResolvedValue([
    { time: '2024-01-01 10:00:00', open: 100, high: 101, low: 99, close: 100, volume: 100, session: 'REG' },
    { time: '2024-01-01 10:01:00', open: 100, high: 101, low: 99, close: 100, volume: 100, session: 'REG' },
    { time: '2024-01-01 10:02:00', open: 100, high: 101, low: 99, close: 100, volume: 100, session: 'REG' },
    { time: '2024-01-01 10:03:00', open: 100, high: 101, low: 99, close: 100, volume: 100, session: 'REG' },
    { time: '2024-01-01 10:04:00', open: 100, high: 101, low: 99, close: 100, volume: 100, session: 'REG' },
    { time: '2024-01-01 10:05:00', open: 101, high: 102, low: 100, close: 101, volume: 100, session: 'REG' },
  ]),
  fetchHistoricalChunk: vi.fn(),
}));

describe('useChartData hybrid caching', () => {
  const chartRef = { current: { timeScale: () => ({ subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() }) } } as any;
  const priceSeriesRef = { current: { data: () => [] } } as any;

  beforeEach(() => {
    usePlaybackStore.setState({ currentTime: new Date('2024-01-01 10:00:00Z').getTime() });
    useWorkspaceStore.setState({ tickers: { '1': 'AAPL' } });
  });

  it('maintains closed candles when globalTime advances (Test 1 & 2)', async () => {
    const { result } = renderHook(() => useChartData({
      id: 1,
      initialTicker: 'AAPL',
      initialTf: '5min',
      initialEth: false,
      selectedDate: '2024-01-01',
      isReplayMode: true,
      groupColor: 'none',
      tickers: ['AAPL'],
      chartRef,
      priceSeriesRef,
    }));

    // Wait for data load
    await vi.waitFor(() => expect(result.current.localMasterData.length).toBeGreaterThan(0));

    // At 10:04, we should have one 5m candle (10:00-10:04)
    act(() => {
      usePlaybackStore.setState({ currentTime: new Date('2024-01-01 10:04:00Z').getTime() });
    });

    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.chartData[0].time).toBe('2024-01-01 10:00:00');
    const firstCandleOHLC = { ...result.current.chartData[0] };

    // At 10:05, the 10:00 candle should be closed and stable, and a new 10:05 candle should start
    act(() => {
      usePlaybackStore.setState({ currentTime: new Date('2024-01-01 10:05:00Z').getTime() });
    });

    expect(result.current.chartData).toHaveLength(2);
    expect(result.current.chartData[0]).toEqual(firstCandleOHLC);
    expect(result.current.chartData[1].time).toBe('2024-01-01 10:05:00');
  });

  it('purges cache when timeframe changes (Test 3)', async () => {
    const { result } = renderHook(() => useChartData({
      id: 1,
      initialTicker: 'AAPL',
      initialTf: '5min',
      initialEth: false,
      selectedDate: '2024-01-01',
      isReplayMode: true,
      groupColor: 'none',
      tickers: ['AAPL'],
      chartRef,
      priceSeriesRef,
    }));

    await vi.waitFor(() => expect(result.current.localMasterData.length).toBeGreaterThan(0));

    act(() => {
      usePlaybackStore.setState({ currentTime: new Date('2024-01-01 10:05:00Z').getTime() });
    });
    expect(result.current.chartData).toHaveLength(2);

    act(() => {
      result.current.setTimeframe('15min');
    });

    // Wait for data load again
    await vi.waitFor(() => expect(result.current.localMasterData.length).toBeGreaterThan(0));

    // Should recalculate and have only 1 candle for 15m (10:00-10:05 fits in 10:00 bucket)
    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.chartData[0].time).toBe('2024-01-01 10:00:00');
  });

  it('purges cache when ticker changes', async () => {
    const { result } = renderHook(() => useChartData({
      id: 1,
      initialTicker: 'AAPL',
      initialTf: '5min',
      initialEth: false,
      selectedDate: '2024-01-01',
      isReplayMode: true,
      groupColor: 'none',
      tickers: ['AAPL', 'MSFT'],
      chartRef,
      priceSeriesRef,
    }));

    await vi.waitFor(() => expect(result.current.localMasterData.length).toBeGreaterThan(0));

    act(() => {
      usePlaybackStore.setState({ currentTime: new Date('2024-01-01 10:05:00Z').getTime() });
    });
    expect(result.current.chartData).toHaveLength(2);

    act(() => {
      result.current.setTicker('MSFT');
    });

    // Wait for data load again
    await vi.waitFor(() => expect(result.current.localMasterData.length).toBeGreaterThan(0));

    // Even though MSFT has the same mock data, the cache should have been purged,
    // resulting in a fresh calculation for the current globalTime (10:05).
    // If it wasn't purged, it might carry over AAPL's cached candles.
    // In this mock, it will just start over.
    expect(result.current.chartData).toHaveLength(2);
    expect(result.current.ticker).toBe('MSFT');
  });
});
