import React from 'react';
import { render, fireEvent, act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../../src/App';
import { TimeAndSales } from '../../src/components/TimeAndSales';
import { PlaybackBar } from '../../src/components/PlaybackBar';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { useChartData } from '../../src/hooks/useChartData';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import { streamingClient } from '../../src/lib/streamingClient';
import type { RawBar, MarketTick } from '../../src/types';

// Mock chart APIs for useChartLifecycle
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

vi.mock('../../src/lib/streamingClient', () => ({
  streamingClient: {
    getCandles: vi.fn(),
    getTicks: vi.fn(),
  },
}));

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

const ms = (t: string) => Date.parse(t.replace(' ', 'T') + (t.includes('Z') ? '' : 'Z'));
const tick = (time: string, price: number, volume: number, symbol = 'TSLA') =>
  ({ time, price, volume, symbol, session: 'PRE' } as any);

const initialBars: RawBar[] = [
  { time: '2026-09-22 13:20:00', open: 100, high: 100, low: 100, close: 100, volume: 0, session: 'PRE' },
];

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

async function mountLifecycle(bars = initialBars, extra = {}) {
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

describe('Review Transition Probes (market-rewind-review-2026-09-29.md)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
    usePlaybackStore.setState({ masterData: [], isPaused: true });
  });

  // PROBE 1: React hook-order error in TimeAndSales
  it('PROBE 1: opening tape after closed render must not throw hook-order error', () => {
    const hook = render(<TimeAndSales isOpen={false} onClose={() => {}} symbol="TSLA" />);
    expect(() => {
      hook.rerender(<TimeAndSales isOpen={true} onClose={() => {}} symbol="TSLA" />);
    }).not.toThrow();
  });

  // PROBE 2: Post-seek volume doubling
  it('PROBE 2: starting playback after a seek must not re-add already rendered ticks', async () => {
    const ticks = [
      tick('2026-09-22 13:22:00', 100, 4),
      tick('2026-09-22 13:23:00', 101, 6),
      tick('2026-09-22 13:24:00', 102, 8),
    ];
    usePlaybackStore.getState().setBufferedTicks(ticks);
    usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:23:00'));
    await mountLifecycle([{ ...initialBars[0], high: 101, close: 101, volume: 10 }]);

    act(() => usePlaybackStore.getState().setPaused(false));
    const value = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
    expect(value).toBe(10);
  });

  // PROBE 3: Rewind trade suppression
  it('PROBE 3: after rewind one frame must retain intermediate high, low, and volume', async () => {
    const ticks = [
      tick('2026-09-22 13:21:00', 100, 1),
      tick('2026-09-22 13:22:00.001', 120, 2),
      tick('2026-09-22 13:22:00.002', 90, 3),
      tick('2026-09-22 13:22:00.003', 105, 4),
      tick('2026-09-22 13:24:00', 106, 1),
    ];
    usePlaybackStore.getState().setBufferedTicks(ticks);
    usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:23:00'));
    const hook = await mountLifecycle();
    act(() => usePlaybackStore.getState().setPaused(false));
    act(() => usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:20:00')));
    hook.rerender({ chartData: initialBars.map((b) => ({ ...b })), isLoadingHistory: false });
    act(() => usePlaybackStore.getState().setPaused(false));
    act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:22:00.010')));

    const price = mockPriceSeries.update.mock.calls.at(-1)?.[0];
    const volume = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
    expect({ high: price?.high, low: price?.low, volume }).toEqual({ high: 120, low: 90, volume: 10 });
  });

  // PROBE 4: 5m fallback multi-minute volume retention
  it('PROBE 4: 5m fallback retains prior constituent minute volumes', async () => {
    await mountLifecycle();
    usePlaybackStore.setState({
      masterData: [
        { ...initialBars[0], volume: 1000, symbol: 'TSLA' },
        { ...initialBars[0], time: '2026-09-22 13:21:00', volume: 200, symbol: 'TSLA' },
      ],
      bufferedTicks: [],
      isPaused: false,
    });
    act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:20:59.900')));
    act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:21:00.100')));
    const actual = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
    expect(actual).toBeGreaterThanOrEqual(1000);
  });

  // PROBE 5: Look-ahead leak 1s past boundary
  it('PROBE 5: 1 second past boundary: paused forming 5m candle must not reveal completed 5m high', async () => {
    const rawBars: RawBar[] = [
      { time: '2026-09-22 13:15:00', open: 100, high: 110, low: 90, close: 101, volume: 1000, session: 'PRE' },
      { time: '2026-09-22 13:20:00', open: 101, high: 150, low: 80, close: 105, volume: 2000, session: 'PRE' },
    ];
    vi.mocked(streamingClient.getCandles).mockResolvedValue(rawBars);
    vi.mocked(streamingClient.getTicks).mockResolvedValue([]);
    usePlaybackStore.setState({
      masterData: [
        { time: '2026-09-22 13:20:00', open: 101, high: 105, low: 100, close: 102, volume: 100, symbol: 'TSLA', session: 'PRE' },
      ],
    });
    usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:20:01'));

    const hook = renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '5min',
        initialEth: true,
        selectedDate: '2026-09-22',
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: { current: null },
        priceSeriesRef: { current: null },
        id: 0,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    const last = hook.result.current.chartData.at(-1);
    expect(last?.high).toBe(101);
  });

  // PROBE 6: Slider premarket loss after seek
  it('PROBE 6: slider minimum remains 09:20 after seeking to 09:34', () => {
    usePlaybackStore.getState().setBufferedTicks([
      { time: '2026-09-15 13:30:00.085', price: 100, volume: 1, symbol: 'TSLA' },
      { time: '2026-09-15 19:59:59.440', price: 101, volume: 1, symbol: 'TSLA' },
    ] as any);
    usePlaybackStore.getState().seekTickTime(ms('2026-09-15 13:20:00'));

    const { getByTestId } = render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="TSLA"
        onResetToOpen={() => {}}
        minStepMinutes={1}
      />
    );
    const slider = getByTestId('playback-time-slider');
    const initialMin = slider.getAttribute('min');
    fireEvent.change(slider, { target: { value: ms('2026-09-15 13:34:00') } });
    expect(slider.getAttribute('min')).toBe(initialMin);
  });
});
