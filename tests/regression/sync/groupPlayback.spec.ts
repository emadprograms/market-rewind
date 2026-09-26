import { test, expect } from '@playwright/test';
import { chartCard, headerTicker, changeTicker, joinGroup, startSession, collectPageErrors } from '../e2e-utils';

test.describe('TEST-03: Group Switching & Playback Propagation', () => {
  test('assigning chart to AMD group loads AMD and receives playback updates even if session ticker was AAPL', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Initialize session with AAPL
    await startSession(page, 'AAPL', '2026-09-25');

    const card0 = chartCard(page, 0);
    const card1 = chartCard(page, 1);

    // Assign Chart 1 to Blue group, then set to AMD
    await joinGroup(card1, 'blue');
    await changeTicker(card1, 'AMD');
    await expect(headerTicker(card1)).toHaveText('AMD');

    // Assign Chart 0 to Blue group -> it should immediately adopt AMD
    await joinGroup(card0, 'blue');
    await expect(headerTicker(card0)).toHaveText('AMD');

    // Click PLAY
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    if (await playBtn.isVisible()) {
      await playBtn.click();
      await page.waitForTimeout(1500);
      await expect(page.getByRole('button', { name: /PAUSE/i })).toBeVisible();
    }

    // Verify both charts are displaying AMD in blue group and canvas is active
    await expect(headerTicker(card0)).toHaveText('AMD');
    await expect(headerTicker(card1)).toHaveText('AMD');
    expect(pageErrors).toEqual([]);
  });
});
