import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartData } from '../../src/hooks/useChartData';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { streamingClient } from '../../src/lib/streamingClient';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import type { RawBar, MarketTick } from '../../src/types';
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
    priceSeriesRef: { current: { setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(), createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })), removePriceLine: vi.fn() } },
    volumeSeriesRef: { current: { setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) } },
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

describe('Phase 19: Decoupled Playback State & O(1) Incremental Chart Updates', () => {
  const baseBars: RawBar[] = [
    { time: '2026-09-01 09:30:00', open: 100, high: 102, low: 99, close: 101, volume: 500, session: 'REG' },
    { time: '2026-09-01 09:31:00', open: 101, high: 103, low: 100, close: 102, volume: 600, session: 'REG' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState({
      currentTime: new Date('2026-09-01T09:31:00Z').getTime(),
      isPaused: true,
      masterData: baseBars,
      latestTickBySymbol: {},
      ticksBySymbol: {},
      currentTick: null,
    });
    useWorkspaceStore.setState({
      tickers: { '1': 'AAPL' },
      timeframes: { '1': '1min' },
      groups: { '1': 'none' },
      groupTickers: {},
    });
    vi.mocked(streamingClient.getCandles).mockResolvedValue(baseBars);
  });

  it('PERF-01: does not trigger React re-renders in useChartData during active playback (isPaused=false)', async () => {
    let renderCount = 0;
    const chartRef = { current: null };
    const priceSeriesRef = { current: null };

    const { result } = renderHook(() => {
      renderCount++;
      return useChartData({
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
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    const initialRenderCount = renderCount;

    // Simulate switching to active playback
    act(() => {
      usePlaybackStore.setState({ isPaused: false });
    });

    const activePlayRenderCount = renderCount;

    // Dispatch 20 high-frequency ticks while playing
    act(() => {
      for (let i = 0; i < 20; i++) {
        const tickTime = new Date('2026-09-01T09:31:00Z').getTime() + i * 100;
        const tick: MarketTick = {
          time: new Date(tickTime).toISOString().replace('T', ' ').slice(0, 19),
          symbol: 'AAPL',
          price: 102 + i * 0.1,
          volume: 10,
          session: 'REG',
        };
        usePlaybackStore.setState({
          currentTime: tickTime,
          currentTick: tick,
          latestTickBySymbol: { AAPL: tick },
        });
      }
    });

    // During active playback, zero additional React renders should have fired!
    expect(renderCount).toBe(activePlayRenderCount);

    // Pausing should resync once
    act(() => {
      usePlaybackStore.setState({ isPaused: true });
    });

    expect(renderCount).toBeGreaterThan(activePlayRenderCount);
  });

  it('PERF-02 & PERF-04: updates lightweight-charts series directly in O(1) on live ticks without setData', async () => {
    const { useChartInit } = await import('../../src/hooks/chart/useChartInit');
    const initMock = vi.mocked(useChartInit);

    const mockPriceSeries = {
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
      removePriceLine: vi.fn(),
    };
    const mockVolumeSeries = {
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      priceScale: () => ({ applyOptions: vi.fn() }),
    };

    initMock.mockReturnValue({
      chartRef: { current: mockChart as any },
      priceSeriesRef: { current: mockPriceSeries as any },
      volumeSeriesRef: { current: mockVolumeSeries as any },
      lastBarSpacingRef: { current: null },
    });

    const containerRef = { current: document.createElement('div') };
    const chartRef = { current: mockChart as any };
    const priceSeriesRef = { current: mockPriceSeries as any };
    const pendingHistoryPrependRef = { current: null };

    renderHook(() =>
      useChartLifecycle({
        chartContainerRef: containerRef,
        ticker: 'AAPL',
        timeframe: '1min',
        showEth: false,
        showVP: false,
        chartData: baseBars,
        localMasterData: baseBars,
        isLoadingHistory: false,
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
      })
    );

    // Initial load calls setData once
    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
    expect(mockPriceSeries.update).toHaveBeenCalledTimes(0);

    // Wait for rAF hydration
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Switch to playing
    act(() => {
      usePlaybackStore.setState({ isPaused: false });
    });

    // Dispatch a tick within the same bucket (9:31)
    act(() => {
      const tick: MarketTick = {
        time: '2026-09-01 09:31:15',
        symbol: 'AAPL',
        price: 104.5, // new high
        volume: 25,
        session: 'REG',
      };
      usePlaybackStore.setState({
        currentTime: new Date('2026-09-01T09:31:15Z').getTime(),
        currentTick: tick,
        latestTickBySymbol: { AAPL: tick },
      });
    });

    // Direct O(1) update should have been called!
    expect(mockPriceSeries.update).toHaveBeenCalledTimes(1);
    expect(mockPriceSeries.update).toHaveBeenCalledWith(
      expect.objectContaining({
        high: 104.5,
        close: 104.5,
      })
    );
    // setData was NOT called again during the tick
    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);

    // Dispatch a tick into a NEW bucket (9:32) - PERF-04
    act(() => {
      const tick2: MarketTick = {
        time: '2026-09-01 09:32:05',
        symbol: 'AAPL',
        price: 105.0,
        volume: 30,
        session: 'REG',
      };
      usePlaybackStore.setState({
        currentTime: new Date('2026-09-01T09:32:05Z').getTime(),
        currentTick: tick2,
        latestTickBySymbol: { AAPL: tick2 },
      });
    });

    // Update called for the new bucket
    expect(mockPriceSeries.update).toHaveBeenCalledTimes(2);
    expect(mockPriceSeries.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: 105.0,
        high: 105.0,
        close: 105.0,
      })
    );
    // Still no setData called!
    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
  });
});
