import { test, expect } from '@playwright/test';
import { startSession, chartCard, collectPageErrors, SEED_DATE } from '../e2e-utils';

/**
 * E2E guard for the seek-while-playing freeze.
 * Debug session: .planning/debug/seek-while-playing-freeze.md
 *
 * THE BUG
 *
 * Since 261007-nsp a seek no longer pauses playback. `useChartLifecycle` subscriber 6 (the
 * PERF-01 direct-canvas playback path) treated the resulting time jump as elapsed playback and
 * replayed every jumped-over tick individually -- one candlestick write plus one volume write
 * per tick, synchronously, inside a zustand subscriber. On a dense tape a single 3-minute step
 * issued thousands of chart-primitive writes per open chart, repeated on every scrubber
 * `onChange`: the tab stopped responding. A rewind was worse than slow -- nothing was written
 * at all, so candles from *after* the playhead stayed on screen.
 *
 * WHAT IS MEASURED HERE
 *
 * Everything is measured through the real UI (PLAY button, step buttons, store-level seeks that
 * are exactly what the scrubber's onChange dispatches) against the real DuckDB tape:
 *
 *   1. Main-thread responsiveness -- a rAF heartbeat records the largest gap between frames, and
 *      a `longtask` PerformanceObserver records blocking work. A frozen tab shows up as a
 *      multi-second heartbeat gap; this is the objective form of "the page went unresponsive".
 *   2. Chart-primitive write volume per seek -- `__priceSeries.update`/`setData` are counted per
 *      chart. With the default 5min + 1D layout a 3-minute step must write a handful of
 *      primitives, never one per tick.
 *   3. Temporal isolation on rewind -- after seeking backwards while playing, no bar newer than
 *      the playhead's bucket may remain in the series.
 *
 * A JSON `FREEZE-REPORT` block is always printed to the console (pass or fail) so the numbers can
 * be compared against the same run on `main`.
 *
 * Override the tape with SEEK_SYMBOL / SEEK_DATE / SEEK_ENTRY when a denser session is available.
 */

const SYMBOL = process.env.SEEK_SYMBOL || 'AAPL';
const DATE = process.env.SEEK_DATE || SEED_DATE;
const ENTRY = process.env.SEEK_ENTRY || '09:30';

/** Max frame gap tolerated while seeking. A blocked main thread blows straight through this. */
const STALL_BUDGET_MS = 1500;
/** Default layout is 5min + 1D, so a 3-minute step spans at most a couple of buckets. */
const WRITES_PER_SEEK_BUDGET = 12;

/** Installs the heartbeat, the long-task observer and per-chart primitive counters. */
async function installProbe(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__freezeProbe = {
      heartbeatMaxGapMs: 0,
      longTasks: { count: 0, totalMs: 0, maxMs: 0, supported: true },
      charts: [] as any[],
    };

    let last = performance.now();
    const beat = () => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      if (gap > w.__freezeProbe.heartbeatMaxGapMs) w.__freezeProbe.heartbeatMaxGapMs = gap;
      requestAnimationFrame(beat);
    };
    requestAnimationFrame(beat);

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
      w.__freezeProbe.longTasks.supported = false;
    }

    document.querySelectorAll('[data-testid="chart-container"]').forEach((el, index) => {
      const series = (el as any).__priceSeries;
      if (!series) return;
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
    });
  });
}

/** Reads (and optionally resets) the probe, plus the tape/playhead context for the report. */
async function readProbe(page: import('@playwright/test').Page, reset = false) {
  const report = await page.evaluate(() => {
    const w = window as any;
    const store = w.usePlaybackStore?.getState();
    const buffered = store?.bufferedTicks || [];
    const parse = (t: any) =>
      typeof t === 'number'
        ? t < 1e11 ? t * 1000 : t
        : new Date(String(t).replace(' ', 'T') + (String(t).includes('Z') ? '' : 'Z')).getTime();
    const snapshot = {
      probe: w.__freezeProbe
        ? {
            heartbeatMaxGapMs: Math.round(w.__freezeProbe.heartbeatMaxGapMs),
            longTasks: {
              count: w.__freezeProbe.longTasks.count,
              totalMs: Math.round(w.__freezeProbe.longTasks.totalMs),
              maxMs: Math.round(w.__freezeProbe.longTasks.maxMs),
              supported: w.__freezeProbe.longTasks.supported,
            },
            charts: w.__freezeProbe.charts.map((c: any) => ({ ...c })),
          }
        : null,
      context: {
        totalTicks: store?.totalTicks ?? 0,
        isPaused: store?.isPaused ?? null,
        playbackSpeed: store?.playbackSpeed ?? null,
        stepMinutes: store?.stepMinutes ?? null,
        currentTime: store?.currentTime ?? null,
        firstTickMs: buffered.length ? parse(buffered[0].time) : null,
        lastTickMs: buffered.length ? parse(buffered[buffered.length - 1].time) : null,
        masterDataBars: store?.masterData?.length ?? 0,
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
  });
  return report;
}

/** Series bar times (UNIX seconds) for chart `index`, as lightweight-charts holds them. */
async function seriesTimes(page: import('@playwright/test').Page, index = 0): Promise<number[]> {
  return page.evaluate((i) => {
    const el = document.querySelectorAll('[data-testid="chart-container"]')[i] as any;
    const data = el?.__priceSeries?.data?.() || [];
    return data
      .map((d: any) => (typeof d.time === 'number' ? d.time : Date.parse(String(d.time)) / 1000))
      .filter((t: number) => Number.isFinite(t));
  }, index);
}

test.describe('Seek While Playing — Freeze & Temporal Isolation (E2E)', () => {
  test('stepping forward and backward while playing keeps the main thread responsive', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, SYMBOL, DATE, ENTRY);
    await expect(chartCard(page, 0).locator('canvas').first()).toBeVisible();

    await installProbe(page);
    const before = await readProbe(page);

    // Move the playhead into the buffered tape when there is one, so the step really does jump
    // over raw ticks rather than only over synthesized bar ticks.
    const { firstTickMs, lastTickMs, totalTicks } = before.context;
    if (totalTicks > 500 && firstTickMs !== null && lastTickMs !== null) {
      const parkAt = firstTickMs + Math.floor((lastTickMs - firstTickMs) * 0.1);
      await page.evaluate((t) => (window as any).usePlaybackStore.getState().seekTickTime(t), parkAt);
      await page.waitForTimeout(300);
    }

    await page.getByRole('button', { name: /PLAY/i }).click();
    await page.waitForFunction(() => (window as any).usePlaybackStore.getState().isPaused === false, {
      timeout: 10000,
    });
    await page.waitForTimeout(1000);

    const perSeek: any[] = [];
    const stepForward = page.locator('[data-testid="step-forward-btn"]');
    const stepBackward = page.locator('[data-testid="step-backward-btn"]');

    // Reaching the end of the session data auto-pauses by design (261007-nsp), so only assert
    // "still playing" when the tape is long enough that five 3-minute steps cannot exhaust it.
    const spanMs = firstTickMs !== null && lastTickMs !== null ? lastTickMs - firstTickMs : 0;
    const canAssertStillPlaying = totalTicks > 500 && spanMs > 45 * 60000;

    for (let i = 0; i < 5; i++) {
      await readProbe(page, true);
      const t0 = Date.now();
      await stepForward.click();
      // If the main thread is blocked, this evaluation cannot even be dispatched until it frees.
      await page.evaluate(() => undefined);
      const dispatchLatencyMs = Date.now() - t0;
      await page.waitForTimeout(400);
      const after = await readProbe(page);
      perSeek.push({
        direction: 'forward',
        dispatchLatencyMs,
        heartbeatMaxGapMs: after.probe?.heartbeatMaxGapMs,
        longTaskMaxMs: after.probe?.longTasks.maxMs,
        writes: after.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
        isPaused: after.context.isPaused,
      });
    }

    for (let i = 0; i < 3; i++) {
      await readProbe(page, true);
      const t0 = Date.now();
      await stepBackward.click();
      await page.evaluate(() => undefined);
      const dispatchLatencyMs = Date.now() - t0;
      await page.waitForTimeout(400);
      const after = await readProbe(page);
      perSeek.push({
        direction: 'backward',
        dispatchLatencyMs,
        heartbeatMaxGapMs: after.probe?.heartbeatMaxGapMs,
        longTaskMaxMs: after.probe?.longTasks.maxMs,
        writes: after.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
        isPaused: after.context.isPaused,
      });
    }

    const final = await readProbe(page);
    console.log(
      'FREEZE-REPORT ' +
        JSON.stringify(
          {
            test: 'step-while-playing',
            tape: { totalTicks, spanMinutes: Math.round(spanMs / 60000), masterDataBars: before.context.masterDataBars },
            perSeek,
            totals: final.probe,
          },
          null,
          2
        )
    );

    // The tab must never stall: no frame gap and no dispatch latency anywhere near a freeze.
    for (const s of perSeek) {
      expect(s.heartbeatMaxGapMs, `frame stalled during a ${s.direction} seek`).toBeLessThan(STALL_BUDGET_MS);
      expect(s.dispatchLatencyMs, `main thread blocked during a ${s.direction} seek`).toBeLessThan(STALL_BUDGET_MS);
      // A seek must not pause playback (261007-nsp), except at end-of-session data.
      if (s.direction === 'forward' && canAssertStillPlaying) {
        expect(s.isPaused, 'forward seek force-paused playback').toBe(false);
      }
      for (const w of s.writes || []) {
        expect(w, 'chart primitives written per seek (one per tick = the bug)').toBeLessThanOrEqual(
          WRITES_PER_SEEK_BUDGET
        );
      }
    }

    expect(pageErrors).toEqual([]);
  });

  test('rapid scrubbing while playing does not degrade into a per-tick replay', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, SYMBOL, DATE, ENTRY);
    await installProbe(page);
    const before = await readProbe(page);
    const { firstTickMs, lastTickMs, totalTicks } = before.context;

    test.skip(
      totalTicks < 500 || firstTickMs === null || lastTickMs === null,
      `tape too thin to exercise the seek catch-up (totalTicks=${totalTicks}); re-run with SEEK_SYMBOL/SEEK_DATE pointing at a dense session`
    );

    await page.evaluate((t) => (window as any).usePlaybackStore.getState().seekTickTime(t), firstTickMs!);
    await page.getByRole('button', { name: /PLAY/i }).click();
    await page.waitForFunction(() => (window as any).usePlaybackStore.getState().isPaused === false, {
      timeout: 10000,
    });
    await page.waitForTimeout(500);

    await readProbe(page, true);

    // 30 scrubber-sized seeks across the tape: exactly what dragging the slider dispatches.
    const span = lastTickMs! - firstTickMs!;
    const started = Date.now();
    for (let i = 1; i <= 30; i++) {
      const target = firstTickMs! + Math.floor((span * i) / 31);
      await page.evaluate((t) => (window as any).usePlaybackStore.getState().seekTickTime(t), target);
    }
    await page.evaluate(() => undefined);
    const wallMs = Date.now() - started;
    await page.waitForTimeout(600);

    const after = await readProbe(page);
    console.log(
      'FREEZE-REPORT ' +
        JSON.stringify(
          {
            test: 'rapid-scrub-while-playing',
            tape: { totalTicks, spanMinutes: Math.round(span / 60000) },
            seeks: 30,
            wallMs,
            probe: after.probe,
          },
          null,
          2
        )
    );

    expect(after.probe!.heartbeatMaxGapMs).toBeLessThan(STALL_BUDGET_MS);
    const totalWrites = after.probe!.charts.reduce(
      (sum: number, c: any) => sum + c.updateCalls + c.setDataCalls,
      0
    );
    // 30 seeks x a handful of buckets x 2 charts. One write per tick would be orders of magnitude
    // higher on any real tape.
    expect(totalWrites).toBeLessThanOrEqual(30 * WRITES_PER_SEEK_BUDGET * 2);
    expect(pageErrors).toEqual([]);
  });

  test('rewinding while playing leaves no candle newer than the playhead', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, SYMBOL, DATE, ENTRY);
    await installProbe(page);
    const before = await readProbe(page);
    const { firstTickMs, lastTickMs, totalTicks } = before.context;

    test.skip(
      totalTicks < 500 || firstTickMs === null || lastTickMs === null,
      `tape too thin to exercise a rewind (totalTicks=${totalTicks})`
    );

    const span = lastTickMs! - firstTickMs!;
    const forwardTarget = firstTickMs! + Math.floor(span * 0.7);
    const backwardTarget = firstTickMs! + Math.floor(span * 0.2);

    await page.evaluate((t) => (window as any).usePlaybackStore.getState().seekTickTime(t), forwardTarget);
    await page.getByRole('button', { name: /PLAY/i }).click();
    await page.waitForFunction(() => (window as any).usePlaybackStore.getState().isPaused === false, {
      timeout: 10000,
    });
    await page.waitForTimeout(1200);

    const forwardTimes = await seriesTimes(page, 0);
    expect(forwardTimes.length).toBeGreaterThan(0);

    await page.evaluate((t) => (window as any).usePlaybackStore.getState().seekTickTime(t), backwardTarget);
    await page.waitForTimeout(800);

    const rewoundTimes = await seriesTimes(page, 0);
    const state = await readProbe(page);
    const playheadMs = state.context.currentTime as number;

    // Infer the chart's bucket size from its own bars (default layout is 5min, but do not assume).
    const sorted = [...rewoundTimes].sort((a, b) => a - b);
    let bucketSec = 300;
    for (let i = 1; i < sorted.length; i++) {
      const diff = sorted[i] - sorted[i - 1];
      if (diff > 0) {
        bucketSec = diff;
        break;
      }
    }
    const playheadBucketStart = Math.floor(playheadMs / 1000 / bucketSec) * bucketSec;
    const maxBarSec = sorted[sorted.length - 1];

    console.log(
      'FREEZE-REPORT ' +
        JSON.stringify(
          {
            test: 'rewind-temporal-isolation',
            bucketSec,
            playheadMs,
            playheadBucketStart,
            maxBarSec,
            futureBars: rewoundTimes.filter((t) => t > playheadBucketStart + bucketSec).length,
            forwardBars: forwardTimes.length,
            rewoundBars: rewoundTimes.length,
            heartbeatMaxGapMs: state.probe?.heartbeatMaxGapMs,
          },
          null,
          2
        )
    );

    expect(maxBarSec).toBeLessThanOrEqual(playheadBucketStart + bucketSec);
    expect(state.probe!.heartbeatMaxGapMs).toBeLessThan(STALL_BUDGET_MS);
    expect(pageErrors).toEqual([]);
  });
});
