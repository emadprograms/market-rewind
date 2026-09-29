import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartData } from '../../src/hooks/useChartData';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { streamingClient } from '../../src/lib/streamingClient';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
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

describe('Multi-Chart Workspace Replay: 5min & 1D Simultaneous Loading & Playback (9:20 AM -> 9:30 AM)', () => {
  const selectedDate = '2026-09-08';
  // 9:20 AM ET = 13:20 UTC
  // 9:30 AM ET = 13:30 UTC
  const time920Ms = isoToMs('2026-09-08T13:20:00.000Z');
  const time930Ms = isoToMs('2026-09-08T13:30:00.000Z');

  // 40 historical 5min bars from previous day (2026-09-05)
  const historical5mBars: RawBar[] = Array.from({ length: 40 }, (_, i) => ({
    time: `2026-09-05 ${String(13 + Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}:00`,
    open: 340 + i * 0.2,
    high: 341 + i * 0.2,
    low: 339 + i * 0.2,
    close: 340.5 + i * 0.2,
    volume: 5000 + i * 100,
    session: 'REG',
  }));

  // 30 historical daily bars with DuckDB composite session string "POST, PRE, REG"
  const historical1dBars: RawBar[] = Array.from({ length: 30 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return {
      time: `2026-08-${day} 12:00:00`,
      open: 300 + i,
      high: 305 + i,
      low: 298 + i,
      close: 303 + i,
      volume: 1500000 + i * 20000,
      session: 'POST, PRE, REG',
    };
  });

  // Ticks: 5 pre-market ticks between 9:20 and 9:29:59 ET, followed by 49 RTH ticks at 9:30:00 ET
  const premarketTicks: MarketTick[] = [
    { time: '2026-09-08 13:20:10.000', symbol: 'TSLA', price: 348.0, volume: 50, session: 'PRE' },
    { time: '2026-09-08 13:22:00.000', symbol: 'TSLA', price: 348.5, volume: 100, session: 'PRE' },
    { time: '2026-09-08 13:25:00.000', symbol: 'TSLA', price: 349.0, volume: 75, session: 'PRE' },
    { time: '2026-09-08 13:28:30.000', symbol: 'TSLA', price: 349.5, volume: 120, session: 'PRE' },
    { time: '2026-09-08 13:29:55.000', symbol: 'TSLA', price: 350.0, volume: 200, session: 'PRE' },
  ];

  const rthTicksAt930: MarketTick[] = Array.from({ length: 49 }, (_, i) => ({
    time: `2026-09-08 13:30:00.${String(i * 20).padStart(3, '0')}`,
    symbol: 'TSLA',
    price: 352.0 + (i % 4) * 0.5 - (i % 2) * 0.25,
    volume: 100 + i * 10,
    session: 'REG',
  }));

  const allTicks = [...premarketTicks, ...rthTicksAt930];

  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState({
      currentTime: time920Ms,
      bufferedTicks: allTicks,
      totalTicks: allTicks.length,
      currentTickIndex: 0,
      currentTick: null,
      isPaused: true,
      playbackSpeed: 1,
      latestTickBySymbol: {},
      ticksBySymbol: { TSLA: allTicks },
      masterData: [],
    });

    useWorkspaceStore.setState({
      tickers: { '0': 'TSLA', '1': 'TSLA' },
      timeframes: { '0': '5min', '1': '1D' },
      groups: { '0': 'none', '1': 'none' },
      groupTickers: {},
    });

    vi.mocked(streamingClient.getCandles).mockImplementation(async (_symbol, opts) => {
      if (opts?.timeframe === '5min') return historical5mBars;
      if (opts?.timeframe === '1D') return historical1dBars;
      return [];
    });

    vi.mocked(streamingClient.getTicks).mockResolvedValue(allTicks);
  });

  it('loads both Chart 0 (5min) and Chart 1 (1D) simultaneously at 9:20 AM without empty charts', async () => {
    const chartRef0 = { current: null };
    const priceSeriesRef0 = { current: null };
    const chartRef1 = { current: null };
    const priceSeriesRef1 = { current: null };

    // Mount Chart 0 (5min)
    const { result: chart0 } = renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '5min',
        initialEth: false,
        selectedDate,
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: chartRef0 as any,
        priceSeriesRef: priceSeriesRef0 as any,
        id: 0,
      })
    );

    // Mount Chart 1 (1D)
    const { result: chart1 } = renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '1D',
        initialEth: false,
        selectedDate,
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

    // Chart 0 (5min) must have loaded historical 5min bars
    expect(chart0.current.chartData.length).toBeGreaterThan(0);
    expect(chart0.current.chartData.length).toBe(40);

    // Chart 1 (1D) must NOT be empty! It must have loaded all 30 historical daily bars
    expect(chart1.current.chartData.length).toBeGreaterThan(0);
    expect(chart1.current.chartData.length).toBe(30);

    // At 9:20 AM (before 9:30 AM RTH open), today's forming daily candle is NOT present
    const last1dBar = chart1.current.chartData[chart1.current.chartData.length - 1];
    expect(last1dBar.time.slice(0, 10)).toBe('2026-08-30');
  });

  it('forms today 1D candle at 9:30 AM alongside all historical bars (never 1 lone candle)', async () => {
    const chartRef1 = { current: null };
    const priceSeriesRef1 = { current: null };

    const { result: chart1 } = renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '1D',
        initialEth: false,
        selectedDate,
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

    expect(chart1.current.chartData.length).toBe(30);

    // Advance simulation time to 9:30:00.500 ET (RTH open with ticks arriving)
    act(() => {
      usePlaybackStore.getState().advanceSimulationTime(time930Ms + 500);
      const state = usePlaybackStore.getState();
      const currentTick = state.currentTick;
      if (currentTick) {
        usePlaybackStore.setState({
          latestTickBySymbol: { TSLA: currentTick },
        });
      }
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Chart 1 must now have 31 bars: 30 historical daily bars + today's forming daily bar
    expect(chart1.current.chartData.length).toBe(31);

    // Verify today's forming daily candle is appended as the 31st bar
    const todayFormingBar = chart1.current.chartData[30];
    expect(todayFormingBar.time).toBe('2026-09-08 12:00:00');
    expect(todayFormingBar.session).toBe('REG');
    // Open price MUST be the RTH open price (352.0), NOT the premarket price (348.0)
    expect(todayFormingBar.open).toBe(352.0);
  });

  it('ensures viewport does not shake or jitter when ticks pour in at 9:30 AM', async () => {
    const mockTimeScale = {
      scrollToPosition: vi.fn(),
      scrollToRealTime: vi.fn(),
      getVisibleLogicalRange: vi.fn().mockReturnValue({ from: 10, to: 25 }),
      setVisibleLogicalRange: vi.fn(),
      options: vi.fn().mockReturnValue({ rightOffset: 15 }),
    };

    const mockPriceSeries = {
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
      removePriceLine: vi.fn(),
    };

    const chartInstance = {
      ...mockChart,
      timeScale: vi.fn().mockReturnValue(mockTimeScale),
    };

    const { useChartInit } = await import('../../src/hooks/chart/useChartInit');
    vi.mocked(useChartInit).mockReturnValue({
      chartRef: { current: chartInstance as any },
      priceSeriesRef: { current: mockPriceSeries as any },
      volumeSeriesRef: {
        current: {
          setData: vi.fn(),
          update: vi.fn(),
          applyOptions: vi.fn(),
          priceScale: () => ({ applyOptions: vi.fn() }),
        } as any,
      },
      lastBarSpacingRef: { current: null },
    });

    const containerRef = { current: document.createElement('div') };
    const chartRef = { current: chartInstance as any };
    const priceSeriesRef = { current: mockPriceSeries as any };
    const pendingHistoryPrependRef = { current: null };

    // Initial render at 9:20 AM with 30 historical bars
    const { rerender } = renderHook(
      (props) =>
        useChartLifecycle({
          chartContainerRef: containerRef,
          ticker: 'TSLA',
          timeframe: '1D',
          showEth: false,
          showVP: false,
          chartData: props.chartData,
          localMasterData: props.chartData,
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
        }),
      {
        initialProps: { chartData: historical1dBars },
      }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Record initial calls
    const initialRangeCalls = mockTimeScale.setVisibleLogicalRange.mock.calls.length;
    const initialScrollCalls = mockTimeScale.scrollToRealTime.mock.calls.length;

    // Simulate 9:30 AM tick flood: 20 updates in rapid succession
    act(() => {
      usePlaybackStore.setState({ isPaused: false });
    });

    for (let i = 0; i < 20; i++) {
      const tick = rthTicksAt930[i];
      act(() => {
        usePlaybackStore.setState({
          currentTime: time930Ms + i * 20,
          currentTick: tick,
          latestTickBySymbol: { TSLA: tick },
        });
      });
    }

    // User is panned to range 10..25 (wasAtEnd = false).
    // Incoming 9:30 AM ticks must NOT trigger setVisibleLogicalRange or scrollToRealTime!
    expect(mockTimeScale.setVisibleLogicalRange.mock.calls.length).toBe(initialRangeCalls);
    expect(mockTimeScale.scrollToRealTime.mock.calls.length).toBe(initialScrollCalls);
  });
});
