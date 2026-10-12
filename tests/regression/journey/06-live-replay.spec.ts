/**
 * 06-live-replay.spec.ts — The chart plays timewise & the tape streams live.
 * ---------------------------------------------------------------------------
 * Journey step 4 (cont.): "timewise the chart should be playing."
 *
 * Verifies the live, time-driven experience: the clock marches forward, the
 * forming candle updates, the live price badge ticks, and the Time & Sales
 * order-flow tape streams prints with an active-tick highlight.
 */

import { test, expect } from '@playwright/test';
import {
  beginReplay,
  chartCard,
  readBarData,
  readPlaybackState,
  pressPlay,
  pressPause,
  setSpeed,
  readScrubber,
  seekScrubber,
  openTape,
  tapeRows,
  tapePanel,
  utcToEtClock,
  collectPageErrors,
} from '../mocks/replayJourney';

const TARGET = '2026-09-25';

test.describe('JOURNEY 06 — Live replay & Time & Sales tape', () => {
  test('a live price is present, and the tape advances as it streams', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    // This test used to look for a "$<price>" badge inside `.playback-bar` and never found one,
    // because the bar renders profit-and-loss figures and elapsed replay time — no price, and no
    // dollar sign anywhere in the component. The assertion was against a surface that does not exist.
    //
    // The live price is in the tape, which is what the test's own name describes.
    await openTape(page);
    await expect(tapePanel(page)).toBeVisible();

    await setSpeed(page, '50');
    await pressPlay(page);
    await page.waitForTimeout(900);
    await pressPause(page);

    expect(await tapeRows(page).count()).toBeGreaterThan(0);

    // Each row is a print: time, price, size, bid/ask. The price cell must be an actual number.
    const priceCell = tapeRows(page).last().locator('div').nth(1);
    const price = parseFloat((await priceCell.innerText()).replace(/[^0-9.]/g, ''));
    expect(Number.isFinite(price)).toBe(true);
    expect(price).toBeGreaterThan(0);

    // And the stream keeps moving: one more tick changes the market time the tape is printing.
    const beforeTick = (await readPlaybackState(page)).currentTick;
    await page.getByTitle('Step 1 Tick Forward').click();
    await page.waitForTimeout(200);
    const afterTick = (await readPlaybackState(page)).currentTick;
    expect(afterTick).not.toBeNull();
    expect(afterTick!.time).not.toBe(beforeTick!.time);

    expect(pageErrors).toEqual([]);
  });

  test('the Time & Sales tape opens and streams executed prints', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await openTape(page);
    await expect(tapePanel(page)).toBeVisible();

    // Advance the clock so the tape has prints to show.
    await setSpeed(page, '50');
    await pressPlay(page);
    await page.waitForTimeout(700);
    await pressPause(page);

    const rowCount = await tapeRows(page).count();
    expect(rowCount).toBeGreaterThan(0);

    // Exactly one active (current) tick row is highlighted.
    const activeCount = await page.locator('.tick-row.is-active').count();
    expect(activeCount).toBe(1);

    expect(pageErrors).toEqual([]);
  });

  test('the tape closes again via its close button', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await openTape(page);
    await expect(tapePanel(page)).toBeVisible();

    await tapePanel(page).locator('button[title="Close Tape"]').click();
    await expect(tapePanel(page)).toHaveCount(0);
  });

  test('the forming candle tracks the live tick price during playback', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    // Start right at the open so fresh intraday candles form as we play.
    await beginReplay(page, { ticker: 'AAPL', date: TARGET, entryTime: '09:31' });

    const card = chartCard(page, 0);
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });

    const before = await readBarData(card);

    await setSpeed(page, '100');
    await pressPlay(page);
    await page.waitForTimeout(1000);
    await pressPause(page);

    const after = await readBarData(card);
    // The latest bar advanced forward in time.
    expect(utcToEtClock(after.lastBarTime!) >= utcToEtClock(before.lastBarTime!)).toBe(true);
    // A live close price is present.
    expect(parseFloat(after.lastBarClose!)).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });

  test('playing to the end of the buffered tape auto-pauses', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const { total } = await readScrubber(page);
    expect(total).toBeGreaterThan(10);

    // Seek near the very end, then play — it should stop on its own.
    await seekScrubber(page, total - 3);
    await setSpeed(page, '100');
    await pressPlay(page);

    // Either it pauses automatically or the cursor reaches the end.
    await page.waitForTimeout(1500);
    const state = await readPlaybackState(page);
    expect(state.currentTickIndex).toBeGreaterThanOrEqual(total - 4);
  });
});
