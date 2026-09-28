import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartData } from '../../src/hooks/useChartData';
import { streamingClient } from '../../src/lib/streamingClient';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import type { RawBar } from '../../src/types';

vi.mock('../../src/lib/streamingClient', () => ({
  streamingClient: {
    getCandles: vi.fn(),
    getTicks: vi.fn(),
  },
}));

describe('Phase 18: Single Candle Reliability & Data Load Guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState({
      currentTime: null,
      isPaused: true,
      masterData: [],
      latestTickBySymbol: {},
      ticksBySymbol: {},
    });
    useWorkspaceStore.setState({
      tickers: { '1': 'AAPL' },
      timeframes: { '1': '1min' },
      groups: { '1': 'none' },
      groupTickers: {},
    });
  });

  it('DATA-01: does not clip data when globalTime is not set and not in replay mode', async () => {
    const mockBars: RawBar[] = [
      { time: '2026-09-01 09:30:00', open: 150, high: 151, low: 149, close: 150.5, volume: 1000, session: 'REG' },
      { time: '2026-09-01 09:31:00', open: 150.5, high: 152, low: 150, close: 151.5, volume: 1200, session: 'REG' },
      { time: '2026-09-01 09:32:00', open: 151.5, high: 153, low: 151, close: 152.0, volume: 1100, session: 'REG' },
    ];
    vi.mocked(streamingClient.getCandles).mockResolvedValueOnce(mockBars);

    const chartRef = { current: null };
    const priceSeriesRef = { current: null };

    const { result } = renderHook(() =>
      useChartData({
        initialTicker: 'AAPL',
        initialTf: '1min',
        initialEth: false,
        selectedDate: '2026-09-01',
        isReplayMode: false,
        groupColor: 'none',
        tickers: ['AAPL'],
        chartRef: chartRef as any,
        priceSeriesRef: priceSeriesRef as any,
        id: 1,
      })
    );

    // Wait for async load()
    await act(async () => {
      await Promise.resolve();
    });

    // All 3 bars should be rendered because effectiveCutoff defaults to Infinity on non-replay load
    expect(result.current.chartData.length).toBe(3);
  });

  it('DATA-02: automatically retries candle query if single bar returned for multi-bar timeframe', async () => {
    const singleBar: RawBar[] = [
      { time: '2026-09-01 09:30:00', open: 150, high: 151, low: 149, close: 150.5, volume: 1000, session: 'REG' },
    ];
    const fullBars: RawBar[] = [
      { time: '2026-09-01 09:30:00', open: 150, high: 151, low: 149, close: 150.5, volume: 1000, session: 'REG' },
      { time: '2026-09-01 09:31:00', open: 150.5, high: 152, low: 150, close: 151.5, volume: 1200, session: 'REG' },
    ];

    // First call returns 1 bar, second retry call returns full bars
    vi.mocked(streamingClient.getCandles)
      .mockResolvedValueOnce(singleBar)
      .mockResolvedValueOnce(fullBars);

    const chartRef = { current: null };
    const priceSeriesRef = { current: null };

    const { result } = renderHook(() =>
      useChartData({
        initialTicker: 'AAPL',
        initialTf: '1min',
        initialEth: false,
        selectedDate: '2026-09-01',
        isReplayMode: false,
        groupColor: 'none',
        tickers: ['AAPL'],
        chartRef: chartRef as any,
        priceSeriesRef: priceSeriesRef as any,
        id: 1,
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamingClient.getCandles).toHaveBeenCalledTimes(2);
    expect(result.current.chartData.length).toBe(2);
  });

  it('DATA-04: warns when data filtering severely reduces bar count', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Provide 5 bars on 1D with past dates, but filter test
    const mockBars: RawBar[] = [
      { time: '2026-09-01 09:30:00', open: 150, high: 151, low: 149, close: 150.5, volume: 1000, session: 'REG' },
      { time: '2026-09-01 09:31:00', open: 150.5, high: 152, low: 150, close: 151.5, volume: 1200, session: 'REG' },
    ];
    vi.mocked(streamingClient.getCandles).mockResolvedValueOnce(mockBars);

    // Set cutoff to before the first bar
    usePlaybackStore.setState({
      currentTime: new Date('2026-09-01T09:30:00Z').getTime() - 10000,
    });

    const chartRef = { current: null };
    const priceSeriesRef = { current: null };

    renderHook(() =>
      useChartData({
        initialTicker: 'AAPL',
        initialTf: '1min',
        initialEth: false,
        selectedDate: '2026-09-01',
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['AAPL'],
        chartRef: chartRef as any,
        priceSeriesRef: priceSeriesRef as any,
        id: 1,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Check if diagnostic warning fired
    const diagnosticWarning = warnSpy.mock.calls.find((call) =>
      String(call[0]).includes('Diagnostic: Filtered data severely reduced')
    );
    expect(diagnosticWarning).toBeDefined();

    warnSpy.mockRestore();
  });
});
