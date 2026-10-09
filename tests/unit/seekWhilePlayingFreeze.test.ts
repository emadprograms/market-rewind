/**
 * Guards the seek-while-playing main-thread freeze (and the rewind leak behind it).
 *
 * THE BUG
 *
 * Quick task 261007-nsp made seeking non-pausing: `seekTickTime`, `seekTickIndex`,
 * `stepForward` and `stepBackward` now preserve `isPaused` instead of forcing
 * `isPaused: true`. That removed the only thing keeping the PERF-01 direct-canvas playback
 * subscription (`useChartLifecycle` subscriber 6) off the seek path -- it starts with
 * `if (state.isPaused ...) return`.
 *
 * Subscriber 6 was written for rAF-sized time deltas. On every store notification it scans
 * `symbolTicks` from the last consumed time up to `state.currentTime` and then loops over
 * every elapsed tick calling `priceSeries.update()` AND `volumeSeries.update()` once per
 * tick. A seek is a discontinuity, not a delta: with the default 3-minute STEP on a dense
 * symbol it lands thousands of ticks at once (the buffer is loaded with `limit: 100000` per
 * symbol), so one click performs thousands of chart-primitive updates synchronously inside a
 * zustand subscriber. Measured on this harness: 3,601 candlestick updates for a 4-minute
 * jump spanning 5 one-minute buckets. Dragging the scrubber re-runs that scan on every
 * `onChange` event, and every open chart runs its own copy. The tab stops responding.
 *
 * The same discontinuity broke rewinds: subscriber 6 resets its cursors, then the processing
 * loop's monotonic guard `if (bucketTime < lastCandle.time) continue` silently drops every
 * rewound tick, so the series keeps rendering candles from *after* the playhead -- a
 * future-data leak, which this repo treats as a core invariant violation.
 *
 * The cheap alternative -- the bulk snapshot rebuild driven by React state in `useChartData`
 * -- was unreachable for a seek-while-playing, because that hook only refreshes
 * `globalTime`/`latestTick`/`symbolTicks` when `state.isPaused || ticksChanged`, and a seek
 * changes neither.
 *
 * THE CONTRACT TESTED HERE
 *   1. A forward seek during playback writes at most one candlestick primitive per elapsed
 *      bucket (plus a small constant) -- never one per elapsed tick -- and still lands the
 *      playhead's bucket on the series (non-vacuous).
 *   2. A backward seek during playback must not leave any bucket newer than the playhead on
 *      the series.
 *   3. Repeated scrubber-sized seeks stay linear in the number of seeks.
 *   4. Control: the same jump while paused stays bounded, proving the bound is about the
 *      jump and not about playback merely being armed.
 *
 * The harness reproduces the real `useChartData -> useChartLifecycle` pipeline: a stand-in
 * data hook recomputes the candle snapshot under exactly the refresh rule `useChartData`
 * uses, so a fix that only silences subscriber 6 (leaving the chart frozen) fails here.
 */
import { useEffect, useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import { getBucketTime } from '../../src/lib/dailyIndex';
import type { MarketTick, RawBar, Timeframe } from '../../src/types';

// --------------------------------------------------------------------- mocked chart

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
  createPriceLine: vi.fn(() => ({})),
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
    vpPluginRef: { current: null },
    rayPluginRef: { current: null },
    rectPluginRef: { current: null },
    tradePluginRef: { current: null },
    updateShadingConfig: vi.fn(),
    pluginVersion: 0,
  })),
}));

// --------------------------------------------------------------------- fixtures

const SYMBOL = 'SPY';
const TF: Timeframe = '1min';
const TF_SECONDS = 60;

/** 2026-09-25 13:30:00Z == 09:30 EDT, the RTH open. */
const T0 = isoToMs('2026-09-25 13:30:00');

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** App-format UTC timestamp: 'YYYY-MM-DD HH:MM:SS.mmm' */
function msToAppTime(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}`
  );
}

/**
 * Dense but realistic tape: 20 prints/second for `minutes` minutes from T0.
 * 6 minutes -> 7,200 ticks, so the default 3-minute STEP jumps 3,600 of them.
 */
function buildTicks(minutes: number, ticksPerSecond = 20): MarketTick[] {
  const total = minutes * 60 * ticksPerSecond;
  const stepMs = 1000 / ticksPerSecond;
  const ticks: MarketTick[] = [];
  for (let i = 0; i < total; i++) {
    const ms = T0 + i * stepMs;
    const price = 500 + Math.sin(i / 97) * 1.5;
    ticks.push({
      time: msToAppTime(ms),
      price: Number(price.toFixed(2)),
      volume: 100,
      symbol: SYMBOL,
      session: 'REG',
      source: 'STREAMING',
    } as MarketTick);
  }
  return ticks;
}

/** 1-minute candidate bars covering the tape, as the streaming service would return them. */
function buildBars(fromMs: number, toMs: number): RawBar[] {
  const bars: RawBar[] = [];
  for (let ms = fromMs; ms <= toMs; ms += 60000) {
    const open = 500;
    bars.push({
      time: msToAppTime(ms).slice(0, 19),
      open,
      high: open + 1,
      low: open - 1,
      close: open + 0.5,
      volume: 12000,
      session: 'REG',
    } as RawBar);
  }
  return bars;
}

/** Inclusive count of `TF` buckets between two timestamps. */
function bucketsBetween(fromMs: number, toMs: number): number {
  return Math.round((getBucketTime(toMs, TF) - getBucketTime(fromMs, TF)) / TF_SECONDS) + 1;
}

/**
 * Stand-in for `useChartData`: completed 1-minute bars strictly before the playhead plus a
 * forming bucket synthesized from the elapsed ticks -- the same temporal-isolation rule, and
 * refreshed under the same subscription rule `useChartData` uses.
 */
function computeSnapshot(cutoff: number | null, bars: RawBar[], ticks: MarketTick[]): RawBar[] {
  if (cutoff === null) return [];
  const out: RawBar[] = [];
  for (const b of bars) {
    if (isoToMs(b.time) + 60000 <= cutoff) out.push(b);
  }
  const bucketStart = Math.floor(cutoff / 60000) * 60000;
  let open = 0;
  let high = -Infinity;
  let low = Infinity;
  let close = 0;
  let volume = 0;
  let count = 0;
  for (const t of ticks) {
    const ms = isoToMs(t.time);
    if (ms < bucketStart) continue;
    if (ms > cutoff) break;
    if (count === 0) open = t.price;
    high = Math.max(high, t.price);
    low = Math.min(low, t.price);
    close = t.price;
    volume += t.volume || 0;
    count += 1;
  }
  if (count > 0) {
    out.push({
      time: msToAppTime(bucketStart).slice(0, 19),
      open,
      high,
      low,
      close,
      volume: Number(volume.toFixed(4)),
      session: 'REG',
    } as RawBar);
  }
  return out;
}

/** Mirrors `useChartData`'s playback subscription: refresh when paused, when the tape
 *  identity changes, or when the playhead was explicitly seeked. */
function useStandInChartData(bars: RawBar[], ticks: MarketTick[]): RawBar[] {
  const initial = usePlaybackStore.getState();
  const [snapshot, setSnapshot] = useState<RawBar[]>(() =>
    computeSnapshot(initial.currentTime, bars, ticks)
  );

  useEffect(() => {
    let prevTicks = usePlaybackStore.getState().ticksBySymbol?.[SYMBOL];
    let prevSeekEpoch = (usePlaybackStore.getState() as any).seekEpoch;
    setSnapshot(
      computeSnapshot(usePlaybackStore.getState().currentTime, bars, ticks)
    );
    const unsub = usePlaybackStore.subscribe((state: any) => {
      const currentTicks = state.ticksBySymbol?.[SYMBOL];
      const ticksChanged = currentTicks !== prevTicks;
      if (ticksChanged) prevTicks = currentTicks;
      const seekChanged = state.seekEpoch !== prevSeekEpoch;
      if (seekChanged) prevSeekEpoch = state.seekEpoch;
      if (state.isPaused || ticksChanged || seekChanged) {
        setSnapshot(computeSnapshot(state.currentTime, bars, ticks));
      }
    });
    return unsub;
  }, [bars, ticks]);

  return snapshot;
}

// --------------------------------------------------------------------- harness

/** Hand-cranked rAF so chart hydration is deterministic (see primitiveUpdateContract). */
function installRafQueue() {
  const scheduled: FrameRequestCallback[] = [];
  let id = 0;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    id += 1;
    scheduled.push(cb);
    return id;
  };
  (window as any).cancelAnimationFrame = () => {};
  return {
    drain() {
      const pending = scheduled.slice();
      scheduled.length = 0;
      for (const cb of pending) {
        try {
          cb(performance.now());
        } catch {
          /* jsdom draw edge cases are irrelevant here */
        }
      }
    },
  };
}

const baseParams = {
  chartContainerRef: { current: document.createElement('div') },
  ticker: SYMBOL,
  timeframe: TF,
  showEth: false,
  showVP: false,
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

/**
 * Mounts the real `useChartLifecycle` behind the stand-in data hook, hydrates the chart and
 * arms playback WITHOUT moving time -- so the seek under test is the only discontinuity.
 */
function mountPlayingChart(bars: RawBar[], ticks: MarketTick[], raf: { drain(): void }) {
  usePlaybackStore.getState().reset();
  usePlaybackStore.getState().setBufferedTicks(ticks);
  usePlaybackStore.getState().setMasterData(bars);
  usePlaybackStore.getState().seekTickTime(T0);

  const hook = renderHook(() => {
    const chartData = useStandInChartData(bars, ticks);
    useChartLifecycle({ ...baseParams, chartData } as any);
    return chartData;
  });

  // Snapshot effect schedules hydration on the next frame.
  act(() => {
    raf.drain();
  });

  act(() => {
    usePlaybackStore.getState().setPaused(false);
  });

  mockPriceSeries.setData.mockClear();
  mockPriceSeries.update.mockClear();
  mockVolumeSeries.setData.mockClear();
  mockVolumeSeries.update.mockClear();

  return hook;
}

/** Every bucket second ever handed to the candlestick series, in write order. */
function writtenBucketTimes(): number[] {
  const times: number[] = [];
  for (const call of mockPriceSeries.setData.mock.calls) {
    for (const bar of (call[0] || []) as any[]) times.push(bar.time as number);
  }
  for (const call of mockPriceSeries.update.mock.calls) {
    times.push((call[0] as any).time as number);
  }
  return times;
}

// --------------------------------------------------------------------- tests

describe('seek while playing must not replay the tape tick-by-tick', () => {
  let raf: { drain(): void };
  let bars: RawBar[];
  let ticks: MarketTick[];

  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
    raf = installRafQueue();
    ticks = buildTicks(6);
    bars = buildBars(T0, T0 + 6 * 60000);
  });

  it('a 3-minute forward seek writes per bucket, not per tick, and still lands the playhead', () => {
    mountPlayingChart(bars, ticks, raf);

    const target = T0 + 3 * 60000;
    const elapsedTicks = ticks.filter((t) => {
      const ms = isoToMs(t.time);
      return ms > T0 && ms <= target;
    }).length;

    // Sanity: this really is a tick-level discontinuity, not a frame-sized delta.
    expect(elapsedTicks).toBeGreaterThan(1000);

    const started = performance.now();
    act(() => {
      usePlaybackStore.getState().seekTickTime(target);
    });
    const elapsedMs = performance.now() - started;

    const priceUpdates = mockPriceSeries.update.mock.calls.length;
    const budget = bucketsBetween(T0, target) + 2;

    // THE CONTRACT: chart primitives are written per candle bucket, never per tick.
    expect(priceUpdates).toBeLessThanOrEqual(budget);

    // Non-vacuous, and strong enough to kill a "flush only at the end" mutant: every bucket
    // the playhead travelled through must reach the series, not just the landing bucket.
    const written = new Set(writtenBucketTimes());
    const missing: number[] = [];
    for (let b = getBucketTime(T0, TF); b <= getBucketTime(target, TF); b += TF_SECONDS) {
      if (!written.has(b)) missing.push(b);
    }
    expect(missing).toEqual([]);

    // A single seek must stay inside a frame budget on the main thread.
    expect(elapsedMs).toBeLessThan(50);

    // The playhead really moved and playback was not force-paused (261007-nsp behaviour).
    expect(usePlaybackStore.getState().currentTime).toBe(target);
    expect(usePlaybackStore.getState().isPaused).toBe(false);
  });

  it('a backward seek during playback leaves no future candles on the series', () => {
    mountPlayingChart(bars, ticks, raf);

    const forward = T0 + 4 * 60000;
    const backward = T0 + 1 * 60000;

    act(() => {
      usePlaybackStore.getState().seekTickTime(forward);
    });
    // The forward jump must have reached the future bucket before we rewind from it.
    expect(writtenBucketTimes()).toContain(getBucketTime(forward, TF));

    mockPriceSeries.setData.mockClear();
    mockPriceSeries.update.mockClear();

    act(() => {
      usePlaybackStore.getState().seekTickTime(backward);
    });

    const written = writtenBucketTimes();
    expect(written.length).toBeGreaterThan(0);

    // Zero future data leakage: nothing newer than the playhead's bucket may remain.
    expect(Math.max(...written)).toBeLessThanOrEqual(getBucketTime(backward, TF));
    expect(usePlaybackStore.getState().isPaused).toBe(false);
  });

  it('repeated scrubber-sized seeks stay linear in the number of seeks', () => {
    mountPlayingChart(bars, ticks, raf);

    // A slider drag fires a seek per input event; 30 events across the tape must not
    // degrade into re-replaying the whole buffer on every event.
    for (let i = 1; i <= 30; i++) {
      act(() => {
        usePlaybackStore.getState().seekTickTime(T0 + i * 12000);
      });
    }

    const perSeekBudget = bucketsBetween(T0, T0 + 6 * 60000) + 2;
    expect(mockPriceSeries.update.mock.calls.length).toBeLessThanOrEqual(
      30 * perSeekBudget
    );
  });

  it('the same 3-minute jump while paused is also bounded (control)', () => {
    mountPlayingChart(bars, ticks, raf);

    act(() => {
      usePlaybackStore.getState().setPaused(true);
    });
    mockPriceSeries.update.mockClear();
    mockPriceSeries.setData.mockClear();

    const target = T0 + 3 * 60000;
    act(() => {
      usePlaybackStore.getState().seekTickTime(target);
    });

    expect(mockPriceSeries.update.mock.calls.length).toBeLessThanOrEqual(
      bucketsBetween(T0, target) + 2
    );

    const written = new Set(writtenBucketTimes());
    const missing: number[] = [];
    for (let b = getBucketTime(T0, TF); b <= getBucketTime(target, TF); b += TF_SECONDS) {
      if (!written.has(b)) missing.push(b);
    }
    expect(missing).toEqual([]);
  });

  it('frame-sized playback deltas still update the canvas directly (no React round-trip)', () => {
    // The PERF-01 contract must survive the fix: ordinary playback advances without a
    // snapshot rebuild, otherwise every frame would re-render the chart tree.
    mountPlayingChart(bars, ticks, raf);

    mockPriceSeries.setData.mockClear();
    mockPriceSeries.update.mockClear();

    act(() => {
      usePlaybackStore.getState().advanceSimulationTime(T0 + 900);
    });

    expect(usePlaybackStore.getState().isPaused).toBe(false);
    expect(mockPriceSeries.update.mock.calls.length).toBeGreaterThan(0);
    expect(mockPriceSeries.update.mock.calls.length).toBeLessThanOrEqual(3);
    expect(mockPriceSeries.setData).not.toHaveBeenCalled();
  });
});
