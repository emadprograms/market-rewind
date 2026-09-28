/**
 * 04-temporal-isolation.spec.ts — The replay stops at 09:20 and never leaks the future.
 * ---------------------------------------------------------------------------
 * Journey step 3b: "...and stop at 9:20am that day."
 *
 * The defining guarantee of Market Rewind is temporal isolation: at the entry
 * anchor the intraday chart shows history + the forming 09:20 bucket ONLY, and
 * the daily chart shows completed prior days ONLY. No afternoon/evening/close
 * candle from the target day may appear before the replay clock reaches it.
 */

import { test, expect } from '@playwright/test';
import {
  beginReplay,
  chartCard,
  readBarData,
  readPlaybackState,
  readReplayClock,
  utcToEtClock,
  utcToEtDate,
  collectPageErrors,
} from '../mocks/replayJourney';

const TARGET = '2026-09-25';

test.describe('JOURNEY 04 — Temporal isolation (stops at 09:20, no look-ahead)', () => {
  test('the replay clock is anchored exactly at 09:20:00 ET', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await expect(page.locator('.time-display')).toContainText('09:20:00');

    const clock = await readReplayClock(page);
    expect(clock.startsWith('09:20:00')).toBe(true);

    const state = await readPlaybackState(page);
    expect(state.isPaused).toBe(true); // paused at the anchor until the user plays

    expect(pageErrors).toEqual([]);
  });

  test("the 5-minute chart's latest bar is the 09:20 bucket — never the afternoon", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const card = chartCard(page, 0);
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });

    const bar = await readBarData(card);
    expect(bar.lastBarTime).toBeTruthy();

    const etClock = utcToEtClock(bar.lastBarTime!);
    // Must be at/around the 09:20 anchor, and emphatically NOT midday/close.
    expect(etClock).toMatch(/^09:(1\d|20)$/);
    expect(etClock).not.toMatch(/^(1[0-9]|2[0-3]):/);

    expect(pageErrors).toEqual([]);
  });

  test("the daily chart shows only completed prior days (no today's close leaks)", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const card = chartCard(page, 1);
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });

    const bar = await readBarData(card);
    // The most recent daily candle is a PRIOR day, not the target day.
    expect(utcToEtDate(bar.lastBarTime!) < TARGET).toBe(true);

    expect(pageErrors).toEqual([]);
  });

  test('the tick scrubber is anchored near the start of the buffered tape', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const state = await readPlaybackState(page);
    expect(state.totalTicks).toBeGreaterThan(0);
    // At the 09:20 anchor the cursor sits at (or extremely near) the first tick.
    expect(state.currentTickIndex).toBeLessThanOrEqual(2);
  });

  test('single-stepping forward reveals forward data gradually, never jumping to EOD', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const before = await readPlaybackState(page);

    // Step forward a handful of ticks.
    const stepFwd = page.getByTitle('Step 1 Tick Forward');
    for (let i = 0; i < 5; i++) {
      await stepFwd.click();
    }
    await page.waitForTimeout(300);

    const after = await readPlaybackState(page);
    expect(after.currentTickIndex).toBeGreaterThan(before.currentTickIndex);
    // A few steps must NOT teleport to the end of the tape.
    expect(after.currentTickIndex).toBeLessThan(after.totalTicks - 1);

    // The clock moved forward but stayed within the opening minutes.
    const clock = await readReplayClock(page);
    expect(clock.startsWith('09:2')).toBe(true);

    expect(pageErrors).toEqual([]);
  });

  test('no target-day candle with an afternoon timestamp exists at the anchor', async ({ page }) => {
    await beginReplay(page, { ticker: 'AAPL', date: TARGET });

    // Inspect the rendered last-bar time attribute for any future (post-open) leak.
    const last = await chartCard(page, 0).getAttribute('data-last-bar-time');
    if (last) {
      const etClock = utcToEtClock(last);
      expect(etClock).not.toMatch(/^(1[0-9]|2[0-3]):/);
    }
  });
});
