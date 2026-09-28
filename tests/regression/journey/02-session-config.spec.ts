/**
 * 02-session-config.spec.ts — Entering the date you want to replay.
 * ---------------------------------------------------------------------------
 * Journey step 2: "Enter the date you want to replay."
 *
 * Exercises the "Configure Session" card: ticker selection, target date entry,
 * the 09:20 ET entry anchor, and starting the simulator.
 */

import { test, expect } from '@playwright/test';
import {
  openWebsite,
  waitForBackendConnected,
  enterReplayDate,
  startReplay,
  chartCard,
  collectPageErrors,
} from '../mocks/replayJourney';

test.describe('JOURNEY 02 — Configure the replay session (date entry)', () => {
  test('selecting a ticker, entering a date, and initializing starts the replay workspace', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await openWebsite(page);
    await waitForBackendConnected(page);

    // Choose a ticker + target date.
    await enterReplayDate(page, { ticker: 'AAPL', date: '2026-09-25' });
    await startReplay(page, { ticker: 'AAPL', anchorEt: '09:20:00' });

    // The overlay is gone and two charts render for the chosen ticker.
    await expect(page.getByText('Configure Session')).toHaveCount(0);
    await expect(chartCard(page, 0)).toHaveAttribute('data-ticker', 'AAPL');
    await expect(chartCard(page, 1)).toHaveAttribute('data-ticker', 'AAPL');

    expect(pageErrors).toEqual([]);
  });

  test('the replay clock anchors at the 09:20 ET entry point of the chosen day', async ({ page }) => {
    await openWebsite(page);
    await waitForBackendConnected(page);
    await enterReplayDate(page, { ticker: 'SPY', date: '2026-09-25' });
    await startReplay(page, { ticker: 'SPY', anchorEt: '09:20:00' });

    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toContainText('09:20:00');
    await expect(timeDisplay).toContainText('ET');
  });

  test('a custom entry time (e.g. 10:15 ET) anchors the clock to that time', async ({ page }) => {
    await openWebsite(page);
    await waitForBackendConnected(page);
    await enterReplayDate(page, { ticker: 'SPY', date: '2026-09-25', entryTime: '10:15' });
    await startReplay(page, { ticker: 'SPY', anchorEt: '10:15:00' });

    await expect(page.locator('.time-display')).toContainText('10:15:00');
  });

  test('the Initialize button is present and enabled once the backend is connected', async ({ page }) => {
    await openWebsite(page);
    await waitForBackendConnected(page);

    const initBtn = page.getByRole('button', { name: /Initialize Market Simulator/i });
    await expect(initBtn).toBeVisible();
    await expect(initBtn).toBeEnabled();
  });

  test('changing the date before starting re-seeds the session for that day', async ({ page }) => {
    await openWebsite(page);
    await waitForBackendConnected(page);

    await enterReplayDate(page, { ticker: 'SPY', date: '2026-09-24' });
    // The date input reflects the chosen day.
    await expect(page.locator('.session-card input[type="date"]')).toHaveValue('2026-09-24');

    await startReplay(page, { ticker: 'SPY', anchorEt: '09:20:00' });
    await expect(chartCard(page, 0)).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });
  });

  test('ending the session returns to the configurator overlay', async ({ page }) => {
    await openWebsite(page);
    await waitForBackendConnected(page);
    await enterReplayDate(page, { ticker: 'SPY', date: '2026-09-25' });
    await startReplay(page, { ticker: 'SPY', anchorEt: '09:20:00' });

    // The sidebar "Reset Session" button ends the session.
    await page.locator('.sidebar button[title="Reset Session"]').click();
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 15_000 });
  });
});
