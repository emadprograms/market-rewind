/**
 * SEEK-BULK-01 guard. Drives the real useChartLifecycle hook with mocked chart series.
 *
 * A seek while playing used to replay every jumped-over bucket through the per-tick path, which
 * issues one series update per bucket. On the 5-minute chart that is about 12 writes for an hour
 * of seek, and the budget in tests/regression/chart/seekWhilePlayingFreeze.spec.ts is a flat 12.
 * The fix skips that batch, sets forceFullRebuildRef, and lets the snapshot rebuild write once per
 * series with setData.
 *
 * Mutation-tested: removing the skip makes test 1 fail (updates > 12); removing the rebuild
 * forcing makes test 1 fail (setData not called with the full snapshot); removing the
 * seenSeekEpoch bookkeeping makes test 3 fail (the paused seek suppresses the next playing frame).
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';

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

const BUCKET_MS = 5 * 60000;
const ms = (t: string) => Date.parse(t.replace(' ', 'T') + 'Z');
const iso = (t: number) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

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

// One tick every 30 seconds from 13:30 to 14:45 UTC: 150 ticks across 15 five-minute buckets.
const START = '2026-09-22 13:30:00';
const ticks = Array.from({ length: 150 }, (_, i) => {
  const t = iso(ms(START) + i * 30000) + '.000';
  return { time: t, price: 100 + (i % 7), volume: 1 + (i % 3), symbol: 'TSLA', session: 'PRE' } as any;
});

// The bars useChartData would publish for the playhead at `upToMs`: one candle per bucket.
function barsThrough(upToMs: number) {
  const byBucket = new Map<number, any>();
  for (const t of ticks) {
    const tMs = ms(t.time);
    if (tMs > upToMs) break;
    const b = Math.floor(tMs / BUCKET_MS) * BUCKET_MS;
    const bar = byBucket.get(b);
    if (!bar) {
      byBucket.set(b, { time: iso(b), open: t.price, high: t.price, low: t.price, close: t.price, volume: t.volume, session: 'PRE' });
    } else {
      bar.high = Math.max(bar.high, t.price);
      bar.low = Math.min(bar.low, t.price);
      bar.close = t.price;
      bar.volume += t.volume;
    }
  }
  return [...byBucket.values()];
}

async function mount(bars: any[]) {
  const hook = renderHook(
    ({ chartData, isLoadingHistory }) => useChartLifecycle({ ...params, chartData, isLoadingHistory }),
    { initialProps: { chartData: bars, isLoadingHistory: false } }
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 35));
  });
  return hook;
}

const seriesWrites = () =>
  mockPriceSeries.update.mock.calls.length + mockPriceSeries.setData.mock.calls.length +
  mockVolumeSeries.update.mock.calls.length + mockVolumeSeries.setData.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  usePlaybackStore.getState().reset();
  usePlaybackStore.setState({ masterData: [], isPaused: true });
});

describe('SEEK-BULK-01: a seek while playing is rebuilt in bulk, not replayed per bucket', () => {
  it('a 60-minute forward seek while playing writes at most 12 times per series and rebuilds the snapshot', async () => {
    const hook = await mount(barsThrough(ms(START)));
    act(() => {
      usePlaybackStore.getState().setBufferedTicks(ticks);
      usePlaybackStore.getState().seekTickTime(ms(START));
      usePlaybackStore.getState().setPaused(false);
    });
    mockPriceSeries.update.mockClear();
    mockPriceSeries.setData.mockClear();
    mockVolumeSeries.update.mockClear();
    mockVolumeSeries.setData.mockClear();

    const target = ms('2026-09-22 14:30:00');
    act(() => usePlaybackStore.getState().seekTickTime(target));
    const afterSeekEvent = seriesWrites();

    // useChartData reacts to seekEpoch by publishing the snapshot for the new playhead.
    hook.rerender({ chartData: barsThrough(target), isLoadingHistory: false });
    const total = seriesWrites();

    expect(afterSeekEvent, 'the seek event itself must not replay buckets').toBeLessThanOrEqual(0);
    expect(total, 'writes for one 60-minute seek on one chart').toBeLessThanOrEqual(12);
    // The bulk rebuild must reach the series with the whole snapshot, not a partial append.
    const lastSet = mockPriceSeries.setData.mock.calls.at(-1)?.[0];
    expect(lastSet?.length).toBe(barsThrough(target).length);
  });

  it('a playback stall without a seek still writes per bucket, so a real stall still renders', async () => {
    await mount(barsThrough(ms(START)));
    act(() => {
      usePlaybackStore.getState().setBufferedTicks(ticks);
      usePlaybackStore.getState().seekTickTime(ms(START));
      usePlaybackStore.getState().setPaused(false);
    });
    mockPriceSeries.update.mockClear();
    mockPriceSeries.setData.mockClear();

    // advanceSimulationTime is playback, not a seek: it must not bump seekEpoch.
    const epochBefore = usePlaybackStore.getState().seekEpoch;
    act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 14:15:00')));
    expect(usePlaybackStore.getState().seekEpoch).toBe(epochBefore);
    expect(mockPriceSeries.update.mock.calls.length).toBeGreaterThanOrEqual(9);
  });

  it('a seek made while paused does not suppress the next playing frame', async () => {
    await mount(barsThrough(ms(START)));
    act(() => {
      usePlaybackStore.getState().setBufferedTicks(ticks);
      usePlaybackStore.getState().seekTickTime(ms(START));
      usePlaybackStore.getState().setPaused(true);
    });
    // Paused seek: the paused path consumes the epoch change.
    act(() => usePlaybackStore.getState().seekTickTime(ms('2026-09-22 14:15:00')));
    mockPriceSeries.update.mockClear();

    act(() => {
      usePlaybackStore.getState().setPaused(false);
    });
    // Playing frame across three buckets, with no seek. It must write per bucket.
    act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 14:30:00')));
    expect(mockPriceSeries.update.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
