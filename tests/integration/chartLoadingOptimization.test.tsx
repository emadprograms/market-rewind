import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartData } from '../../src/hooks/useChartData';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { streamingClient } from '../../src/lib/streamingClient';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import { mockChart } from '../helpers/chart-simulation';

vi.mock('../../src/lib/streamingClient', () => ({
  streamingClient: {
    getCandles: vi.fn(),
    getTicks: vi.fn(),
  },
}));

vi.mock('../../src/hooks/chart/useChartInit', () => ({
  useChartInit: vi.fn(() => ({
    chartRef: { current: mockChart },
    priceSeriesRef: {
      current: {
        setData: vi.fn(),
        update: vi.fn(),
        applyOptions: vi.fn(),
        createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
        removePriceLine: vi.fn(),
      },
    },
    volumeSeriesRef: {
      current: {
        setData: vi.fn(),
        update: vi.fn(),
        applyOptions: vi.fn(),
        priceScale: () => ({ applyOptions: vi.fn() }),
      },
    },
    lastBarSpacingRef: { current: null },
  })),
}));

vi.mock('../../src/hooks/chart/useChartPlugins', () => ({
  useChartPlugins: vi.fn(() => ({
    shadingPluginRef: { current: null },
    vpPluginRef: { current: null },
    rayPluginRef: { current: null },
    rectPluginRef: { current: null },
    tradePluginRef: { current: null },
    updateShadingConfig: vi.fn(),
    pluginVersion: 0,
  })),
}));

describe('TDD: Chart Loading Optimizations (De-duplication, Limits, and Hydration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
    useWorkspaceStore.setState({
      tickers: { '0': 'TSLA', '1': 'TSLA' },
      timeframes: { '0': '5min', '1': '1D' },
      groups: { '0': 'none', '1': 'none' },
      groupTickers: {},
    });
    vi.mocked(streamingClient.getCandles).mockResolvedValue([]);
    vi.mocked(streamingClient.getTicks).mockResolvedValue([]);
  });

  it('bounds initial candle fetch limit to <= 2000 bars instead of over-fetching 10,000', async () => {
    const chartRef = { current: null };
    const priceSeriesRef = { current: null };

    renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '5min',
        initialEth: false,
        selectedDate: '2026-09-08',
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: chartRef as any,
        priceSeriesRef: priceSeriesRef as any,
        id: 0,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(streamingClient.getCandles).toHaveBeenCalled();
    const calls = vi.mocked(streamingClient.getCandles).mock.calls;
    const initialCallOpts = calls[0][1];
    expect(initialCallOpts?.limit).toBeDefined();
    expect(initialCallOpts?.limit).toBeLessThanOrEqual(2000);
  });

  it('does NOT fire duplicate 100k-tick fetches when mounting two charts for the same ticker', async () => {
    const chartRef0 = { current: null };
    const priceSeriesRef0 = { current: null };
    const chartRef1 = { current: null };
    const priceSeriesRef1 = { current: null };

    // Mount Chart 0
    renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '5min',
        initialEth: false,
        selectedDate: '2026-09-08',
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: chartRef0 as any,
        priceSeriesRef: priceSeriesRef0 as any,
        id: 0,
      })
    );

    // Mount Chart 1
    renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '1D',
        initialEth: false,
        selectedDate: '2026-09-08',
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: chartRef1 as any,
        priceSeriesRef: priceSeriesRef1 as any,
        id: 1,
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should NOT have called getTicks twice simultaneously for TSLA
    const tslaTickCalls = vi.mocked(streamingClient.getTicks).mock.calls.filter(
      (call) => call[0] === 'TSLA'
    );
    expect(tslaTickCalls.length).toBeLessThanOrEqual(1);
  });

  it('sets isHydrated to true after loading completes even if chartData is empty to prevent canvas blackout', async () => {
    const containerRef = { current: document.createElement('div') };
    const chartRef = { current: mockChart as any };
    const priceSeriesRef = { current: null as any };
    const pendingHistoryPrependRef = { current: null };

    const { result, rerender } = renderHook(
      (props) =>
        useChartLifecycle({
          chartContainerRef: containerRef,
          ticker: 'TSLA',
          timeframe: '1D',
          showEth: false,
          showVP: false,
          chartData: props.chartData,
          localMasterData: props.chartData,
          isLoadingHistory: props.isLoadingHistory,
          pendingHistoryPrependRef,
          isDrawingMode: false,
          drawType: 'ray',
          rectAnchor: null,
          setRectAnchor: vi.fn(),
          ghostPoint: null,
          setGhostPoint: vi.fn(),
          drawings: { rays: [], rects: [] },
          onUpdateDrawings: vi.fn(),
          chartRef,
          priceSeriesRef,
        }),
      {
        initialProps: { chartData: [], isLoadingHistory: true },
      }
    );

    expect(result.current.isHydrated).toBe(false);

    // Loading finishes with 0 bars
    rerender({ chartData: [], isLoadingHistory: false });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Canvas must be hydrated so the canvas is visible and not blacked out
    expect(result.current.isHydrated).toBe(true);
  });
});
