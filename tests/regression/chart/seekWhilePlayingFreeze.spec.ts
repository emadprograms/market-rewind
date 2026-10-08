import { test, expect, type Page } from '@playwright/test';
import { startSession, chartCard, collectPageErrors, SEED_DATE } from '../e2e-utils';
import {
  heapUsedBytes,
  installFreezeProbe,
  isPlaying,
  measureStoreSeekBy,
  measureStoreSeekTo,
  readFreezeProbe,
  seekToMs,
  seriesBarTimes,
} from './freezeProbeInPage';

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
/** Playback speed to run the seek loops at (0.5|1|2|5|10|25|50|100). Default: leave the UI alone. */
const SPEED = process.env.SEEK_SPEED ? Number(process.env.SEEK_SPEED) : null;
/** Set SEEK_SOAK_MS=600000 to add the long-run leak/degradation test (skipped otherwise). */
const SOAK_MS = process.env.SEEK_SOAK_MS ? Number(process.env.SEEK_SOAK_MS) : 0;
/**
 * Loose ceiling for a single synchronous store-side seek. This is a diagnostic bound, not the
 * fix's acceptance gate: seekTickTime still rebuilds latestTickBySymbol in O(buffered ticks),
 * which is a known follow-up. The point of measuring it is to size that follow-up with a real
 * number instead of a guess.
 */
const STORE_SEEK_BUDGET_MS = 5000;

/** Max frame gap tolerated while seeking. A blocked main thread blows straight through this. */
const STALL_BUDGET_MS = 1500;
/** Default layout is 5min + 1D. Acceptance (user, this round): writes <= 12 per chart per step. */
// A seek while playing is rebuilt in bulk (SEEK-BULK-01): one setData per series, not one update
// per 5-minute bucket crossed. So the budget is flat, and it does not grow with the distance
// sought. A per-tick or per-bucket regression writes ~3,600 times for a 60-minute seek and fails
// this by a mile. Guarded in-sandbox by tests/unit/seekBulkRebuild.test.tsx.
const WRITES_PER_SEEK_BUDGET = 12;
const writesBudgetFor = (_m: { targetMs?: number; currentTimeBefore?: number | null }) =>
  WRITES_PER_SEEK_BUDGET;

/**
 * Thin Playwright wrappers. The code that actually runs in the page lives in ./freezeProbeInPage
 * and is self-contained by requirement -- see that file's header for the serialization rule that
 * a closed-over variable breaks.
 */
async function installProbe(page: Page) {
  await page.evaluate(installFreezeProbe);
}

/** Reads (and optionally resets) the probe, plus the tape/playhead context for the report. */
async function readProbe(page: Page, reset = false) {
  return page.evaluate(readFreezeProbe, reset);
}

/** Series bar times (UNIX seconds) for chart `index`, as lightweight-charts holds them. */
async function seriesTimes(page: Page, index = 0): Promise<number[]> {
  return page.evaluate(seriesBarTimes, index);
}

/** Drives the real SPEED <select> (same handler the user drives) and confirms the store took it. */
async function applySpeed(page: import('@playwright/test').Page) {
  if (!SPEED) return;
  const select = page.locator('select:has(option[value="100"])').first();
  await select.selectOption(String(SPEED));
  await page.waitForFunction(
    (s) => (window as any).usePlaybackStore?.getState()?.playbackSpeed === s,
    SPEED,
    { timeout: 5000 }
  );
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
      await page.evaluate(seekToMs, parkAt);
      await page.waitForTimeout(300);
    }

    await applySpeed(page);
    await page.getByRole('button', { name: /PLAY/i }).click();
    await page.waitForFunction(isPlaying, null, {
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
      // Read straight away: these are the writes the seek itself caused. Reading only after the
      // settle wait charges normal playback writes to the seek, which at 25x/100x is 10-20 extra.
      const immediate = await readProbe(page);
      await page.waitForTimeout(400);
      const after = await readProbe(page);
      perSeek.push({
        direction: 'forward',
        dispatchLatencyMs,
        heartbeatMaxGapMs: after.probe?.heartbeatMaxGapMs,
        longTaskMaxMs: after.probe?.longTasks.maxMs,
        writes: immediate.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
        writesAfterSettle: after.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
        isPaused: after.context.isPaused,
        currentTimeMs: after.context.currentTime,
      });
    }

    for (let i = 0; i < 3; i++) {
      await readProbe(page, true);
      const t0 = Date.now();
      await stepBackward.click();
      await page.evaluate(() => undefined);
      const dispatchLatencyMs = Date.now() - t0;
      const immediate = await readProbe(page);
      await page.waitForTimeout(400);
      const after = await readProbe(page);
      perSeek.push({
        direction: 'backward',
        dispatchLatencyMs,
        heartbeatMaxGapMs: after.probe?.heartbeatMaxGapMs,
        longTaskMaxMs: after.probe?.longTasks.maxMs,
        writes: immediate.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
        writesAfterSettle: after.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
        isPaused: after.context.isPaused,
        currentTimeMs: after.context.currentTime,
      });
    }

    const final = await readProbe(page);
    console.log(
      'FREEZE-REPORT ' +
        JSON.stringify(
          {
            test: 'step-while-playing',
            tape: { totalTicks, spanMinutes: Math.round(spanMs / 60000), masterDataBars: before.context.masterDataBars },
            playbackSpeed: final.context.playbackSpeed,
            perSeek,
            totals: final.probe,
          },
        )
    );

    // The tab must never stall: no frame gap and no dispatch latency anywhere near a freeze.
    for (const s of perSeek) {
      expect(s.heartbeatMaxGapMs, `frame stalled during a ${s.direction} seek`).toBeLessThan(STALL_BUDGET_MS);
      expect(s.dispatchLatencyMs, `main thread blocked during a ${s.direction} seek`).toBeLessThan(STALL_BUDGET_MS);
      // A seek must not pause playback (261007-nsp). Reaching the end of the session data does
      // auto-pause by design, so only assert while the playhead is still >2 min from the last tick
      // -- otherwise a high-speed run (SEEK_SPEED=100) exhausts the tape and fails for no reason.
      const tapeLeftMs =
        lastTickMs !== null && typeof s.currentTimeMs === 'number' ? lastTickMs - s.currentTimeMs : null;
      if (s.direction === 'forward' && canAssertStillPlaying && (tapeLeftMs === null || tapeLeftMs > 120000)) {
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
    // 30 seeks can legitimately take ~1s each while the residual store-side cost stands, which
    // blows the default 60s timeout and hides the measurement behind a timeout error.
    test.setTimeout(300_000);
    const pageErrors = collectPageErrors(page);

    await startSession(page, SYMBOL, DATE, ENTRY);
    await installProbe(page);
    const before = await readProbe(page);
    const { firstTickMs, lastTickMs, totalTicks } = before.context;

    test.skip(
      totalTicks < 500 || firstTickMs === null || lastTickMs === null,
      `tape too thin to exercise the seek catch-up (totalTicks=${totalTicks}); re-run with SEEK_SYMBOL/SEEK_DATE pointing at a dense session`
    );

    await page.evaluate(seekToMs, firstTickMs!);
    await applySpeed(page);
    await page.getByRole('button', { name: /PLAY/i }).click();
    await page.waitForFunction(isPlaying, null, {
      timeout: 10000,
    });
    await page.waitForTimeout(500);

    await readProbe(page, true);

    // 30 scrubber-sized seeks across the tape: exactly what dragging the slider dispatches.
    const span = lastTickMs! - firstTickMs!;
    const started = Date.now();
    for (let i = 1; i <= 30; i++) {
      const target = firstTickMs! + Math.floor((span * i) / 31);
      await page.evaluate(seekToMs, target);
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
            playbackSpeed: after.context.playbackSpeed,
            seeks: 30,
            wallMs,
            probe: after.probe,
          },
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

    await page.evaluate(seekToMs, forwardTarget);
    await page.getByRole('button', { name: /PLAY/i }).click();
    await page.waitForFunction(isPlaying, null, {
      timeout: 10000,
    });
    await page.waitForTimeout(1200);

    const forwardTimes = await seriesTimes(page, 0);
    expect(forwardTimes.length).toBeGreaterThan(0);

    await page.evaluate(seekToMs, backwardTarget);
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
        )
    );

    expect(maxBarSec).toBeLessThanOrEqual(playheadBucketStart + bucketSec);
    expect(state.probe!.heartbeatMaxGapMs).toBeLessThan(STALL_BUDGET_MS);
    expect(pageErrors).toEqual([]);
  });

  /**
   * DIAGNOSTIC, not a fix gate. Times the synchronous store-side cost of four seek shapes while
   * playing, so the remaining O(buffered ticks) latestTickBySymbol rebuild gets a real number.
   * Expected to pass on `main` too -- the interesting output is the storeSeekMs column and how
   * flat it is across distances (flat == cost is the fixed rebuild, not the distance).
   */
  test('store-side seek cost is bounded (diagnostic for the O(n) latestTickBySymbol rebuild)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, SYMBOL, DATE, ENTRY);
    await installProbe(page);
    const before = await readProbe(page);
    const { firstTickMs, lastTickMs, totalTicks } = before.context;

    test.skip(
      totalTicks < 500 || firstTickMs === null || lastTickMs === null,
      `tape too thin for a meaningful cost measurement (totalTicks=${totalTicks})`
    );

    const span = lastTickMs! - firstTickMs!;
    await applySpeed(page);
    // Park at 70% so a 60-minute rewind stays inside the tape.
    await page.evaluate(seekToMs, firstTickMs! + Math.floor(span * 0.7));
    await page.getByRole('button', { name: /PLAY/i }).click();
    await page.waitForFunction(isPlaying, null, { timeout: 10000 });
    await page.waitForTimeout(800);

    const shapes = [
      { name: 'backward60m', offsetMs: -60 * 60000 },
      { name: 'forward3m', offsetMs: 3 * 60000 },
      { name: 'forward60m', offsetMs: 60 * 60000 },
    ];
    const measurements: any[] = [];
    for (const shape of shapes) {
      await readProbe(page, true);
      const t0 = Date.now();
      const m = await page.evaluate(measureStoreSeekBy, shape.offsetMs);
      await page.evaluate(() => undefined);
      const dispatchLatencyMs = Date.now() - t0;
      const immediate = await readProbe(page);
      await page.waitForTimeout(600);
      const after = await readProbe(page);
      measurements.push({
        ...shape,
        ...m,
        dispatchLatencyMs,
        heartbeatMaxGapMs: after.probe?.heartbeatMaxGapMs,
        longTaskMaxMs: after.probe?.longTasks.maxMs,
        writes: immediate.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
        writesAfterSettle: after.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
        isPaused: after.context.isPaused,
      });
    }

    // Full-tape jump last: reaching the end of the session auto-pauses by design (261007-nsp).
    await readProbe(page, true);
    // -1ms: seeking onto exactly the last buffered tick reports reachedEnd and auto-pauses.
    const full = await page.evaluate(measureStoreSeekTo, lastTickMs! - 1);
    await page.waitForTimeout(600);
    const afterFull = await readProbe(page);
    measurements.push({
      name: 'fullTapeJump',
      storeSeekMs: full.storeSeekMs,
      targetMs: full.targetMs,
      currentTimeBefore: full.currentTimeBefore,
      dispatchLatencyMs: null,
      heartbeatMaxGapMs: afterFull.probe?.heartbeatMaxGapMs,
      longTaskMaxMs: afterFull.probe?.longTasks.maxMs,
      writes: afterFull.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
      isPaused: afterFull.context.isPaused,
    });

    const storeSeekValues = measurements.map((m) => m.storeSeekMs);
    console.log(
      'FREEZE-REPORT ' +
        JSON.stringify(
          {
            test: 'store-seek-cost-diagnostic',
            tape: { totalTicks, spanMinutes: Math.round(span / 60000) },
            playbackSpeed: afterFull.context.playbackSpeed,
            measurements,
            storeSeekMs: {
              min: Math.min(...storeSeekValues),
              max: Math.max(...storeSeekValues),
              // Flat across distances => the cost is the fixed O(n) rebuild, not the seek size.
              spreadRatio: Math.round((Math.max(...storeSeekValues) / Math.max(0.01, Math.min(...storeSeekValues))) * 10) / 10,
            },
          },
        )
    );

    for (const m of measurements) {
      expect(m.storeSeekMs, `store-side seek ${m.name} took too long`).toBeLessThan(STORE_SEEK_BUDGET_MS);
      expect(m.heartbeatMaxGapMs, `frame stalled during ${m.name}`).toBeLessThan(STALL_BUDGET_MS);
      for (const w of m.writes || []) {
        expect(w, `chart primitives written during ${m.name} (budget ${writesBudgetFor(m)})`).toBeLessThanOrEqual(writesBudgetFor(m));
      }
    }
    expect(pageErrors).toEqual([]);
  });

  /**
   * OPT-IN long run: seeks continuously at speed while playing and watches for degradation.
   * Enabled with SEEK_SOAK_MS (e.g. 600000 = 10 minutes). Heap numbers are reported, not
   * asserted -- GC timing makes them flaky; the gate is that the main thread never stalls.
   */
  test('soak: repeated seeking at speed does not degrade over time', async ({ page }) => {
    test.skip(!SOAK_MS, 'opt-in: set SEEK_SOAK_MS=600000 to run the soak');
    test.setTimeout(SOAK_MS + 180000);

    const pageErrors = collectPageErrors(page);
    await startSession(page, SYMBOL, DATE, ENTRY);
    await installProbe(page);
    const before = await readProbe(page);
    const { firstTickMs, lastTickMs, totalTicks } = before.context;
    test.skip(totalTicks < 500 || firstTickMs === null || lastTickMs === null, 'tape too thin to soak');

    await applySpeed(page);
    await page.getByRole('button', { name: /PLAY/i }).click();
    await page.waitForFunction(isPlaying, null, { timeout: 10000 });

    const heap = async () => ({ usedJSHeapSize: await page.evaluate(heapUsedBytes) });

    const startHeap = await heap();
    const span = lastTickMs! - firstTickMs!;
    const deadline = Date.now() + SOAK_MS;
    const samples: any[] = [];
    let i = 0;
    let maxHeap = startHeap.usedJSHeapSize ?? 0;

    while (Date.now() < deadline) {
      i += 1;
      // Alternate direction, as a user scrubbing around the session would.
      const frac = i % 2 === 0 ? 0.25 + ((i / 4) % 0.5) : 0.75 - ((i / 4) % 0.5);
      const target = firstTickMs! + Math.floor(span * Math.min(0.95, Math.max(0.05, frac)));
      await readProbe(page, true);
      await page.evaluate(seekToMs, target);
      await page.waitForTimeout(2000);
      const after = await readProbe(page);
      const h = await heap();
      if (h.usedJSHeapSize && h.usedJSHeapSize > maxHeap) maxHeap = h.usedJSHeapSize;
      samples.push({
        seek: i,
        heartbeatMaxGapMs: after.probe?.heartbeatMaxGapMs,
        longTaskMaxMs: after.probe?.longTasks.maxMs,
        writes: after.probe?.charts.map((c: any) => c.updateCalls + c.setDataCalls),
        usedJSHeapMB: h.usedJSHeapSize ? Math.round(h.usedJSHeapSize / 1048576) : null,
        isPaused: after.context.isPaused,
      });
      // Playback must survive the whole soak; if it stopped, that is the finding.
      if (after.context.isPaused !== false) break;
    }

    const endHeap = await heap();
    const worstGap = samples.reduce((m, s) => Math.max(m, s.heartbeatMaxGapMs || 0), 0);
    console.log(
      'FREEZE-REPORT ' +
        JSON.stringify(
          {
            test: 'soak',
            soakMs: SOAK_MS,
            seeks: samples.length,
            playbackSpeed: before.context.playbackSpeed,
            tape: { totalTicks, spanMinutes: Math.round(span / 60000) },
            heapMB: {
              start: startHeap.usedJSHeapSize ? Math.round(startHeap.usedJSHeapSize / 1048576) : null,
              end: endHeap.usedJSHeapSize ? Math.round(endHeap.usedJSHeapSize / 1048576) : null,
              max: maxHeap ? Math.round(maxHeap / 1048576) : null,
            },
            worstHeartbeatGapMs: worstGap,
            firstSamples: samples.slice(0, 5),
            lastSamples: samples.slice(-5),
          },
        )
    );

    expect(samples.length).toBeGreaterThan(0);
    expect(worstGap, 'main thread stalled during the soak').toBeLessThan(STALL_BUDGET_MS);
    for (const smp of samples) {
      for (const w of smp.writes || []) {
        expect(w, 'per-tick writes reappeared during the soak').toBeLessThanOrEqual(WRITES_PER_SEEK_BUDGET);
      }
    }
    expect(pageErrors).toEqual([]);
  });
});
