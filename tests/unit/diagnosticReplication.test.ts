import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import type { RawBar, TickData } from '../../src/types';

// Mock lightweight-charts primitives
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

const params = {
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

const initial: RawBar[] = [
  { time: '2026-09-22 13:20:00', open: 100, high: 100, low: 100, close: 100, volume: 0, session: 'PRE' }
];

const ms = (t: string) => Date.parse(t.replace(' ', 'T') + 'Z');
const tick = (time: string, price: number, volume: number, symbol = 'TSLA'): TickData =>
  ({ time, price, volume, symbol, session: 'PRE' } as any);

async function mount(bars: RawBar[] = initial, extra = {}) {
  const hook = renderHook(
    ({ chartData, isLoadingHistory }) =>
      useChartLifecycle({ ...params, ...extra, chartData, isLoadingHistory }),
    { initialProps: { chartData: bars, isLoadingHistory: !!(extra as any).isLoadingHistory } }
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 35));
  });
  return hook;
}

describe('Diagnostic Defect Replication (market-rewind-diagnosis-and-plan.md)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
    usePlaybackStore.setState({ masterData: [], isPaused: true });
  });

  it('DIAG 1: unchanged trade must not add volume on clock-only notifications', async () => {
    await mount();
    const t = tick('2026-09-22 13:22:42.921', 100, 4);
    act(() => {
      usePlaybackStore.setState({
        currentTick: t,
        latestTickBySymbol: { TSLA: t },
        currentTime: ms(t.time),
        isPaused: false,
      });
    });

    for (let i = 1; i <= 60; i++) {
      act(() => {
        usePlaybackStore.getState().setCurrentTime(ms(t.time) + i * 16);
      });
    }

    const actual = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
    expect(actual).toBe(4);
  });

  it('DIAG 2: one frame must aggregate every elapsed tick, including intermediate high/low', async () => {
    await mount();
    const ticks = [
      tick('2026-09-22 13:22:00.000', 100, 1),
      tick('2026-09-22 13:22:00.001', 120, 2),
      tick('2026-09-22 13:22:00.002', 90, 3),
      tick('2026-09-22 13:22:00.003', 105, 4),
      tick('2026-09-22 13:24:00.000', 106, 1),
    ];
    act(() => {
      usePlaybackStore.getState().setBufferedTicks(ticks);
      usePlaybackStore.getState().seekTickTime(ms(ticks[0].time));
      usePlaybackStore.getState().setPaused(false);
    });
    act(() => {
      usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:22:00.010'));
    });

    const price = mockPriceSeries.update.mock.calls.at(-1)?.[0];
    const volume = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
    expect({ high: price?.high, low: price?.low, volume }).toEqual({ high: 120, low: 90, volume: 10 });
  });

  it('DIAG 3: late history sharing the existing last timestamp must populate all older bars', async () => {
    const hook = await mount();
    mockPriceSeries.setData.mockClear();
    mockPriceSeries.update.mockClear();
    const older: RawBar = { ...initial[0], time: '2026-09-22 13:15:00' };
    hook.rerender({ chartData: [older, ...initial], isLoadingHistory: false });

    expect(mockPriceSeries.setData).toHaveBeenCalled();
  });

  it('DIAG 4: live playback must create the first candle when history is empty', async () => {
    const hook = await mount([], { isLoadingHistory: true });
    hook.rerender({ chartData: [], isLoadingHistory: false });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 35));
    });

    const t = tick('2026-09-22 13:22:42.921', 100, 4);
    act(() => {
      usePlaybackStore.setState({
        currentTick: t,
        latestTickBySymbol: { TSLA: t },
        currentTime: ms(t.time),
        isPaused: false,
      });
    });
    expect(mockPriceSeries.update).toHaveBeenCalled();
  });

  it('DIAG 5: adding a symbol must preserve the global cursor position in the re-sorted buffer', () => {
    const tsla = [
      tick('2026-09-22 13:30:00', 100, 1),
      tick('2026-09-22 13:31:00', 101, 1),
      tick('2026-09-22 13:32:00', 102, 1),
    ];
    usePlaybackStore.getState().setBufferedTicks(tsla);
    usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:31:00'));
    usePlaybackStore.getState().addSymbolTicks('AAPL', [tick('2026-09-22 13:29:00', 200, 1, 'AAPL')]);

    const s = usePlaybackStore.getState();
    expect(s.bufferedTicks[s.currentTickIndex]).toBe(s.currentTick);
  });

  it('DIAG 6: premarket fallback must not add the entire minute volume on each frame', async () => {
    await mount();
    usePlaybackStore.setState({
      masterData: [{ ...initial[0], volume: 1000, symbol: 'TSLA' }],
      bufferedTicks: [],
      isPaused: false,
    });
    act(() => {
      usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:20:00.100'));
    });
    act(() => {
      usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:20:00.200'));
    });

    const actual = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
    expect(actual).toBeLessThanOrEqual(1000);
  });

  it('DIAG 7: ETH-off must exclude premarket ticks during active playback', async () => {
    await mount([{ ...initial[0], time: '2026-09-21 19:55:00', session: 'REG' }], { showEth: false });
    const t = tick('2026-09-22 13:22:42.921', 100, 4);
    act(() => {
      usePlaybackStore.setState({
        currentTick: t,
        latestTickBySymbol: { TSLA: t },
        currentTime: ms(t.time),
        isPaused: false,
      });
    });
    expect(mockPriceSeries.update).not.toHaveBeenCalled();
  });
});
