import { test, expect } from '@playwright/test';
import {
  uploadSeedAndStartSession,
  chartCard,
  headerTicker,
  changeTicker,
  joinGroup,
  collectPageErrors,
} from '../e2e-utils';

/**
 * E2E guardrails for group ticker synchronization (QUAL-02).
 *
 * Every step goes through the real UI (header dropdowns, group picker) and
 * every outcome is a hard assertion — a missing element fails the test rather
 * than silently skipping the interaction.
 */
test.describe('Group Synchronization Propagation', () => {
  test('SYNC-03: ticker change in a group leader propagates to all members', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await uploadSeedAndStartSession(page);

    // Put both charts into the red group
    await joinGroup(chartCard(page, 0), 'red');
    await joinGroup(chartCard(page, 1), 'red');

    // Change the ticker on chart 0 — chart 1 must follow in real time
    await changeTicker(chartCard(page, 0), 'AAPL');
    await expect(headerTicker(chartCard(page, 0))).toHaveText('AAPL');
    await expect(headerTicker(chartCard(page, 1))).toHaveText('AAPL');

    // And again in the other direction to catch one-way-sync bugs
    await changeTicker(chartCard(page, 1), 'MSFT');
    await expect(headerTicker(chartCard(page, 1))).toHaveText('MSFT');
    await expect(headerTicker(chartCard(page, 0))).toHaveText('MSFT');

    expect(pageErrors).toEqual([]);
  });

  test('SYNC-02: chart joining an existing group immediately adopts the group ticker', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await uploadSeedAndStartSession(page);

    // Establish the red group on chart 0 with a non-default ticker
    await joinGroup(chartCard(page, 0), 'red');
    await changeTicker(chartCard(page, 0), 'MSFT');
    await expect(headerTicker(chartCard(page, 0))).toHaveText('MSFT');

    // Chart 1 (still on SPY) joins the group → must adopt MSFT on mount-join
    await joinGroup(chartCard(page, 1), 'red');
    await expect(headerTicker(chartCard(page, 1))).toHaveText('MSFT');

    // Leaving the group must decouple chart 1 from future group changes (SYNC-04)
    await joinGroup(chartCard(page, 1), 'none');
    await changeTicker(chartCard(page, 0), 'AAPL');
    await expect(headerTicker(chartCard(page, 0))).toHaveText('AAPL');
    await expect(headerTicker(chartCard(page, 1))).toHaveText('MSFT');

    expect(pageErrors).toEqual([]);
  });
});
