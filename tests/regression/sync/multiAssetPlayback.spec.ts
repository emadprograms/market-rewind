import { test, expect } from '@playwright/test';
import { chartCard, headerTicker, changeTicker, collectPageErrors } from '../e2e-utils';

test.describe('TEST-02: Playwright Multi-Asset Playback Synchronization', () => {
  test('clicking PLAY globally animates replay across different tickers (AAPL & AMD)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/');
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 10000 });

    // Initialize with AAPL on 2026-09-25
    await page.locator('.session-card select').first().selectOption('AAPL');
    await page.locator('.session-card input[type="date"]').fill('2026-09-25');
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

    // Verify 2 charts rendered
    await expect(page.locator('.chart-card')).toHaveCount(2);

    // Set Chart 0 to AAPL, Chart 1 to AMD
    const card0 = chartCard(page, 0);
    const card1 = chartCard(page, 1);
    await changeTicker(card1, 'AMD');

    await expect(headerTicker(card0)).toHaveText('AAPL');
    await expect(headerTicker(card1)).toHaveText('AMD');

    // Both canvases must be visible and rendered
    await expect(card0.locator('canvas').first()).toBeVisible();
    await expect(card1.locator('canvas').first()).toBeVisible();

    // Wait for tick loading to finish before asserting play button
    await expect(page.locator('.playback-bar')).toHaveAttribute('data-ticks-loading', 'false', { timeout: 30000 });

    // Click PLAY
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await expect(playBtn).toBeVisible();
    await playBtn.click();

    // Replay should now be active (button flips to PAUSE)
    await expect(page.getByRole('button', { name: /PAUSE/i })).toBeVisible();

    // Let replay advance for 2 seconds
    await page.waitForTimeout(2000);

    // Verify no runtime crashes occurred during multi-asset streaming
    expect(pageErrors).toEqual([]);
  });
});
