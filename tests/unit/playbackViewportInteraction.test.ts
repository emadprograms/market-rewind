import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import type { RawBar, MarketTick } from '../../src/types';
import { mockChart } from '../helpers/chart-simulation';

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

describe('Phase 20: Viewport Interaction & Playback Stabilization', () => {
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
  });

  it('VIEW-01: does not call syncViewport or setVisibleLogicalRange during active playback ticks', async () => {
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

    const mockTimeScale = {
      scrollToPosition: vi.fn(),
      scrollToRealTime: vi.fn(),
      getVisibleLogicalRange: vi.fn().mockReturnValue({ from: 10, to: 20 }),
      setVisibleLogicalRange: vi.fn(),
      options: vi.fn().mockReturnValue({ rightOffset: 15 }),
    };

    const chartInstance = {
      ...mockChart,
      timeScale: vi.fn().mockReturnValue(mockTimeScale),
    };

    initMock.mockReturnValue({
      chartRef: { current: chartInstance as any },
      priceSeriesRef: { current: mockPriceSeries as any },
      volumeSeriesRef: { current: mockVolumeSeries as any },
      lastBarSpacingRef: { current: null },
    });

    const containerRef = { current: document.createElement('div') };
    const chartRef = { current: chartInstance as any };
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

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Record initial setVisibleLogicalRange calls
    const initialCalls = mockTimeScale.setVisibleLogicalRange.mock.calls.length;

    // Start playback
    act(() => {
      usePlaybackStore.setState({ isPaused: false });
    });

    // Dispatch 10 ticks while playing
    act(() => {
      for (let i = 0; i < 10; i++) {
        const tick: MarketTick = {
          time: '2026-09-01 09:31:15',
          symbol: 'AAPL',
          price: 102.5 + i * 0.1,
          volume: 10,
          session: 'REG',
        };
        usePlaybackStore.setState({
          currentTime: new Date('2026-09-01T09:31:15Z').getTime() + i * 100,
          currentTick: tick,
          latestTickBySymbol: { AAPL: tick },
        });
      }
    });

    // Viewport logical range was NOT touched during playback ticks (user can pan freely!)
    expect(mockTimeScale.setVisibleLogicalRange.mock.calls.length).toBe(initialCalls);
    // Series updates happened smoothly in O(1)
    expect(mockPriceSeries.update).toHaveBeenCalledTimes(10);
  });

  it('VIEW-02: updates 1D live price line on ticks without re-rendering lifecycle', async () => {
    const { useChartInit } = await import('../../src/hooks/chart/useChartInit');
    const initMock = vi.mocked(useChartInit);

    const mockPriceLine = { applyOptions: vi.fn() };
    const mockPriceSeries = {
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      createPriceLine: vi.fn(() => mockPriceLine),
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

    let lifecycleRenderCount = 0;

    renderHook(() => {
      lifecycleRenderCount++;
      return useChartLifecycle({
        chartContainerRef: containerRef,
        ticker: 'AAPL',
        timeframe: '1D',
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
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const initialRenderCount = lifecycleRenderCount;

    // Start playback
    act(() => {
      usePlaybackStore.setState({ isPaused: false });
    });

    // Send a 1D tick (13:35 UTC is 9:35 AM ET = RTH)
    act(() => {
      const tick: MarketTick = {
        time: '2026-09-01 13:35:00',
        symbol: 'AAPL',
        price: 155.25,
        volume: 100,
        session: 'REG',
      };
      usePlaybackStore.setState({
        currentTime: new Date('2026-09-01T13:35:00Z').getTime(),
        currentTick: tick,
        latestTickBySymbol: { AAPL: tick },
      });
    });

    // Price lines were created and/or updated without 'Live' line
    expect(mockPriceSeries.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Bid' })
    );
    expect(mockPriceSeries.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ask' })
    );
    expect(mockPriceSeries.createPriceLine).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Live' })
    );
    expect(mockPriceLine.applyOptions).toHaveBeenCalled();

    // ZERO additional lifecycle renders occurred!
    expect(lifecycleRenderCount).toBe(initialRenderCount);
  });
});
