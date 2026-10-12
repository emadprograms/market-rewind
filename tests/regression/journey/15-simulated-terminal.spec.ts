/**
 * 15-simulated-terminal.spec.ts — the simulated trading desk in a real browser.
 * ---------------------------------------------------------------------------
 * Journey step 6: "The user opens the terminal, places an order, and is told the truth about what
 * happened to it."
 *
 * ⚠️ NOT EXECUTED IN THIS ENVIRONMENT. This spec was written for phase 48 and is discovered by
 * `npx playwright test -c playwright.journey.config.ts --list`, but the sandbox it was authored in
 * could not install a browser binary (`npx playwright install chromium` fails to reach the download
 * CDN), so no browser run is recorded anywhere in this milestone's verification. It must be treated
 * as unverified until it has actually run in CI. See 48-VERIFICATION.md.
 *
 * It uses the same offline mocks as the other journey specs, so it needs no DuckDB backend.
 */

import { test, expect } from '@playwright/test';
import { beginReplay, collectPageErrors } from '../mocks/replayJourney';

const TARGET = '2026-09-25';
const DESK = '[data-testid="trade-desk"]';
const ROWS = '[data-testid="activity-rows"]';

async function openDesk(page: import('@playwright/test').Page): Promise<void> {
  await beginReplay(page, { ticker: 'SPY', date: TARGET });
  await page.getByTestId('open-trade-desk').click();
  await expect(page.locator(DESK)).toBeVisible();
}

test.describe('JOURNEY 15 — the simulated trading terminal', () => {
  test('opens as a simulated account with live bid/ask and an unsubmitted ticket', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await openDesk(page);

    // The label that keeps this honest.
    await expect(page.locator(DESK)).toContainText('Simulated account');
    await expect(page.locator(DESK)).toContainText('no broker is contacted');

    // A live two-sided market, and no position merely because the desk was opened.
    await expect(page.getByTestId('ticket-bid')).not.toHaveText('—');
    await expect(page.getByTestId('ticket-ask')).not.toHaveText('—');
    await expect(page.locator(ROWS)).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('submitting shows a sending instruction, and a position only after the fill confirms', async ({ page }) => {
    await openDesk(page);

    await page.getByLabel(/Quantity/).fill('1');
    await page.getByRole('button', { name: /Submit BUY MARKET/ }).click();

    // The instruction is visible immediately; the desk claims nothing more than that.
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.locator(ROWS)).toContainText('BUY MARKET');

    // Once the simulated broker has filled it, the row says so and a position appears.
    await expect(page.locator(ROWS)).toContainText('Filled', { timeout: 30_000 });
    await expect(page.locator(ROWS)).toContainText('Open');
  });

  test('a pending order states the exact price side and condition it waits on', async ({ page }) => {
    await openDesk(page);

    await page.getByRole('radio', { name: 'Limit' }).click();
    const level = await page.getByLabel(/Limit level/).inputValue();
    // A limit well below the market will not fill, so the row must keep explaining itself.
    await page.getByLabel(/Limit level/).fill(String(Math.max(1, Number(level || 100) - 10)));
    await page.getByLabel(/Quantity/).fill('1');
    await page.getByRole('button', { name: /Submit BUY LIMIT/ }).click();

    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.locator(ROWS)).toContainText(/Waiting for ask <=/);
  });

  test('the timeline separates price waiting, execution and notification', async ({ page }) => {
    await openDesk(page);

    await page.getByLabel(/Quantity/).fill('1');
    await page.getByRole('button', { name: /Submit BUY MARKET/ }).click();
    await page.getByRole('tab', { name: 'Timeline' }).click();

    await expect(page.getByTestId('transition-Submitted')).toBeVisible();
    await expect(page.getByTestId('transition-Executed')).toBeVisible({ timeout: 30_000 });
    // Three named intervals, not one number called "latency".
    await expect(page.getByTestId('interval-Execution delay')).toBeVisible();
    await expect(page.getByTestId('interval-Market waiting')).toBeVisible();
    await expect(page.getByTestId('interval-Notification delay')).toBeVisible();
  });

  test('settings show provenance, and observed evidence is not editable', async ({ page }) => {
    await openDesk(page);
    await page.getByRole('tab', { name: 'Settings' }).click();

    await expect(page.getByTestId('settings-list')).toContainText('TRAINING_ASSUMPTION');
    await page.getByRole('button', { name: 'Pilot reference envelope' }).click();

    // The measured envelope is displayed as evidence...
    await expect(page.getByTestId('provenance-acknowledgementMs')).toContainText('OBSERVED_SAMPLE');
    await expect(page.getByTestId('provenance-acknowledgementMs')).toContainText('not editable');
    // ...with no control that could change it...
    await expect(page.getByRole('spinbutton', { name: 'Acknowledgement envelope' })).toHaveCount(0);
    // ...and the evidence cards live in their own section.
    await expect(page.getByTestId('evidence-cards')).toContainText('single samples');
  });

  test('the desk is keyboard navigable and announces without narrating every tick', async ({ page }) => {
    await openDesk(page);

    await page.getByRole('tab', { name: 'Ticket' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');

    const region = page.getByTestId('desk-announcement');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    const quiet = await region.textContent();

    // Price ticks alone must not produce announcements.
    await page.waitForTimeout(2_000);
    expect(await region.textContent()).toBe(quiet);
  });
});
