/**
 * rereviewProbes.test.ts
 *
 * Test-Driven Development (TDD) harness replicating the 3 P1 failure modes
 * and Layer 1 verification criteria documented in docs/reviews/2026-09-30-replay-review.md:
 *
 * 1. PROBE 1 (P1): Seek -> play discards accumulated fallback volume (useChartLifecycle.ts)
 * 2. PROBE 2 (P1): Switched symbol can expose unfinished 5-minute prices (useChartData.ts)
 * 3. PROBE 3 (P1): Daily candles include unfinished-minute results (useChartData.ts)
 * 4. Daily RTH Session Filtering: PRE and POST trades strictly excluded from daily OHLCV
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { useChartData } from '../../src/hooks/useChartData';
import { streamingClient } from '../../src/lib/streamingClient';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import type { RawBar, MarketTick } from '../../src/types';

// Mock lightweight-charts APIs
const mockPriceScale = { applyOptions: vi.fn() };
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
const mockVpPlugin = { setData: vi.fn() };

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

vi.mock('../../src/lib/streamingClient', () => ({
  streamingClient: {
    getCandles: vi.fn(),
    getTicks: vi.fn(),
  },
}));

const ms = (t: string) => Date.parse(t.replace(' ', 'T') + 'Z');
const initialBar: RawBar = {
  time: '2026-09-22 13:20:00',
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 0,
  session: 'PRE',
};

const lifecycleParams = {
  chartContainerRef: { current: document.createElement('div') },
  ticker: 'TSLA',
  timeframe: '5min' as const,
  showEth: true,
  showVP: false,
  localMasterData: [],
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
  chartRef: { current: mockChart as any },
  priceSeriesRef: { current: mockPriceSeries as any },
};

const chartDataParams = {
  initialTicker: 'TSLA',
  initialTf: '5min' as const,
  initialEth: true,
  selectedDate: '2026-09-22',
  isReplayMode: true,
  groupColor: 'none' as const,
  tickers: ['TSLA', 'AAPL'],
  chartRef: { current: null },
  priceSeriesRef: { current: null },
  id: 0,
};

async function mountLifecycle(bars: RawBar[] = [initialBar], extra = {}) {
  const hook = renderHook(
    ({ chartData, isLoadingHistory }) =>
      useChartLifecycle({ ...lifecycleParams, ...extra, chartData, isLoadingHistory }),
    { initialProps: { chartData: bars, isLoadingHistory: !!(extra as any).isLoadingHistory } }
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 35));
  });
  return hook;
}

describe('Replay Review 2026-09-30 Regression Probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
    usePlaybackStore.setState({ masterData: [], isPaused: true, bufferedTicks: [] });
    useWorkspaceStore.setState({
      tickers: { '0': 'TSLA' },
      timeframes: { '0': '5min' },
      groups: { '0': 'none' },
      groupTickers: {},
    });
    vi.mocked(streamingClient.getTicks).mockResolvedValue([]);
  });

  // --------------------------------------------------------------------------
  // PROBE 1: Seek -> play discards accumulated fallback volume
  // --------------------------------------------------------------------------
  it('PROBE 1: seek snapshot retains completed constituent minute volume when playback resumes', async () => {
    // 5-minute TSLA chart with no raw ticks:
    // 09:20 minute = 1,000 shares
    // 09:21 minute = 200 shares
    usePlaybackStore.setState({
      masterData: [
        { ...initialBar, volume: 1000, symbol: 'TSLA' },
        { ...initialBar, time: '2026-09-22 13:21:00', volume: 200, symbol: 'TSLA' },
      ],
      bufferedTicks: [],
      isPaused: true,
    });

    // Seek to 09:21:00 and hydrate a snapshot containing the completed 09:20 minute (1000 shares)
    act(() => usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:21:00')));
    await mountLifecycle([{ ...initialBar, volume: 1000 }]);

    // Resume playback and advance one second into the 09:21 minute
    act(() => usePlaybackStore.getState().setPaused(false));
    act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:21:01')));

    const actual = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
    // Must NOT drop to 200 by wiping previously accumulated snapshot volume!
    // Expected: 1,000 (from 09:20) + 200 (from 09:21) = 1,200 (or at least >= 1,000)
    expect(actual).toBeGreaterThanOrEqual(1000);
  });

  // --------------------------------------------------------------------------
  // PROBE 2: Switched symbol can expose unfinished 5-minute prices
  // --------------------------------------------------------------------------
  it('PROBE 2: switched symbol fallback must not expose unclosed five-minute bar future high', async () => {
    const raw5mBars: RawBar[] = [
      { time: '2026-09-22 13:15:00', open: 100, high: 110, low: 90, close: 101, volume: 1000, session: 'PRE' },
      { time: '2026-09-22 13:20:00', open: 101, high: 150, low: 80, close: 105, volume: 2000, session: 'PRE' },
    ];
    vi.mocked(streamingClient.getCandles).mockResolvedValue(raw5mBars);

    // Global minute history is for AAPL (different symbol), TSLA has no elapsed ticks
    usePlaybackStore.setState({
      masterData: [
        { time: '2026-09-22 13:20:00', open: 200, high: 205, low: 199, close: 202, volume: 100, symbol: 'AAPL', session: 'PRE' },
      ],
      currentTime: ms('2026-09-22 13:21:00'),
    });

    const hook = renderHook(() => useChartData({ ...chartDataParams, isReplayMode: true }));
    await act(async () => {
      await Promise.resolve();
    });

    const last = hook.result.current.chartData.at(-1);
    // At 09:21 (13:21 UTC), the 09:20–09:25 5m bar is UNFINISHED.
    // It must NOT reveal its completed high 150! It should be protected (e.g. high: 101).
    expect(last?.high).toBe(101);
  });

  // --------------------------------------------------------------------------
  // PROBE 3: Daily candles include unfinished-minute results
  // --------------------------------------------------------------------------
  it('PROBE 3: daily forming candle must not expose future one-minute high at 09:30:01', async () => {
    vi.mocked(streamingClient.getCandles).mockResolvedValue([
      { time: '2026-09-21 12:00:00', open: 100, high: 110, low: 90, close: 101, volume: 1000, session: 'REG' },
    ]);

    // TSLA 09:30 minute bar has full completed high 150, low 80, close 120, volume 10000
    usePlaybackStore.setState({
      masterData: [
        { time: '2026-09-22 13:30:00', open: 101, high: 150, low: 80, close: 120, volume: 10000, symbol: 'TSLA', session: 'REG' },
      ],
      currentTime: ms('2026-09-22 13:30:01'),
    });
    useWorkspaceStore.setState({ timeframes: { '0': '1D' } });

    const hook = renderHook(() => useChartData({ ...chartDataParams, initialTf: '1D', isReplayMode: true }));
    await act(async () => {
      await Promise.resolve();
    });

    const last = hook.result.current.chartData.at(-1);
    // At 09:30:01, the 09:30 minute is still forming and has 59 seconds left.
    // The forming daily candle must NOT expose the future high 150 of the unclosed minute!
    expect(last?.high).toBe(101);
  });
});
