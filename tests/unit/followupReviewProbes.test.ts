/**
 * followupReviewProbes.test.ts
 *
 * Test-Driven Development (TDD) harness replicating the P1 and P2 findings
 * from market-rewind-c3a3791-review.md:
 *
 * 1. P1: Synthetic ticks bypass daily forming-minute protection on real seek (useChartData.ts)
 * 2. P1: Snapshot volume reconstruction imports premarket into RTH-only daily candle (useChartLifecycle.ts)
 * 3. P2: Layer 2 state-machine convergence verified via real series data and unmounted lifecycles
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

async function mountCombined(bars: RawBar[] = [initialBar], ticks: MarketTick[] = [], extra: any = {}) {
  const tf = extra.timeframe || '5min';
  const eth = extra.showEth !== undefined ? extra.showEth : true;
  const sym = extra.ticker || 'TSLA';
  vi.mocked(streamingClient.getCandles).mockResolvedValue(bars);
  vi.mocked(streamingClient.getTicks).mockResolvedValue(ticks);

  const hook = renderHook(() => {
    const data = useChartData({
      ...chartDataParams,
      initialTicker: sym,
      initialTf: tf,
      initialEth: eth,
      tickers: [sym],
    });
    useChartLifecycle({
      ...lifecycleParams,
      ...extra,
      ticker: sym,
      timeframe: tf,
      showEth: eth,
      chartData: data.chartData,
      localMasterData: data.localMasterData,
      isLoadingHistory: data.isLoadingHistory,
      pendingHistoryPrependRef: data.pendingHistoryPrependRef,
    });
    return data;
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
  return hook;
}

describe('Follow-up Review Probes (market-rewind-c3a3791-review.md)', () => {
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
  // Finding 1 (P1): Real seek into daily opening minute must preserve zero unfinished volume
  // --------------------------------------------------------------------------
  it('P1: real seek into daily opening minute must preserve zero unfinished volume and open price', async () => {
    vi.mocked(streamingClient.getCandles).mockResolvedValue([
      { time: '2026-09-21 12:00:00', open: 100, high: 110, low: 90, close: 101, volume: 1000, session: 'REG' },
    ]);
    usePlaybackStore.setState({
      masterData: [
        { time: '2026-09-22 13:30:00', open: 101, high: 150, low: 80, close: 120, volume: 10000, symbol: 'TSLA', session: 'REG' },
      ],
    });

    // Call real seek action for 09:30:01 (creates synthesized tick)
    usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:30:01'));
    useWorkspaceStore.setState({ timeframes: { '0': '1D' } });

    const hook = renderHook(() => useChartData({ ...chartDataParams, initialTf: '1D', isReplayMode: true }));
    await act(async () => {
      await Promise.resolve();
    });

    const last = hook.result.current.chartData.at(-1);
    // At 09:30:01, the 09:30 minute is still unclosed and TSLA has no raw ticks.
    // The forming daily candle must NOT expose the unclosed 10,000 volume or unclosed 150 high / 99.6 close!
    expect(last?.volume).toBe(0);
    expect(last?.high).toBe(101);
    expect(last?.low).toBe(101);
    expect(last?.close).toBe(101);
  });

  // --------------------------------------------------------------------------
  // Finding 2 (P1): Volume reconstruction on 1D must strictly exclude premarket bars after hydration
  // --------------------------------------------------------------------------
  it('P1: daily fallback volume reconstruction strictly excludes premarket bars', async () => {
    usePlaybackStore.setState({
      masterData: [
        { ...initialBar, volume: 1000, symbol: 'TSLA', session: 'PRE' },
        { ...initialBar, time: '2026-09-22 13:30:00', volume: 200, symbol: 'TSLA', session: 'REG' },
      ],
      bufferedTicks: [],
      isPaused: true,
    });

    act(() => usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:30:00')));
    const hook = await mountLifecycle(
      [{ ...initialBar, time: '2026-09-22 12:00:00', volume: 0, session: 'REG' }],
      { timeframe: '1D', showEth: false }
    );

    act(() => usePlaybackStore.getState().setPaused(false));
    act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:30:01')));

    const actual = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
    // Must NOT be 1,200 (which contaminates RTH daily candle with 1,000 PRE shares)
    expect(actual).toBeLessThanOrEqual(200);
    hook.unmount();
  });

  // --------------------------------------------------------------------------
  // Finding 3 (P2): Rigorous Layer 2 State Machine Convergence Test
  // --------------------------------------------------------------------------
  it('P2: rigorous Layer 2 state machine convergence across all 4 playback pathways', async () => {
    const rawTicks: MarketTick[] = [
      { time: '2026-09-22 13:20:10.000', price: 100, volume: 10, symbol: 'TSLA' },
      { time: '2026-09-22 13:20:30.000', price: 105, volume: 20, symbol: 'TSLA' },
      { time: '2026-09-22 13:21:10.000', price: 95, volume: 30, symbol: 'TSLA' },
      { time: '2026-09-22 13:21:40.000', price: 110, volume: 40, symbol: 'TSLA' },
      { time: '2026-09-22 13:22:10.000', price: 102, volume: 50, symbol: 'TSLA' },
      { time: '2026-09-22 13:22:25.000', price: 108, volume: 60, symbol: 'TSLA' },
      { time: '2026-09-22 13:25:00.000', price: 108, volume: 1, symbol: 'TSLA' },
    ];
    const targetTimeMs = ms('2026-09-22 13:22:30');
    const expectedCandle = { high: 110, low: 95, close: 108, volume: 210 };

    // Path 1: Continuous Playback from 13:20:00 to 13:22:30
    usePlaybackStore.getState().setBufferedTicks(rawTicks);
    usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:20:00'));
    const hook1 = await mountLifecycle([{ ...initialBar, volume: 0 }]);
    act(() => usePlaybackStore.getState().setPaused(false));
    act(() => usePlaybackStore.getState().advanceSimulationTime(targetTimeMs));
    const p1Price = mockPriceSeries.update.mock.calls.at(-1)?.[0];
    const p1Vol = mockVolumeSeries.update.mock.calls.at(-1)?.[0]?.value;
    const res1 = { high: p1Price?.high, low: p1Price?.low, close: p1Price?.close, volume: p1Vol };
    expect(res1).toEqual(expectedCandle);
    hook1.unmount();

    // Path 2: Direct Seek to 13:22:30 using combined real useChartData and useChartLifecycle
    vi.clearAllMocks();
    usePlaybackStore.getState().setBufferedTicks(rawTicks);
    act(() => usePlaybackStore.getState().seekTickTime(targetTimeMs));
    const hook2 = await mountCombined(
      [{ ...initialBar, volume: 0 }],
      rawTicks,
      { timeframe: '5min', showEth: true }
    );
    // Inspect actual setData calls received by the price and volume series from useChartData
    const p2PriceBar = mockPriceSeries.setData.mock.calls.at(-1)?.[0]?.at(-1);
    const p2VolBar = mockVolumeSeries.setData.mock.calls.at(-1)?.[0]?.at(-1);
    const res2 = { high: p2PriceBar?.high, low: p2PriceBar?.low, close: p2PriceBar?.close, volume: p2VolBar?.value };
    expect(res2).toEqual(expectedCandle);
    hook2.unmount();

    // Path 3: Seek to 13:21:00 then Play to 13:22:30
    vi.clearAllMocks();
    usePlaybackStore.getState().setBufferedTicks(rawTicks);
    act(() => usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:21:00')));
    const hook3 = await mountLifecycle([
      { ...initialBar, high: 105, low: 100, close: 105, volume: 30 },
    ]);
    act(() => usePlaybackStore.getState().setPaused(false));
    act(() => usePlaybackStore.getState().advanceSimulationTime(targetTimeMs));
    const p3Price = mockPriceSeries.update.mock.calls.at(-1)?.[0];
    const p3Vol = mockVolumeSeries.update.mock.calls.at(-1)?.[0]?.value;
    const res3 = { high: p3Price?.high, low: p3Price?.low, close: p3Price?.close, volume: p3Vol };
    expect(res3).toEqual(expectedCandle);
    hook3.unmount();

    // Path 4: Rewind and Replay: Overshoot to 13:23:00, rewind to 13:20:00, play to 13:22:30
    vi.clearAllMocks();
    usePlaybackStore.getState().setBufferedTicks(rawTicks);
    act(() => usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:23:00')));
    const hook4 = await mountLifecycle([{ ...initialBar, volume: 210 }]);
    act(() => usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:20:00')));
    hook4.rerender({ chartData: [{ ...initialBar, volume: 0 }], isLoadingHistory: false });
    act(() => usePlaybackStore.getState().setPaused(false));
    act(() => usePlaybackStore.getState().advanceSimulationTime(targetTimeMs));
    const p4Price = mockPriceSeries.update.mock.calls.at(-1)?.[0];
    const p4Vol = mockVolumeSeries.update.mock.calls.at(-1)?.[0]?.value;
    const res4 = { high: p4Price?.high, low: p4Price?.low, close: p4Price?.close, volume: p4Vol };
    expect(res4).toEqual(expectedCandle);
    hook4.unmount();
  });

  it('P2: 1D synthetic fallback equivalence across direct seek, continuous play, pause, and rewind', async () => {
    const masterBars: RawBar[] = [
      { time: '2026-09-22 13:30:00', open: 101, high: 150, low: 80, close: 120, volume: 10000, symbol: 'TSLA', session: 'REG' },
    ];
    const targetMs = ms('2026-09-22 13:30:01');
    const expected01 = { open: 101, high: 101, low: 101, close: 101, volume: 0 };

    // Path 1: Continuous Play to 13:30:01
    vi.clearAllMocks();
    usePlaybackStore.setState({ masterData: masterBars, bufferedTicks: [], isPaused: true });
    usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:30:00'));
    const hook1 = await mountCombined([], [], { timeframe: '1D', showEth: false });
    act(() => usePlaybackStore.getState().setPaused(false));
    act(() => usePlaybackStore.getState().advanceSimulationTime(targetMs));
    const p1Price = mockPriceSeries.update.mock.calls.at(-1)?.[0];
    const p1Vol = mockVolumeSeries.update.mock.calls.at(-1)?.[0]?.value;
    expect({ open: p1Price?.open, high: p1Price?.high, low: p1Price?.low, close: p1Price?.close, volume: p1Vol }).toEqual(expected01);
    hook1.unmount();

    // Path 2: Direct Seek to 13:30:01
    vi.clearAllMocks();
    usePlaybackStore.setState({ masterData: masterBars, bufferedTicks: [], isPaused: true });
    act(() => usePlaybackStore.getState().seekTickTime(targetMs));
    const hook2 = await mountCombined([], [], { timeframe: '1D', showEth: false });
    const p2Price = mockPriceSeries.setData.mock.calls.at(-1)?.[0]?.at(-1);
    const p2Vol = mockVolumeSeries.setData.mock.calls.at(-1)?.[0]?.at(-1)?.value;
    expect({ open: p2Price?.open, high: p2Price?.high, low: p2Price?.low, close: p2Price?.close, volume: p2Vol }).toEqual(expected01);
    hook2.unmount();

    // Path 3: Seek past, then Rewind to 13:30:01
    vi.clearAllMocks();
    usePlaybackStore.setState({ masterData: masterBars, bufferedTicks: [], isPaused: true });
    act(() => usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:31:00')));
    const hook3 = await mountCombined([], [], { timeframe: '1D', showEth: false });
    act(() => usePlaybackStore.getState().seekTickTime(targetMs));
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    const p3PriceUpdate = mockPriceSeries.update.mock.calls.at(-1)?.[0];
    const p3VolUpdate = mockVolumeSeries.update.mock.calls.at(-1)?.[0]?.value;
    const p3PriceSet = mockPriceSeries.setData.mock.calls.at(-1)?.[0]?.at(-1);
    const p3VolSet = mockVolumeSeries.setData.mock.calls.at(-1)?.[0]?.at(-1)?.value;
    const p3Price = p3PriceUpdate || p3PriceSet;
    const p3Vol = p3VolUpdate !== undefined ? p3VolUpdate : p3VolSet;
    expect({ open: p3Price?.open, high: p3Price?.high, low: p3Price?.low, close: p3Price?.close, volume: p3Vol }).toEqual(expected01);
    hook3.unmount();
  });
});
