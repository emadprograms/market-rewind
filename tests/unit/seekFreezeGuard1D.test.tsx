/**
 * Seek-freeze guard for the 1D chart (cause 2 of the seek-while-playing freeze).
 *
 * A 1D chart has one bucket per day, so a seek inside the session never takes the SEEK-BULK-01
 * skip: a playback catch-up over an hour of tape runs the per-tick path. Before the fix, every one
 * of those ticks re-aggregated the day bucket and re-scanned the forming minute from the END of the
 * whole day's tape, so the cost was roughly (catch-up ticks) x (future ticks). The fix memoises the
 * tick-independent aggregate per (bucket, evaluation time) and starts the scan at the playhead
 * (binary search).
 *
 * This drives the real useChartLifecycle hook and counts reads of the tape array. The tape is
 * wrapped in a Proxy, so every index read is counted. A regression shows up as a read count that is
 * orders of magnitude above the number of catch-up ticks.
 *
 * Mutation-tested (see the report in the commit message): removing the memo, or restoring the
 * end-of-tape scan start, must make the bounds below fail.
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

const ms = (t: string) => Date.parse(t.replace(' ', 'T') + 'Z');
const iso = (t: number) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

const SYM = 'TSLA';
const RTH_START = ms('2026-10-07 13:30:00');
const RTH_END = ms('2026-10-07 20:00:00');
const HOUR_MS = 60 * 60000;

// One regular-session tick per second for the whole session: 23,400 ticks.
const tape = Array.from({ length: (RTH_END - RTH_START) / 1000 }, (_, i) => {
  const t = iso(RTH_START + i * 1000) + '.000';
  return { time: t, price: 100 + (i % 7), volume: 1 + (i % 3), symbol: SYM, session: 'REG' } as any;
});

const params = {
  chartContainerRef: { current: document.createElement('div') },
  ticker: SYM,
  timeframe: '1D' as const,
  showEth: false,
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

async function mount() {
  // The chart hydrates only on a loading -> loaded transition, so start loading, then finish.
  const hook = renderHook(
    ({ chartData, isLoadingHistory }) => useChartLifecycle({ ...params, chartData, isLoadingHistory }),
    { initialProps: { chartData: [] as any[], isLoadingHistory: true } }
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 35));
  });
  hook.rerender({ chartData: [], isLoadingHistory: false });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 35));
  });
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlaybackStore.getState().reset();
  usePlaybackStore.setState({ masterData: [], isPaused: true });
});

describe('SEEK-FREEZE-1D: a playback catch-up on the 1D chart does not re-scan the tape per tick', () => {
  it('a 60-minute catch-up on a 1D chart reads O(ticks) tape cells, not O(ticks x tape)', async () => {
    await mount();
    act(() => {
      usePlaybackStore.getState().setBufferedTicks(tape);
      usePlaybackStore.getState().seekTickTime(RTH_START);
      usePlaybackStore.getState().setPaused(false);
    });

    // setBufferedTicks copies the tape per symbol, so wrap the copy the store actually holds.
    let reads = 0;
    const stored = usePlaybackStore.getState().ticksBySymbol[SYM];
    const counted = new Proxy(stored, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
        return Reflect.get(target, prop, receiver);
      },
    });
    act(() => {
      usePlaybackStore.setState({ ticksBySymbol: { [SYM]: counted as any } });
    });
    reads = 0;

    // Playback advances one hour in one frame: about 3,600 ticks are caught up on the 1D chart.
    act(() => usePlaybackStore.getState().advanceSimulationTime(RTH_START + HOUR_MS));

    const catchUpTicks = HOUR_MS / 1000;
    // The catch-up really ran: at least one read per consumed tick.
    expect(reads, 'the catch-up must consume the hour of tape').toBeGreaterThanOrEqual(catchUpTicks);
    // Linear budget: one pass over the caught-up ticks plus a few binary searches. The regression
    // (a forming-minute scan from the end of the tape, redone per tick) costs about 270,000 reads.
    expect(reads, 'tape reads for one hour of 1D catch-up').toBeLessThanOrEqual(2 * catchUpTicks + 1000);
  });
});
