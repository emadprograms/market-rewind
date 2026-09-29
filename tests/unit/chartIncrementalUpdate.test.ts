import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import type { RawBar } from '../../src/types';

// Create fresh mock instances for each test
const mockPriceScale = {
  applyOptions: vi.fn(),
};

const mockTimeScale = {
  setVisibleLogicalRange: vi.fn(),
  getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 100 })),
  scrollToRealTime: vi.fn(),
  subscribeVisibleLogicalRangeChange: vi.fn(),
};

const mockPriceSeries = {
  setData: vi.fn(),
  update: vi.fn(),
  applyOptions: vi.fn(),
  attachPrimitive: vi.fn(),
  data: vi.fn(() => []),
  createPriceLine: vi.fn(),
  removePriceLine: vi.fn(),
};

const mockVolumeSeries = {
  setData: vi.fn(),
  update: vi.fn(),
  applyOptions: vi.fn(),
  attachPrimitive: vi.fn(),
  priceScale: vi.fn(() => mockPriceScale),
};

const mockChart = {
  addCandlestickSeries: vi.fn(() => mockPriceSeries),
  addHistogramSeries: vi.fn(() => mockVolumeSeries),
  timeScale: vi.fn(() => mockTimeScale),
  priceScale: vi.fn(() => mockPriceScale),
  remove: vi.fn(),
  applyOptions: vi.fn(),
  subscribeClick: vi.fn(),
  unsubscribeClick: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  unsubscribeCrosshairMove: vi.fn(),
  subscribeDblClick: vi.fn(),
  unsubscribeDblClick: vi.fn(),
};

const mockVpPlugin = {
  setData: vi.fn(),
};

vi.mock('../../src/hooks/chart/useChartInit', () => ({
  useChartInit: vi.fn(() => ({
    chartRef: { current: mockChart },
    priceSeriesRef: { current: mockPriceSeries },
    volumeSeriesRef: { current: mockVolumeSeries },
    lastBarSpacingRef: { current: null },
  })),
}));

vi.mock('../../src/hooks/chart/useChartPlugins', () => ({
  useChartPlugins: vi.fn(() => ({
    shadingPluginRef: { current: null },
    vpPluginRef: { current: mockVpPlugin },
    rayPluginRef: { current: null },
    rectPluginRef: { current: null },
    tradePluginRef: { current: null },
    updateShadingConfig: vi.fn(),
    pluginVersion: 0,
  })),
}));

describe('Chart Incremental Updates (No Reload / No Shaking)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
  });

  const baseParams = {
    chartContainerRef: { current: document.createElement('div') },
    ticker: 'SPY',
    timeframe: '5min' as const,
    showEth: false,
    showVP: true,
    localMasterData: [] as RawBar[],
    isReplayMode: true,
    isLoadingHistory: false,
    pendingHistoryPrependRef: { current: null },
    isDrawingMode: false,
    drawType: 'ray' as const,
    rectAnchor: null,
    setRectAnchor: vi.fn(),
    ghostPoint: null,
    setGhostPoint: vi.fn(),
    drawings: { rays: [], rects: [] },
    onUpdateDrawings: vi.fn(),
    activeTrade: null,
    tradeBadgeRef: { current: null },
    chartRef: { current: null },
    priceSeriesRef: { current: null },
    onFocus: vi.fn(),
  };

  const initialBars: RawBar[] = [
    { time: '2024-09-29 13:30:00', open: 500.0, high: 501.0, low: 499.5, close: 500.5, volume: 1000 },
    { time: '2024-09-29 13:35:00', open: 500.5, high: 502.0, low: 500.0, close: 501.5, volume: 1200 },
    { time: '2024-09-29 13:40:00', open: 501.5, high: 502.5, low: 501.0, close: 502.0, volume: 800 },
  ];

  it('initial render calls setData once to populate chart', () => {
    renderHook(() =>
      useChartLifecycle({
        ...baseParams,
        chartData: initialBars,
      })
    );

    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
    expect(mockPriceSeries.update).not.toHaveBeenCalled();
    expect(mockPriceScale.applyOptions).toHaveBeenCalledWith({ autoScale: true });
    expect(mockVpPlugin.setData).toHaveBeenCalledTimes(1);
  });

  it('incremental tick on current candle calls update() and NOT setData()', () => {
    const { rerender } = renderHook(
      ({ chartData }) =>
        useChartLifecycle({
          ...baseParams,
          chartData,
        }),
      { initialProps: { chartData: initialBars } }
    );

    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
    mockPriceSeries.setData.mockClear();
    mockPriceScale.applyOptions.mockClear();
    mockVpPlugin.setData.mockClear();

    // New tick modifies the close/high of the last candle (13:40:00)
    const updatedBars: RawBar[] = [
      initialBars[0],
      initialBars[1],
      { ...initialBars[2], high: 503.0, close: 502.8, volume: 850 },
    ];

    rerender({ chartData: updatedBars });

    // Must call update() on the forming candle
    expect(mockPriceSeries.update).toHaveBeenCalledTimes(1);
    expect(mockPriceSeries.update).toHaveBeenCalledWith(
      expect.objectContaining({
        open: 501.5,
        high: 503.0,
        low: 501.0,
        close: 502.8,
      })
    );

    // Must NOT reload entire chart
    expect(mockPriceSeries.setData).not.toHaveBeenCalled();

    // Must NOT trigger price scale autoScale shake
    expect(mockPriceScale.applyOptions).not.toHaveBeenCalled();

    // Must NOT re-calculate entire volume profile
    expect(mockVpPlugin.setData).not.toHaveBeenCalled();
  });

  it('new candle opening calls update() for closed candle and new candle without calling setData()', () => {
    const { rerender } = renderHook(
      ({ chartData }) =>
        useChartLifecycle({
          ...baseParams,
          chartData,
        }),
      { initialProps: { chartData: initialBars } }
    );

    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
    mockPriceSeries.setData.mockClear();
    mockPriceScale.applyOptions.mockClear();
    mockVpPlugin.setData.mockClear();

    // A new candle at 13:45:00 begins
    const newBar: RawBar = {
      time: '2024-09-29 13:45:00',
      open: 502.0,
      high: 502.5,
      low: 501.8,
      close: 502.2,
      volume: 150,
    };
    const barsWithNewCandle: RawBar[] = [...initialBars, newBar];

    rerender({ chartData: barsWithNewCandle });

    // Must update closed candle (13:40:00) AND append new candle (13:45:00)
    expect(mockPriceSeries.update).toHaveBeenCalledTimes(2);
    expect(mockPriceSeries.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: 502.0,
        high: 502.5,
        low: 501.8,
        close: 502.2,
      })
    );

    // Must NOT call setData
    expect(mockPriceSeries.setData).not.toHaveBeenCalled();
    expect(mockPriceScale.applyOptions).not.toHaveBeenCalled();
    expect(mockVpPlugin.setData).not.toHaveBeenCalled();
  });

  it('multiple high-frequency incoming ticks in the same candle only invoke update()', () => {
    const { rerender } = renderHook(
      ({ chartData }) =>
        useChartLifecycle({
          ...baseParams,
          chartData,
        }),
      { initialProps: { chartData: initialBars } }
    );

    mockPriceSeries.setData.mockClear();
    mockPriceSeries.update.mockClear();
    mockPriceScale.applyOptions.mockClear();

    // Simulate 5 consecutive incoming ticks
    for (let i = 1; i <= 5; i++) {
      const tickedBars: RawBar[] = [
        initialBars[0],
        initialBars[1],
        { ...initialBars[2], close: 502.0 + i * 0.1, volume: 800 + i * 10 },
      ];
      rerender({ chartData: tickedBars });
    }

    expect(mockPriceSeries.update).toHaveBeenCalledTimes(5);
    expect(mockPriceSeries.setData).not.toHaveBeenCalled();
    expect(mockPriceScale.applyOptions).not.toHaveBeenCalled();
  });

  it('seeking backward in timeline reloads via setData() but does not shake price scale', () => {
    const { rerender } = renderHook(
      ({ chartData }) =>
        useChartLifecycle({
          ...baseParams,
          chartData,
        }),
      { initialProps: { chartData: initialBars } }
    );

    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
    mockPriceSeries.setData.mockClear();
    mockPriceScale.applyOptions.mockClear();

    // User seeks backward: only first 2 bars remain
    const seekBackwardBars: RawBar[] = [initialBars[0], initialBars[1]];

    rerender({ chartData: seekBackwardBars });

    // Since 13:40 is no longer present, setData must be used to prune
    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);

    // autoScale must NOT be re-applied on intra-session seek within the same context
    expect(mockPriceScale.applyOptions).not.toHaveBeenCalled();
  });

  it('switching timeframe or ticker cleanly triggers setData() and autoScale', () => {
    const { rerender } = renderHook(
      ({ ticker, timeframe, chartData }) =>
        useChartLifecycle({
          ...baseParams,
          ticker,
          timeframe,
          chartData,
        }),
      { initialProps: { ticker: 'SPY', timeframe: '5min' as const, chartData: initialBars } }
    );

    mockPriceSeries.setData.mockClear();
    mockPriceScale.applyOptions.mockClear();

    // Switch to QQQ (with new chartData reference)
    rerender({ ticker: 'QQQ', timeframe: '5min' as const, chartData: [...initialBars] });

    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
    expect(mockPriceScale.applyOptions).toHaveBeenCalledWith({ autoScale: true });
  });

  it('falls back gracefully to setData() if priceSeries.update() throws', () => {
    const { rerender } = renderHook(
      ({ chartData }) =>
        useChartLifecycle({
          ...baseParams,
          chartData,
        }),
      { initialProps: { chartData: initialBars } }
    );

    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
    mockPriceSeries.setData.mockClear();

    // Make update throw an error (simulating lightweight-charts timestamp order error)
    mockPriceSeries.update.mockImplementationOnce(() => {
      throw new Error('Value is not greater than or equal to the previous value.');
    });

    const updatedBars: RawBar[] = [
      initialBars[0],
      initialBars[1],
      { ...initialBars[2], close: 503.5 },
    ];

    rerender({ chartData: updatedBars });

    // Should catch and fallback to setData
    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
  });

  it('PERF-01 updates canvas directly during active playback and transitions seamlessly on pause', async () => {
    // 1. Initial render
    const { rerender } = renderHook(
      ({ chartData }) =>
        useChartLifecycle({
          ...baseParams,
          chartData,
        }),
      { initialProps: { chartData: initialBars } }
    );

    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
    mockPriceSeries.setData.mockClear();
    mockPriceSeries.update.mockClear();

    // Wait for hydration
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 2. Start playback (isPaused: false)
    act(() => {
      usePlaybackStore.getState().setPaused(false);
    });

    // 3. Emit tick for SPY
    act(() => {
      usePlaybackStore.setState({
        latestTickBySymbol: {
          SPY: {
            time: '2024-09-29 13:42:00',
            price: 503.25,
            volume: 50,
            symbol: 'SPY',
          },
        },
      });
    });

    // PERF-01 should have called update directly on canvas
    expect(mockPriceSeries.update).toHaveBeenCalled();
    expect(mockPriceSeries.setData).not.toHaveBeenCalled();

    mockPriceSeries.update.mockClear();
    mockPriceSeries.setData.mockClear();

    // 4. Pause playback (isPaused: true) and update chartData with the new tick
    act(() => {
      usePlaybackStore.getState().setPaused(true);
    });

    const postPauseBars: RawBar[] = [
      initialBars[0],
      initialBars[1],
      { ...initialBars[2], high: 503.25, close: 503.25, volume: 850 },
    ];

    rerender({ chartData: postPauseBars });

    // React render must do an incremental update and NOT call setData
    expect(mockPriceSeries.update).toHaveBeenCalled();
    expect(mockPriceSeries.setData).not.toHaveBeenCalled();
  });
});

