/**
 * 14-reset-date-bound.spec.ts — Red Reset button must respect chosen date
 * ---------------------------------------------------------------------------
 * Regression for: "When I click on the reset button and I pick any date,
 * it ignores whatever date I have then it just loads all the chart till the end."
 *
 * After clicking the red Reset Session button (Sidebar), the Configure Session
 * overlay appears. Picking a new earlier date (e.g., 2026-09-22) and clicking
 * Initialize must:
 *  - Anchor replay at 09:10 ET of the NEW date (not old)
 *  - Load intraday history ending at NEW date (not latest date)
 *  - Daily chart must show only bars < NEW date (no future leak)
 *  - Tick buffer must be bounded to NEW date (not old)
 */

import { test, expect } from '@playwright/test';
import {
  beginReplay,
  chartCard,
  readBarData,
  readPlaybackState,
  utcToEtDate,
  utcToEtClock,
  collectPageErrors,
  openWebsite,
  waitForBackendConnected,
  enterReplayDate,
  startReplay,
} from '../mocks/replayJourney';

const INITIAL_DATE = '2026-09-25';
const NEW_DATE = '2026-09-22';

test.describe('JOURNEY 14 — Red Reset respects chosen date (no future leak)', () => {
  test('reset then picking earlier date anchors at 09:10 ET of NEW date', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: INITIAL_DATE });

    // Verify initial anchor
    await expect(page.locator('.time-display')).toContainText('09:10:00');

    // Click red Reset Session button
    await page.locator('.sidebar button[title="Reset Session"]').click();
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 15_000 });

    // Pick NEW earlier date and re-initialize
    await page.locator('.session-card input[type="date"]').fill(NEW_DATE);
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

    // Two charts should still render
    await expect(page.locator('.chart-card')).toHaveCount(2, { timeout: 30_000 });
    // Tick buffer loading finished
    await expect(page.locator('.playback-bar')).toHaveAttribute('data-ticks-loading', 'false', { timeout: 40_000 });
    // Replay clock must be at 09:10 of NEW date, NOT old date's time
    await expect(page.locator('.time-display')).toContainText('09:10:00', { timeout: 40_000 });

    const state = await readPlaybackState(page);
    expect(state.currentTime).not.toBeNull();
    if (state.currentTime) {
      const etDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(state.currentTime));
      expect(etDate).toBe(NEW_DATE);
    }

    expect(pageErrors).toEqual([]);
  });

  test('intraday chart after reset shows 09:10 bucket of NEW date, not afternoon/EOD of old date', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: INITIAL_DATE });

    await page.locator('.sidebar button[title="Reset Session"]').click();
    await expect(page.getByText('Configure Session')).toBeVisible();
    await page.locator('.session-card input[type="date"]').fill(NEW_DATE);
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

    const card = chartCard(page, 0); // 5min
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 25_000 });
    const bar = await readBarData(card);
    expect(bar.lastBarTime).toBeTruthy();
    const etClock = utcToEtClock(bar.lastBarTime!);
    // Must be 09:10 or shortly after, not midday / close (which would indicate future leak to EOD)
    expect(etClock).toMatch(/^09:(1\d|20)$/);
    // And last bar's ET date must be NEW date's day (intraday bars are timestamped to NEW date)
    const lastEtDate = utcToEtDate(bar.lastBarTime!);
    // For intraday at 09:10 anchor, last bar is on NEW date (or prior day's close), but definitely not after NEW date
    expect(lastEtDate <= NEW_DATE).toBe(true);

    expect(pageErrors).toEqual([]);
  });

  test('daily chart after reset shows only bars < NEW date (no leak of 2026-09-25)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: INITIAL_DATE });

    // Daily chart initially shows bars < 2026-09-25
    const dailyBefore = chartCard(page, 1);
    await expect(dailyBefore).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 25_000 });
    let bar = await readBarData(dailyBefore);
    expect(utcToEtDate(bar.lastBarTime!) < INITIAL_DATE).toBe(true);

    // Reset and pick earlier date
    await page.locator('.sidebar button[title="Reset Session"]').click();
    await expect(page.getByText('Configure Session')).toBeVisible();
    await page.locator('.session-card input[type="date"]').fill(NEW_DATE);
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

    const dailyAfter = chartCard(page, 1);
    await expect(dailyAfter).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 25_000 });
    bar = await readBarData(dailyAfter);
    // After reset to 2026-09-22, daily last bar must be < 2026-09-22, not 2026-09-24/25
    expect(bar.lastBarTime).toBeTruthy();
    expect(utcToEtDate(bar.lastBarTime!) < NEW_DATE).toBe(true);
    // Specifically, it must NOT be INITIAL_DATE's prior day (which would be 2026-09-24)
    expect(utcToEtDate(bar.lastBarTime!)).not.toBe('2026-09-24');

    expect(pageErrors).toEqual([]);
  });

  test('tick buffer after reset is bounded to NEW date (not old date)', async ({ page }) => {
    await beginReplay(page, { ticker: 'AAPL', date: INITIAL_DATE });
    await page.locator('.sidebar button[title="Reset Session"]').click();
    await expect(page.getByText('Configure Session')).toBeVisible();
    await page.locator('.session-card input[type="date"]').fill(NEW_DATE);
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

    await expect(page.locator('.playback-bar')).toHaveAttribute('data-ticks-loading', 'false', { timeout: 40_000 });
    const state = await readPlaybackState(page);
    expect(state.totalTicks).toBeGreaterThan(0);
    // At 09:10 anchor, cursor near start, not at end
    expect(state.currentTickIndex).toBeLessThanOrEqual(2);
    // Total ticks for one day's replay buffer is ~ 390*60 = 23400 for 1-sec ticks from 09:10-16:00,
    // plus prior handling. If buffer leaked to end (future), total would be massive and index would be mid.
    // Ensure we didn't load ticks beyond NEW date's 23:59
    if (state.currentTick) {
      const tickEtDate = utcToEtDate(state.currentTick.time);
      expect(tickEtDate).toBe(NEW_DATE);
    }
  });

  test('rapid reset → pick date → init still respects NEW date (race guard)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: INITIAL_DATE });

    // Rapid sequence: click reset, then without extra waits, fill date and init
    await page.locator('.sidebar button[title="Reset Session"]').click();
    await expect(page.getByText('Configure Session')).toBeVisible();
    const dateInput = page.locator('.session-card input[type="date"]');
    await dateInput.fill(NEW_DATE);
    // Don't wait - immediately click init to trigger stale-closure race
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

    await expect(page.locator('.playback-bar')).toHaveAttribute('data-ticks-loading', 'false', { timeout: 40_000 });
    const state = await readPlaybackState(page);
    if (state.currentTime) {
      const etDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(state.currentTime));
      expect(etDate).toBe(NEW_DATE);
    }

    expect(pageErrors).toEqual([]);
  });
});
