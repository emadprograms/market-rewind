import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import type { RawBar, MarketTick } from '../../src/types';
import { mockChart } from '../helpers/chart-simulation';

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

describe('Bid and Ask Price Lines on Chart Y-Axis', () => {
  const baseBars: RawBar[] = [
    { time: '2026-09-01 09:30:00', open: 150.0, high: 151.0, low: 149.5, close: 150.5, volume: 500, session: 'REG' },
    { time: '2026-09-01 09:31:00', open: 150.5, high: 152.0, low: 150.0, close: 151.0, volume: 600, session: 'REG' },
  ];

  let mockBidPriceLine: { applyOptions: any };
  let mockAskPriceLine: { applyOptions: any };
  let mockPriceSeries: any;
  let chartInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockBidPriceLine = { applyOptions: vi.fn() };
    mockAskPriceLine = { applyOptions: vi.fn() };

    mockPriceSeries = {
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      createPriceLine: vi.fn((opts: any) => {
        if (opts.title === 'Bid') return mockBidPriceLine;
        if (opts.title === 'Ask') return mockAskPriceLine;
        return { applyOptions: vi.fn() };
      }),
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

    chartInstance = {
      ...mockChart,
      timeScale: vi.fn().mockReturnValue(mockTimeScale),
      priceScale: vi.fn().mockReturnValue({ applyOptions: vi.fn() }),
    };

    const { useChartInit } = await import('../../src/hooks/chart/useChartInit');
    vi.mocked(useChartInit).mockReturnValue({
      chartRef: { current: chartInstance as any },
      priceSeriesRef: { current: mockPriceSeries as any },
      volumeSeriesRef: { current: mockVolumeSeries as any },
      lastBarSpacingRef: { current: null },
    });

    usePlaybackStore.setState({
      currentTime: new Date('2026-09-01T09:31:00Z').getTime(),
      isPaused: true,
      masterData: baseBars,
      latestTickBySymbol: {},
      ticksBySymbol: {},
      currentTick: null,
    });
  });

  it('creates both Bid and Ask price lines with correct colors, titles and y-axis labels on chart hydration', () => {
    const chartContainerRef = { current: document.createElement('div') };

    const chartRef = { current: chartInstance as any };
    const priceSeriesRef = { current: mockPriceSeries as any };
    const pendingHistoryPrependRef = { current: null };

    renderHook(() =>
      useChartLifecycle({
        chartContainerRef,
        ticker: 'AAPL',
        timeframe: '1m',
        showEth: false,
        showVP: false,
        chartData: baseBars,
        localMasterData: baseBars,
        isLoadingHistory: false,
        pendingHistoryPrependRef,
        drawings: {},
        isDrawingMode: false,
        chartRef,
        priceSeriesRef,
      })
    );

    // Verify Bid line creation options
    expect(mockPriceSeries.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Bid',
        color: '#2196f3',
        axisLabelVisible: true,
        axisLabelColor: '#2196f3',
        axisLabelTextColor: '#ffffff',
      })
    );

    // Verify Ask line creation options
    expect(mockPriceSeries.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ask',
        color: '#ef5350',
        axisLabelVisible: true,
        axisLabelColor: '#ef5350',
        axisLabelTextColor: '#ffffff',
      })
    );

    // Verify Live price line is NOT created
    expect(mockPriceSeries.createPriceLine).not.toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Live',
      })
    );
  });

  it('updates Bid and Ask price lines on active playback ticks with exact bid/ask quotes', async () => {
    const chartContainerRef = { current: document.createElement('div') };

    const chartRef = { current: chartInstance as any };
    const priceSeriesRef = { current: mockPriceSeries as any };
    const pendingHistoryPrependRef = { current: null };

    renderHook(() =>
      useChartLifecycle({
        chartContainerRef,
        ticker: 'AAPL',
        timeframe: '1m',
        showEth: false,
        showVP: false,
        chartData: baseBars,
        localMasterData: baseBars,
        isLoadingHistory: false,
        pendingHistoryPrependRef,
        drawings: {},
        isDrawingMode: false,
        chartRef,
        priceSeriesRef,
      })
    );

    // Wait for rAF hydration
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Switch to playing
    act(() => {
      usePlaybackStore.setState({ isPaused: false });
    });

    // Dispatch tick with explicit bid and ask
    act(() => {
      const tick: MarketTick = {
        time: '2026-09-01 09:31:15',
        symbol: 'AAPL',
        price: 151.25,
        bid: 151.20,
        ask: 151.30,
        volume: 50,
        session: 'REG',
      };
      usePlaybackStore.setState({
        currentTime: new Date('2026-09-01T09:31:15Z').getTime(),
        currentTick: tick,
        latestTickBySymbol: { AAPL: tick },
      });
    });

    // Both lines should be updated with exact quotes
    expect(mockBidPriceLine.applyOptions).toHaveBeenCalledWith({ price: 151.20 });
    expect(mockAskPriceLine.applyOptions).toHaveBeenCalledWith({ price: 151.30 });
  });

  it('falls back to nominal spread (+/- $0.01) if tick only provides last price', async () => {
    const chartContainerRef = { current: document.createElement('div') };

    const chartRef = { current: chartInstance as any };
    const priceSeriesRef = { current: mockPriceSeries as any };
    const pendingHistoryPrependRef = { current: null };

    renderHook(() =>
      useChartLifecycle({
        chartContainerRef,
        ticker: 'AAPL',
        timeframe: '1m',
        showEth: false,
        showVP: false,
        chartData: baseBars,
        localMasterData: baseBars,
        isLoadingHistory: false,
        pendingHistoryPrependRef,
        drawings: {},
        isDrawingMode: false,
        chartRef,
        priceSeriesRef,
      })
    );

    // Wait for rAF hydration
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    act(() => {
      usePlaybackStore.setState({ isPaused: false });
    });

    // Dispatch tick with price but no bid/ask
    act(() => {
      const tick: MarketTick = {
        time: '2026-09-01 09:31:20',
        symbol: 'AAPL',
        price: 155.0,
        volume: 10,
        session: 'REG',
      };
      usePlaybackStore.setState({
        currentTime: new Date('2026-09-01T09:31:20Z').getTime(),
        currentTick: tick,
        latestTickBySymbol: { AAPL: tick },
      });
    });

    expect(mockBidPriceLine.applyOptions).toHaveBeenCalledWith({ price: 154.99 });
    expect(mockAskPriceLine.applyOptions).toHaveBeenCalledWith({ price: 155.01 });
  });

  it('updates Bid and Ask price lines when seeking or stepping while paused', () => {
    const chartContainerRef = { current: document.createElement('div') };
    const chartRef = { current: chartInstance as any };
    const priceSeriesRef = { current: mockPriceSeries as any };
    const pendingHistoryPrependRef = { current: null };

    renderHook(() =>
      useChartLifecycle({
        chartContainerRef,
        ticker: 'AAPL',
        timeframe: '1m',
        showEth: false,
        showVP: false,
        chartData: baseBars,
        localMasterData: baseBars,
        isLoadingHistory: false,
        pendingHistoryPrependRef,
        drawings: {},
        isDrawingMode: false,
        chartRef,
        priceSeriesRef,
      })
    );

    // While paused, seek to new time with new latest tick
    act(() => {
      const tick: MarketTick = {
        time: '2026-09-01 09:31:45',
        symbol: 'AAPL',
        price: 152.5,
        bid: 152.48,
        ask: 152.52,
        volume: 20,
        session: 'REG',
      };
      usePlaybackStore.setState({
        isPaused: true,
        currentTime: new Date('2026-09-01T09:31:45Z').getTime(),
        currentTick: tick,
        latestTickBySymbol: { AAPL: tick },
      });
    });

    expect(mockBidPriceLine.applyOptions).toHaveBeenCalledWith({ price: 152.48 });
    expect(mockAskPriceLine.applyOptions).toHaveBeenCalledWith({ price: 152.52 });
  });

  it('removes Bid and Ask price lines when switching tickers', () => {
    const chartContainerRef = { current: document.createElement('div') };
    const chartRef = { current: chartInstance as any };
    const priceSeriesRef = { current: mockPriceSeries as any };
    const pendingHistoryPrependRef = { current: null };

    const { rerender } = renderHook(
      ({ ticker }) =>
        useChartLifecycle({
          chartContainerRef,
          ticker,
          timeframe: '1m',
          showEth: false,
          showVP: false,
          chartData: baseBars,
          localMasterData: baseBars,
          isLoadingHistory: false,
          pendingHistoryPrependRef,
          drawings: {},
          isDrawingMode: false,
          chartRef,
          priceSeriesRef,
        }),
      { initialProps: { ticker: 'AAPL' } }
    );

    // Switch ticker to TSLA
    rerender({ ticker: 'TSLA' });

    // removePriceLine should be called for old lines
    expect(mockPriceSeries.removePriceLine).toHaveBeenCalled();
  });

  it('does not create a "Live" price line during 1D timeframe playback or pause', async () => {
    const chartContainerRef = { current: document.createElement('div') };
    const chartRef = { current: chartInstance as any };
    const priceSeriesRef = { current: mockPriceSeries as any };
    const pendingHistoryPrependRef = { current: null };

    renderHook(() =>
      useChartLifecycle({
        chartContainerRef,
        ticker: 'AAPL',
        timeframe: '1D',
        showEth: false,
        showVP: false,
        chartData: baseBars,
        localMasterData: baseBars,
        isLoadingHistory: false,
        pendingHistoryPrependRef,
        drawings: {},
        isDrawingMode: false,
        chartRef,
        priceSeriesRef,
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Start playback and send tick
    act(() => {
      usePlaybackStore.setState({ isPaused: false });
    });

    act(() => {
      const tick: MarketTick = {
        time: '2026-09-01 13:35:00',
        symbol: 'AAPL',
        price: 155.25,
        bid: 155.20,
        ask: 155.30,
        volume: 100,
        session: 'REG',
      };
      usePlaybackStore.setState({
        currentTime: new Date('2026-09-01T13:35:00Z').getTime(),
        currentTick: tick,
        latestTickBySymbol: { AAPL: tick },
      });
    });

    // Pause playback
    act(() => {
      usePlaybackStore.setState({ isPaused: true });
    });

    // Verify 'Live' line was never created
    expect(mockPriceSeries.createPriceLine).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Live' })
    );
    // Only Bid and Ask lines exist
    expect(mockPriceSeries.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Bid' })
    );
    expect(mockPriceSeries.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ask' })
    );
  });
});
