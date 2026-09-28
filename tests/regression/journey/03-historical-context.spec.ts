/**
 * 03-historical-context.spec.ts — The chart opens with all previous days.
 * ---------------------------------------------------------------------------
 * Journey step 3a: "The graph is supposed to open the chart for all the
 * previous days before it."
 *
 * When a date is chosen, the intraday and daily charts must show the completed
 * history of the trading days that came *before* the target day (context),
 * while the replay cursor is anchored on the target day.
 */

import { test, expect } from '@playwright/test';
import {
  beginReplay,
  chartCard,
  readBarData,
  utcToEtDate,
  utcToEtClock,
  collectPageErrors,
} from '../mocks/replayJourney';

const TARGET = '2026-09-25';

test.describe('JOURNEY 03 — Historical context (previous days before the target)', () => {
  test('the 5-minute chart is pre-populated with prior trading days', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const card = chartCard(page, 0); // 5min ETH chart
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });

    const bar = await readBarData(card);
    expect(bar.barsCount).toBeGreaterThan(50); // many intraday bars of history
    expect(bar.firstBarTime).toBeTruthy();

    // The earliest bar belongs to a day strictly BEFORE the target day.
    const firstEtDate = utcToEtDate(bar.firstBarTime!);
    expect(firstEtDate < TARGET).toBe(true);
    // And it opens at/after the regular session (09:30 ET), not pre-dawn.
    expect(utcToEtClock(bar.firstBarTime!)).toMatch(/^(09:3\d|1[0-6]):/);

    expect(pageErrors).toEqual([]);
  });

  test('the daily chart lists the completed prior trading days', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const card = chartCard(page, 1); // 1D chart
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });

    const bar = await readBarData(card);
    // Several completed daily candles of history.
    expect(bar.barsCount).toBeGreaterThanOrEqual(5);

    // Every daily bar shown at the 09:20 anchor is a PRIOR day (no today leak).
    if (bar.lastBarTime) {
      expect(utcToEtDate(bar.lastBarTime) < TARGET).toBe(true);
    }

    expect(pageErrors).toEqual([]);
  });

  test('history is continuous: prior-day close is in a realistic price band', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const bar = await readBarData(chartCard(page, 1));
    if (bar.lastBarClose) {
      const close = parseFloat(bar.lastBarClose);
      // SPY is mocked around $768; prior-day close must stay in a sane band.
      expect(close).toBeGreaterThan(700);
      expect(close).toBeLessThan(850);
    }
  });

  test('selecting a different date reloads that date\'s history', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'AAPL', date: '2026-09-24' });

    const card = chartCard(page, 0);
    const before = await readBarData(card);
    expect(before.barsCount).toBeGreaterThan(0);

    // End the session, pick a new date, and restart.
    await page.locator('.sidebar button[title="Reset Session"]').click();
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 15_000 });
    await page.locator('.session-card input[type="date"]').fill('2026-09-22');
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 25_000 });
    const after = await readBarData(card);
    // The earliest bar's day must be before the newly selected date.
    expect(utcToEtDate(after.firstBarTime!) < '2026-09-22').toBe(true);

    expect(pageErrors).toEqual([]);
  });

  test('switching a chart\'s ticker via the header loads that symbol\'s history', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const card = chartCard(page, 1);
    // Open the ticker dropdown and pick MSFT.
    await card.locator('.chart-controls .custom-select').first().click();
    const search = card.locator('.dropdown-search input');
    if (await search.isVisible()) await search.fill('MSFT');
    await card.locator('.dropdown-items .dropdown-item').filter({ hasText: /^MSFT$/ }).first().click();

    await expect(card).toHaveAttribute('data-ticker', 'MSFT', { timeout: 20_000 });
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });

    expect(pageErrors).toEqual([]);
  });
});
