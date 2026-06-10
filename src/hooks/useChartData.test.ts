import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChartData } from './useChartData';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { fetchMarketData } from '../lib/db';

// Mock the entire db module BEFORE importing anything that might use it
vi.mock('../lib/db', () => ({
  fetchMarketData: vi.fn(),
  fetchHistoricalChunk: vi.fn(),
  initDB: vi.fn(),
  loadDatabaseFromFile: vi.fn(),
  fetchTickers: vi.fn(),
  isDBLoaded: vi.fn(),
}));

// Mock stores
vi.mock('../store/usePlaybackStore');
vi.mock('../store/useWorkspaceStore');

describe('useChartData Hybrid Caching', () => {
  const mockParams = {
    initialTicker: 'AAPL',
    initialTf: '5min',
    initialEth: false,
    selectedDate: '2024-01-01',
    isReplayMode: true,
    groupColor: 'blue',
    tickers: ['AAPL'],
    chartRef: { current: null },
    priceSeriesRef: { current: null },
    id: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    (useWorkspaceStore as any).getState = () => ({
      tickers: { '1': 'AAPL' },
      groups: { '1': 'none' },
      groupTickers: {},
      setTicker: vi.fn(),
    });
    (useWorkspaceStore as any).mockReturnValue('AAPL');
    
    (usePlaybackStore as any).mockImplementation((selector: any) => selector({ currentTime: 0 }));
    
    (fetchMarketData as any).mockResolvedValue([
      { time: '2024-01-01 10:00:00', open: 100, high: 105, low: 95, close: 102, volume: 10, session: 'REG' },
      { time: '2024-01-01 10:01:00', open: 102, high: 106, low: 101, close: 104, volume: 15, session: 'REG' },
      { time: '2024-01-01 10:02:00', open: 104, high: 108, low: 103, close: 107, volume: 12, session: 'REG' },
      { time: '2024-01-01 10:03:00', open: 107, high: 110, low: 106, close: 109, volume: 8, session: 'REG' },
      { time: '2024-01-01 10:04:00', open: 109, high: 112, low: 108, close: 111, volume: 20, session: 'REG' },
      { time: '2024-01-01 10:05:00', open: 111, high: 115, low: 110, close: 114, volume: 10, session: 'REG' },
    ]);
  });

  it('should maintain immutability of closed candles when globalTime advances', async () => {
    (usePlaybackStore as any).mockImplementation((selector: any) => selector({ currentTime: new Date('2024-01-01T10:04:00Z').getTime() }));
    
    const { result } = renderHook(() => useChartData(mockParams));
    
    await vi.waitFor(() => expect(result.current.chartData).toHaveLength(1));
    
    const firstCandle = { ...result.current.chartData[0] };
    
    (usePlaybackStore as any).mockImplementation((selector: any) => selector({ currentTime: new Date('2024-01-01T10:06:00Z').getTime() }));
    
    // Force update by triggering a state change that affects useMemo
    result.current.setTimeframe('5min'); 
    
    const updatedCandles = result.current.chartData;
    expect(updatedCandles[0]).toEqual(firstCandle);
    expect(updatedCandles).toHaveLength(2);
  });

  it('should update the most recent (open) candle as new bars are added', async () => {
    (usePlaybackStore as any).mockImplementation((selector: any) => selector({ currentTime: new Date('2024-01-01T10:01:00Z').getTime() }));
    
    const { result } = renderHook(() => useChartData(mockParams));
    await vi.waitFor(() => expect(result.current.chartData).toHaveLength(1));
    
    const candleAtT1 = result.current.chartData[0].close;
    
    (usePlaybackStore as any).mockImplementation((selector: any) => selector({ currentTime: new Date('2024-01-01T10:02:00Z').getTime() }));
    
    result.current.setTimeframe('5min'); 
    
    const candleAtT2 = result.current.chartData[0].close;
    expect(candleAtT2).not.toBe(candleAtT1);
  });

  it('should purge cache when timeframe changes', async () => {
    (usePlaybackStore as any).mockImplementation((selector: any) => selector({ currentTime: new Date('2024-01-01T10:06:00Z').getTime() }));
    const { result } = renderHook(() => useChartData(mockParams));
    await vi.waitFor(() => expect(result.current.chartData).toHaveLength(2));
    
    result.current.setTimeframe('15min');
    
    await vi.waitFor(() => expect(result.current.chartData).toHaveLength(1));
  });
});
