/**
 * liveReview.test.ts
 *
 * Test-Driven Development (TDD) harness replicating all 4 failure modes
 * documented in docs/reviews/FINAL-LIVE-BROWSER-REVIEW-96ca478.md:
 *
 * 1. PROBE 1 (P1): Daily volume changes substantially when playback is paused
 * 2. PROBE 2 (P1): AAPL chart retains TSLA historical candles after symbol switch
 * 3. PROBE 3 (P1): Timeframe/rewind sequence supplies unsorted data to chart
 * 4. PROBE 4 (P2): Pausing changes the daily "Live" price line to a different value
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { useChartData } from '../../src/hooks/useChartData';
import { streamingClient } from '../../src/lib/streamingClient';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import type { RawBar, MarketTick } from '../../src/types';

// Lightweight-charts mock with strict ascending time enforcement
class StrictCandleSeriesMock {
  public candles: any[] = [];
  public priceLines: any[] = [];
  public update = vi.fn((candle: any) => {
    if (this.candles.length > 0) {
      const last = this.candles[this.candles.length - 1];
      if (candle.time < last.time) {
        throw new Error(
          `Assertion failed: data must be asc ordered by time, time=${candle.time}, prev time=${last.time}`
        );
      }
      if (candle.time === last.time) {
        this.candles[this.candles.length - 1] = candle;
        return;
      }
    }
    this.candles.push(candle);
  });

  public setData = vi.fn((data: any[]) => {
    for (let i = 1; i < data.length; i++) {
      if (data[i].time <= data[i - 1].time) {
        throw new Error(
          `Assertion failed: data must be asc ordered by time, index=${i}, time=${data[i].time}, prev time=${data[i - 1].time}`
        );
      }
    }
    this.candles = [...data];
  });

  public data = vi.fn(() => this.candles);

  public createPriceLine = vi.fn((opts: any) => {
    const pl = {
      options: opts,
      applyOptions: vi.fn((newOpts: any) => {
        Object.assign(pl.options, newOpts);
      }),
    };
    this.priceLines.push(pl);
    return pl;
  });

  public removePriceLine = vi.fn((pl: any) => {
    const idx = this.priceLines.indexOf(pl);
    if (idx !== -1) this.priceLines.splice(idx, 1);
  });
}

class StrictVolumeSeriesMock {
  public dataList: any[] = [];
  public update = vi.fn((bar: any) => {
    if (this.dataList.length > 0) {
      const last = this.dataList[this.dataList.length - 1];
      if (bar.time === last.time) {
        this.dataList[this.dataList.length - 1] = bar;
        return;
      }
    }
    this.dataList.push(bar);
  });
  public setData = vi.fn((data: any[]) => {
    this.dataList = [...data];
  });
}

const mockPriceSeries = new StrictCandleSeriesMock();
const mockVolumeSeries = new StrictVolumeSeriesMock();

const mockTimeScale = {
  setVisibleLogicalRange: vi.fn(),
  getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 100 })),
  subscribeVisibleLogicalRangeChange: vi.fn(),
  unsubscribeVisibleLogicalRangeChange: vi.fn(),
};

const mockChart = {
  addCandlestickSeries: vi.fn(() => mockPriceSeries),
  addHistogramSeries: vi.fn(() => mockVolumeSeries),
  subscribeClick: vi.fn(),
  unsubscribeClick: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  unsubscribeCrosshairMove: vi.fn(),
  subscribeDblClick: vi.fn(),
  unsubscribeDblClick: vi.fn(),
  applyOptions: vi.fn(),
  priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
  timeScale: vi.fn(() => mockTimeScale),
  removeSeries: vi.fn(),
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
    vpPluginRef: { current: { setData: vi.fn() } },
    rayPluginRef: { current: null },
    rectPluginRef: { current: null },
    tradePluginRef: { current: null },
    updateShadingConfig: vi.fn(),
    pluginVersion: 0,
  })),
}));

vi.mock('../../src/lib/streamingClient', () => ({
  streamingClient: {
    getCandles: vi.fn().mockResolvedValue([]),
    getTicks: vi.fn().mockResolvedValue([]),
    getDateRange: vi.fn().mockResolvedValue({ min: 0, max: Date.now() }),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

const ms = (t: string) => Date.parse(t.replace(' ', 'T') + (t.includes('Z') ? '' : 'Z'));

describe('Live Review 96ca478 Failure Probes Harness', () => {
  const chartId = 1;
  const chartIdStr = '1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockPriceSeries.candles = [];
    mockPriceSeries.priceLines = [];
    mockVolumeSeries.dataList = [];

    usePlaybackStore.setState({
      isPlaying: false,
      isPaused: true,
      currentTime: ms('2026-09-22 13:34:00'), // 09:34 ET
      speed: 1,
      minTime: ms('2026-09-22 13:20:00'),
      maxTime: ms('2026-09-22 20:00:00'),
      currentSessionDate: '2026-09-22',
      ticksBySymbol: {},
      latestTickBySymbol: {},
      masterData: [],
      bufferedTicks: [],
    });

    useWorkspaceStore.setState({
      groups: {},
      groupTickers: {},
      tickers: { [chartIdStr]: 'TSLA' },
      timeframes: { [chartIdStr]: '5m' },
    });
  });

  // --------------------------------------------------------------------------
  // PROBE 1: Daily volume changes substantially when playback is paused
  // --------------------------------------------------------------------------
  it('PROBE 1: daily volume must remain stable across play and pause without jumping', async () => {
    // Session setup for September 22 on TSLA 1D
    const rthOpenTime = '2026-09-22 13:30:00'; // 09:30 ET
    const minute34Time = '2026-09-22 13:34:00';
    const minute35Time = '2026-09-22 13:35:00';

    // Discrepant fixture: completed minute bars sum to 1,410,000 vol, but raw ticks sum to 1,200,000 vol
    const minuteBars: RawBar[] = [
      { time: '2026-09-22 13:30:00', open: 370, high: 372, low: 369, close: 371, volume: 300000, symbol: 'TSLA', session: 'REG' },
      { time: '2026-09-22 13:31:00', open: 371, high: 373, low: 370, close: 372, volume: 300000, symbol: 'TSLA', session: 'REG' },
      { time: '2026-09-22 13:32:00', open: 372, high: 374, low: 371, close: 373, volume: 300000, symbol: 'TSLA', session: 'REG' },
      { time: '2026-09-22 13:33:00', open: 373, high: 375, low: 372, close: 374, volume: 300000, symbol: 'TSLA', session: 'REG' },
      { time: '2026-09-22 13:34:00', open: 374, high: 375, low: 373, close: 373.6, volume: 210000, symbol: 'TSLA', session: 'REG' },
    ];

    // Raw ticks in DuckDB only add up to 1,200,000
    const rawTicks: MarketTick[] = [
      { time: '2026-09-22 13:30:30.000', price: 371, volume: 250000, symbol: 'TSLA' },
      { time: '2026-09-22 13:31:30.000', price: 372, volume: 250000, symbol: 'TSLA' },
      { time: '2026-09-22 13:32:30.000', price: 373, volume: 250000, symbol: 'TSLA' },
      { time: '2026-09-22 13:33:30.000', price: 374, volume: 250000, symbol: 'TSLA' },
      { time: '2026-09-22 13:34:30.000', price: 373.6, volume: 200000, symbol: 'TSLA' },
    ];

    usePlaybackStore.setState({
      currentTime: ms('2026-09-22 13:34:30'),
      masterData: minuteBars,
      ticksBySymbol: { TSLA: rawTicks },
      latestTickBySymbol: { TSLA: rawTicks[rawTicks.length - 1] },
      isPaused: false,
    });
    useWorkspaceStore.setState({
      timeframes: { [chartIdStr]: '1D' },
    });

    vi.mocked(streamingClient.getCandles).mockResolvedValue(minuteBars);

    const hook = renderHook(() => {
      const data = useChartData({
        id: chartId,
        initialTicker: 'TSLA',
        initialTf: '1D',
        initialEth: false,
        selectedDate: '2026-09-22',
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: { current: mockChart as any },
        priceSeriesRef: { current: mockPriceSeries as any },
      });
      useChartLifecycle({
        chartContainerRef: { current: document.createElement('div') },
        ticker: 'TSLA',
        timeframe: '1D',
        showEth: false,
        showVP: false,
        chartData: data.chartData,
        localMasterData: data.localMasterData,
        isReplayMode: true,
        isLoadingHistory: data.isLoadingHistory,
        pendingHistoryPrependRef: data.pendingHistoryPrependRef,
        isDrawingMode: false,
        drawType: 'ray',
        rectAnchor: null,
        setRectAnchor: vi.fn(),
        ghostPoint: null,
        setGhostPoint: vi.fn(),
        drawings: { rays: [], rects: [] },
        onUpdateDrawings: vi.fn(),
        chartRef: { current: mockChart as any },
        priceSeriesRef: { current: mockPriceSeries as any },
      });
      return data;
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Advance simulation time across minute boundary into 09:35:56
    await act(async () => {
      usePlaybackStore.setState({
        currentTime: ms('2026-09-22 13:35:56'),
      });
      await Promise.resolve();
    });

    // Check playing volume rendered on canvas
    const playingDailyVolume = mockVolumeSeries.update.mock.calls.at(-1)?.[0]?.value ??
      mockVolumeSeries.dataList.at(-1)?.value;

    // Now PAUSE playback without advancing ticks
    act(() => {
      usePlaybackStore.setState({ isPaused: true });
    });

    await act(async () => {
      await Promise.resolve();
    });

    const pausedDailyVolume = hook.result.current.chartData.at(-1)?.volume;
    console.log('PROBE 1 LOG:', { playingDailyVolume, pausedDailyVolume });

    // Both paths must produce strictly equal daily volume! Must not jump from 1.20M to 1.41M!
    expect(pausedDailyVolume).toBeDefined();
    expect(playingDailyVolume).toBeDefined();
    expect(pausedDailyVolume).toEqual(playingDailyVolume);
  });

  // --------------------------------------------------------------------------
  // PROBE 2: AAPL chart retains TSLA historical candles after symbol switch
  // --------------------------------------------------------------------------
  it('PROBE 2: switching symbol clears TSLA candles and never renders them on AAPL chart', async () => {
    let resolveAAPL: (val: any) => void;
    const promiseAAPL = new Promise((res) => { resolveAAPL = res; });

    vi.mocked(streamingClient.getCandles).mockImplementation((sym: string) => {
      if (sym === 'TSLA') {
        return Promise.resolve(Array.from({ length: 10 }).map((_, i) => ({
          time: `2026-09-15 13:${20 + i * 5}:00`,
          open: 357, high: 359, low: 356, close: 358, volume: 1000, symbol: 'TSLA'
        })));
      } else if (sym === 'AAPL') {
        return promiseAAPL as any;
      }
      return Promise.resolve([]);
    });

    const hook = renderHook(() => {
      const data = useChartData({
        id: chartId,
        initialTicker: 'TSLA',
        initialTf: '5m',
        initialEth: false,
        selectedDate: '2026-09-15',
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA', 'AAPL'],
        chartRef: { current: mockChart as any },
        priceSeriesRef: { current: mockPriceSeries as any },
      });
      useChartLifecycle({
        chartContainerRef: { current: document.createElement('div') },
        ticker: useWorkspaceStore((s) => s.tickers[chartIdStr] || 'TSLA'),
        timeframe: '5m',
        showEth: false,
        showVP: false,
        chartData: data.chartData,
        localMasterData: data.localMasterData,
        isReplayMode: true,
        isLoadingHistory: data.isLoadingHistory,
        pendingHistoryPrependRef: data.pendingHistoryPrependRef,
        isDrawingMode: false,
        drawType: 'ray',
        rectAnchor: null,
        setRectAnchor: vi.fn(),
        ghostPoint: null,
        setGhostPoint: vi.fn(),
        drawings: { rays: [], rects: [] },
        onUpdateDrawings: vi.fn(),
        chartRef: { current: mockChart as any },
        priceSeriesRef: { current: mockPriceSeries as any },
      });
      return data;
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(hook.result.current.chartData.length).toBeGreaterThan(0);
    expect(hook.result.current.chartData[0].close).toBe(358); // TSLA price

    // User switches chart to AAPL
    act(() => {
      useWorkspaceStore.setState({
        tickers: { [chartIdStr]: 'AAPL' },
      });
    });

    // While AAPL history is in flight, chartData must be cleared or cannot contain TSLA bars
    const pendingBars = hook.result.current.chartData;
    expect(pendingBars.some(b => b.close >= 356)).toBe(false);

    // Now resolve AAPL history
    await act(async () => {
      resolveAAPL(Array.from({ length: 10 }).map((_, i) => ({
        time: `2026-09-15 13:${20 + i * 5}:00`,
        open: 150, high: 152, low: 149, close: 151, volume: 2000, symbol: 'AAPL'
      })));
      await Promise.resolve();
    });

    // All rendered candles on canvas must strictly belong to AAPL (~151), none to TSLA (~358)
    const renderedCandles = mockPriceSeries.candles;
    for (const c of renderedCandles) {
      expect(c.close).toBeLessThan(250);
      expect(c.close).toBeGreaterThan(100);
    }
  });

  // --------------------------------------------------------------------------
  // PROBE 3: Timeframe/rewind sequence supplies unsorted data to the chart
  // --------------------------------------------------------------------------
  it('PROBE 3: history pagination merge guarantees strictly ascending timestamp order and discards obsolete responses', async () => {
    // Initial 5m bars: 10 bars
    const initialBars: RawBar[] = Array.from({ length: 100 }).map((_, i) => ({
      time: new Date(ms('2026-09-15 13:20:00') + i * 300000).toISOString().replace('T', ' ').slice(0, 19),
      open: 100, high: 105, low: 95, close: 102, volume: 1000
    }));

    vi.mocked(streamingClient.getCandles).mockResolvedValue(initialBars);

    const hook = renderHook(() =>
      useChartData({
        id: chartId,
        initialTicker: 'TSLA',
        initialTf: '5m',
        initialEth: false,
        selectedDate: '2026-09-15',
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: { current: mockChart as any },
        priceSeriesRef: { current: mockPriceSeries as any },
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Simulate infinite scroll pagination trigger:
    // If an incoming chunk has timestamps that are out of order or overlaps unsortedly,
    // it must be sanitized/sorted ascendingly or rejected without throwing an unhandled Assertion Error!
    const listener = mockTimeScale.subscribeVisibleLogicalRangeChange.mock.calls[0]?.[0];
    expect(listener).toBeDefined();

    // Trigger pagination with an unsorted chunk from the backend
    const badChunk: RawBar[] = [
      { time: '2026-09-15 13:10:00', open: 98, high: 99, low: 97, close: 98, volume: 500 },
      { time: '2026-09-15 13:05:00', open: 97, high: 98, low: 96, close: 97, volume: 500 }, // Out of order!
    ];
    vi.mocked(streamingClient.getCandles).mockResolvedValue(badChunk);

    // Call pagination listener
    await act(async () => {
      await listener({ from: 10, to: 50 });
    });

    // Verify localMasterData in hook is strictly ascending by timestamp!
    const masterData = hook.result.current.localMasterData;
    for (let i = 1; i < masterData.length; i++) {
      const prevMs = new Date(masterData[i - 1].time.replace(' ', 'T') + 'Z').getTime();
      const currMs = new Date(masterData[i].time.replace(' ', 'T') + 'Z').getTime();
      expect(currMs).toBeGreaterThan(prevMs);
    }
  });

  // --------------------------------------------------------------------------
  // PROBE 4: Pausing changes daily "Live" price to different value
  // --------------------------------------------------------------------------
  it('PROBE 4: daily Live price line must use latest eligible trade price in both play and pause', async () => {
    // September 22 setup:
    // Historical 1D bar close is 379.15 (yesterday's close or completed day)
    // Latest trade during replay is 373.60
    const historicalBars: RawBar[] = [
      { time: '2026-09-21 12:00:00', open: 375, high: 380, low: 374, close: 379.15, volume: 1000000, session: 'REG' },
    ];

    const currentTick: MarketTick = {
      time: '2026-09-22 13:35:56.463',
      price: 373.60,
      volume: 100,
      symbol: 'TSLA',
    };

    usePlaybackStore.setState({
      currentTime: ms('2026-09-22 13:35:56.463'),
      isPaused: false,
      currentTick: currentTick,
      latestTickBySymbol: { TSLA: currentTick },
      ticksBySymbol: { TSLA: [currentTick] },
      currentSessionDate: '2026-09-22',
    });

    const hook = renderHook(() => {
      useChartLifecycle({
        chartContainerRef: { current: document.createElement('div') },
        ticker: 'TSLA',
        timeframe: '1D',
        showEth: false,
        showVP: false,
        chartData: historicalBars,
        localMasterData: historicalBars,
        isReplayMode: true,
        isLoadingHistory: false,
        pendingHistoryPrependRef: { current: null },
        isDrawingMode: false,
        drawType: 'ray',
        rectAnchor: null,
        setRectAnchor: vi.fn(),
        ghostPoint: null,
        setGhostPoint: vi.fn(),
        drawings: { rays: [], rects: [] },
        onUpdateDrawings: vi.fn(),
        chartRef: { current: mockChart as any },
        priceSeriesRef: { current: mockPriceSeries as any },
      });
    });

    // Wait for hydration
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // In playing state, price line is 373.60
    await act(async () => {
      usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:35:56.463'));
    });

    const playingLinePrice = mockPriceSeries.priceLines.at(-1)?.options?.price;
    expect(playingLinePrice).toBe(373.60);

    // Now pause playback
    act(() => {
      usePlaybackStore.setState({ isPaused: true });
    });

    await act(async () => {
      await Promise.resolve();
    });

    const pausedLinePrice = mockPriceSeries.priceLines.at(-1)?.options?.price;

    // Must NOT switch to 379.15 (historical close)! Must stay at 373.60 (latest trade price)
    expect(pausedLinePrice).toBe(373.60);
  });
});
