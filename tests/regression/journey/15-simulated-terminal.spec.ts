/**
 * 15-simulated-terminal.spec.ts — the simulated trading desk in a real browser.
 * ---------------------------------------------------------------------------
 * Journey step 6: "The user opens the terminal, places an order, and is told the truth about what
 * happened to it."
 *
 * ⚠️ THIS SPEC'S FIRST BROWSER RUN FAILED ALL FIVE TESTS, and the cause was in the spec, not the app.
 *
 * An external verifier ran it on 2026-10-12 (macOS, Chromium): 53 passed / 23 failed across the suite,
 * with every test here failing. The diagnostic showed the ticket rendering em dashes for bid and ask
 * and no order ever being accepted. The reason: this spec replayed SPY, and the simulated account has
 * instrument rules for BTCUSD alone (SIM-QUOTE-02 forbids borrowing one instrument's tick size for
 * another). So there was never a tape for SPY, never a quote, and never a fill to assert on.
 *
 * The spec now does what it should have done from the start: it exercises the terminal on BTCUSD, the
 * one instrument it can trade, and it asserts the honest refusal on a chart symbol the account does
 * not trade, instead of pretending both are the same situation.
 *
 * It uses the same offline mocks as the other journey specs, so it needs no DuckDB backend.
 */

import { test, expect } from '@playwright/test';
import { beginReplay, collectPageErrors } from '../mocks/replayJourney';

const TARGET = '2026-09-25';
const DESK = '[data-testid="trade-desk"]';
const ROWS = '[data-testid="activity-rows"]';

/** The one instrument the simulated account has rules for. */
const TRADEABLE = 'BTCUSD';
/** A chart symbol the simulated account does NOT trade — the app's ordinary equity universe. */
const UNTRADEABLE = 'SPY';

async function openDesk(
  page: import('@playwright/test').Page,
  ticker: string = TRADEABLE,
): Promise<void> {
  await beginReplay(page, { ticker, date: TARGET });
  await page.getByTestId('open-trade-desk').click();
  await expect(page.locator(DESK)).toBeVisible();
}

test.describe('JOURNEY 15 — the simulated trading terminal', () => {
  test('opens as a simulated account with live bid/ask and an unsubmitted ticket', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await openDesk(page); // BTCUSD: the instrument the account has rules for

    // The refusal notice belongs to the other case and must not appear here.
    await expect(page.getByTestId('unsupported-instrument')).toHaveCount(0);

    // The label that keeps this honest.
    await expect(page.locator(DESK)).toContainText('Simulated account');
    await expect(page.locator(DESK)).toContainText('no broker is contacted');

    // A live two-sided market, and no position merely because the desk was opened.
    await expect(page.getByTestId('ticket-bid')).not.toHaveText('—');
    await expect(page.getByTestId('ticket-ask')).not.toHaveText('—');
    await expect(page.locator(ROWS)).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('an instrument the account has no rules for is refused in plain language', async ({ page }) => {
    // The state this spec previously mistook for a working terminal with empty prices. It is not an
    // empty ticket: the instrument is not tradeable, and the desk must say so rather than render a
    // dead ticket and accept a Submit it cannot honour.
    await openDesk(page, UNTRADEABLE);

    const notice = page.getByTestId('unsupported-instrument');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('does not trade SPY');
    // It names the reason and the instrument that IS configured, rather than leaving the user to guess.
    await expect(notice).toContainText('never borrowed from another symbol');
    await expect(notice).toContainText('BTCUSD');

    // And there is no way to submit an instruction it would have to refuse.
    await expect(page.getByRole('button', { name: /Submit BUY/ })).toHaveCount(0);
    await expect(page.getByTestId('ticket-bid')).toHaveCount(0);
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
    // Singular, and deliberately so: each card is one observation, not a distribution. This assertion
    // previously demanded the plural and failed against correct copy.
    await expect(page.getByTestId('evidence-cards')).toContainText('Single sample');
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
