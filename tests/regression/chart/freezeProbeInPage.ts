/**
 * In-page probe functions for the seek-while-playing freeze spec.
 *
 * EVERY exported function here is handed to `page.evaluate()` / `page.waitForFunction()`, which
 * means Playwright serializes it and runs it in the browser with **no closure and no module
 * scope**. Two rules follow, and they are the whole reason this file exists:
 *
 *   1. No imports, no module-scope constants, no references to anything declared in the spec.
 *   2. Everything a function needs arrives as a parameter.
 *
 * Breaking rule 1 produces `ReferenceError: X is not defined` **inside the browser only** — it
 * type-checks, it transpiles, `--list` is happy, and the failure does not surface until a full
 * E2E cycle has been spent on a machine with a browser and a tick lake. That happened once
 * already (`reset` was closed over instead of passed), which is why
 * `tests/unit/freezeProbeInPage.test.ts` both exercises these functions in jsdom and lints their
 * ASTs for free variables.
 *
 * Keep every function self-contained. If a value must come from the spec, add a parameter.
 */

export interface ProbeChartRecord {
  index: number;
  updateCalls: number;
  setDataCalls: number;
  barsWritten: number;
}

export interface ProbeTotals {
  heartbeatMaxGapMs: number;
  heartbeatSupported: boolean;
  longTasks: { count: number; totalMs: number; maxMs: number; supported: boolean };
  charts: ProbeChartRecord[];
}

export interface ProbeContext {
  totalTicks: number;
  isPaused: boolean | null;
  playbackSpeed: number | null;
  stepMinutes: number | null;
  currentTime: number | null;
  firstTickMs: number | null;
  lastTickMs: number | null;
  masterDataBars: number;
}

export interface ProbeSnapshot {
  probe: ProbeTotals | null;
  context: ProbeContext;
}

/**
 * Installs the rAF heartbeat, the `longtask` observer and per-chart primitive counters.
 *
 * The counters wrap `__priceSeries.update`/`setData` (exposed by useChartInit on each
 * `[data-testid="chart-container"]`), which is how "one write per tick" is distinguished from
 * "one write per bucket" without touching application code.
 */
export function installFreezeProbe(): void {
  const w = window as any;
  w.__freezeProbe = {
    heartbeatMaxGapMs: 0,
    heartbeatSupported: false,
    longTasks: { count: 0, totalMs: 0, maxMs: 0, supported: true },
    charts: [],
  };

  // A blocked main thread shows up as a large gap between animation frames. This is the
  // objective form of "the page went unresponsive".
  let last = performance.now();
  const beat = () => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    if (gap > w.__freezeProbe.heartbeatMaxGapMs) w.__freezeProbe.heartbeatMaxGapMs = gap;
    requestAnimationFrame(beat);
  };
  if (typeof requestAnimationFrame === 'function') {
    w.__freezeProbe.heartbeatSupported = true;
    requestAnimationFrame(beat);
  }

  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        const lt = w.__freezeProbe.longTasks;
        lt.count += 1;
        lt.totalMs += entry.duration;
        if (entry.duration > lt.maxMs) lt.maxMs = entry.duration;
      }
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch {
    // jsdom and some browsers do not expose the longtask entry type.
    w.__freezeProbe.longTasks.supported = false;
  }

  const containers = document.querySelectorAll('[data-testid="chart-container"]');
  for (let index = 0; index < containers.length; index++) {
    const series = (containers[index] as any).__priceSeries;
    if (!series) continue;
    const rec = { index, updateCalls: 0, setDataCalls: 0, barsWritten: 0 };
    w.__freezeProbe.charts.push(rec);
    const origUpdate = series.update.bind(series);
    series.update = (...args: any[]) => {
      rec.updateCalls += 1;
      rec.barsWritten += 1;
      return origUpdate(...args);
    };
    const origSetData = series.setData.bind(series);
    series.setData = (...args: any[]) => {
      rec.setDataCalls += 1;
      rec.barsWritten += (args[0] || []).length;
      return origSetData(...args);
    };
  }
}

/**
 * Reads the probe plus the tape/playhead context. Pass `reset: true` to zero the counters after
 * reading, which is how per-seek measurements are isolated from each other.
 */
export function readFreezeProbe(reset: boolean): ProbeSnapshot {
  const w = window as any;
  const store = w.usePlaybackStore && w.usePlaybackStore.getState ? w.usePlaybackStore.getState() : null;
  const buffered = (store && store.bufferedTicks) || [];

  const parse = (t: any): number | null => {
    if (t === null || t === undefined) return null;
    if (typeof t === 'number') return t < 1e11 ? t * 1000 : t;
    const text = String(t).replace(' ', 'T');
    const ms = Date.parse(text.endsWith('Z') ? text : text + 'Z');
    return Number.isFinite(ms) ? ms : null;
  };

  const probe = w.__freezeProbe
    ? {
        heartbeatMaxGapMs: Math.round(w.__freezeProbe.heartbeatMaxGapMs),
        heartbeatSupported: !!w.__freezeProbe.heartbeatSupported,
        longTasks: {
          count: w.__freezeProbe.longTasks.count,
          totalMs: Math.round(w.__freezeProbe.longTasks.totalMs),
          maxMs: Math.round(w.__freezeProbe.longTasks.maxMs),
          supported: w.__freezeProbe.longTasks.supported,
        },
        charts: w.__freezeProbe.charts.map((c: any) => ({
          index: c.index,
          updateCalls: c.updateCalls,
          setDataCalls: c.setDataCalls,
          barsWritten: c.barsWritten,
        })),
      }
    : null;

  const snapshot: ProbeSnapshot = {
    probe,
    context: {
      totalTicks: store ? store.totalTicks || 0 : 0,
      isPaused: store ? store.isPaused : null,
      playbackSpeed: store ? store.playbackSpeed : null,
      stepMinutes: store ? store.stepMinutes : null,
      currentTime: store ? store.currentTime : null,
      firstTickMs: buffered.length ? parse(buffered[0].time) : null,
      lastTickMs: buffered.length ? parse(buffered[buffered.length - 1].time) : null,
      masterDataBars: store && store.masterData ? store.masterData.length : 0,
    },
  };

  if (reset && w.__freezeProbe) {
    w.__freezeProbe.heartbeatMaxGapMs = 0;
    w.__freezeProbe.longTasks.count = 0;
    w.__freezeProbe.longTasks.totalMs = 0;
    w.__freezeProbe.longTasks.maxMs = 0;
    for (const c of w.__freezeProbe.charts) {
      c.updateCalls = 0;
      c.setDataCalls = 0;
      c.barsWritten = 0;
    }
  }

  return snapshot;
}

/** Bar times (UNIX seconds) currently held by chart `index`'s price series. */
export function seriesBarTimes(index: number): number[] {
  const el = document.querySelectorAll('[data-testid="chart-container"]')[index] as any;
  const series = el && el.__priceSeries;
  if (!series || typeof series.data !== 'function') return [];
  const data = series.data() || [];
  const out: number[] = [];
  for (const d of data) {
    const t = typeof d.time === 'number' ? d.time : Date.parse(String(d.time)) / 1000;
    if (Number.isFinite(t)) out.push(t);
  }
  return out;
}

/** True while playback is running — the predicate behind "the seek must not pause playback". */
export function isPlaying(): boolean {
  const w = window as any;
  const store = w.usePlaybackStore && w.usePlaybackStore.getState ? w.usePlaybackStore.getState() : null;
  return !!store && store.isPaused === false;
}

/** Seeks to an absolute epoch-ms target. Exactly what the scrubber's onChange dispatches. */
export function seekToMs(targetMs: number): void {
  (window as any).usePlaybackStore.getState().seekTickTime(targetMs);
}

export interface StoreSeekMeasurement {
  storeSeekMs: number;
  targetMs: number;
  currentTimeBefore: number | null;
  bufferedTicks: number;
  isPausedAfter: boolean | null;
}

/**
 * Times one synchronous store-side seek by relative offset.
 *
 * This is the measurement that sizes the O(buffered ticks) `latestTickBySymbol` rebuild that the
 * freeze fix deliberately left alone: it is store-side work, so it is unaffected by canvas
 * coalescing and grows with the buffer rather than with seek distance.
 */
export function measureStoreSeekBy(offsetMs: number): StoreSeekMeasurement {
  const store = (window as any).usePlaybackStore.getState();
  const before = typeof store.currentTime === 'number' ? store.currentTime : null;
  const targetMs = (before === null ? 0 : before) + offsetMs;
  const start = performance.now();
  store.seekTickTime(targetMs);
  const storeSeekMs = Math.round((performance.now() - start) * 100) / 100;
  // Re-read the store: zustand's set() produced a new state object, so the snapshot above cannot
  // report whether the seek auto-paused at end-of-session.
  const after = (window as any).usePlaybackStore.getState();
  return {
    storeSeekMs,
    targetMs,
    currentTimeBefore: before,
    bufferedTicks: after.totalTicks || 0,
    isPausedAfter: after.isPaused,
  };
}

/** Times one synchronous store-side seek to an absolute target. */
export function measureStoreSeekTo(targetMs: number): StoreSeekMeasurement {
  const store = (window as any).usePlaybackStore.getState();
  const before = typeof store.currentTime === 'number' ? store.currentTime : null;
  const start = performance.now();
  store.seekTickTime(targetMs);
  const storeSeekMs = Math.round((performance.now() - start) * 100) / 100;
  const after = (window as any).usePlaybackStore.getState();
  return {
    storeSeekMs,
    targetMs,
    currentTimeBefore: before,
    bufferedTicks: after.totalTicks || 0,
    isPausedAfter: after.isPaused,
  };
}

/** Chromium-only JS heap size in bytes, or null where `performance.memory` is unavailable. */
export function heapUsedBytes(): number | null {
  const mem = (performance as any).memory;
  return mem && typeof mem.usedJSHeapSize === 'number' ? mem.usedJSHeapSize : null;
}
