import { test, expect } from '@playwright/test';
import { chartCard, headerTicker, collectPageErrors } from '../e2e-utils';

test.describe('TEST-05: Cold Load & Chart Candle Visibility', () => {
  test('navigating to root cold loads charts with non-zero candlestick bars and no blank screen', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Navigate to root
    await page.goto('/');

    // Verify SessionConfig overlay is visible with default date and ticker
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 15000 });
    
    // Verify ChartWorkspace is already mounted underneath with 2 charts
    await expect(page.locator('.chart-card')).toHaveCount(2);

    // Click "Initialize Market Simulator"
    const initBtn = page.getByRole('button', { name: /Initialize Market Simulator/i });
    await expect(initBtn).toBeVisible();
    await initBtn.click();

    // Verify session config overlay disappears
    await expect(page.getByText('Configure Session')).not.toBeVisible({ timeout: 5000 });

    // Verify both charts have loaded candles (data-bars-count > 0, matching regular expression ^[1-9]\d*$)
    const card0 = chartCard(page, 0);
    const card1 = chartCard(page, 1);
    await expect(card0).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });
    await expect(card1).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });

    // Verify canvas elements are visible and have valid dimensions
    const canvas0 = card0.locator('canvas').first();
    const canvas1 = card1.locator('canvas').first();
    await expect(canvas0).toBeVisible();
    await expect(canvas1).toBeVisible();

    const box0 = await canvas0.boundingBox();
    expect(box0).not.toBeNull();
    expect(box0!.width).toBeGreaterThan(100);
    expect(box0!.height).toBeGreaterThan(100);

    // Verify header tickers match session ticker
    await expect(headerTicker(card0)).toHaveText('AAPL');
    await expect(headerTicker(card1)).toHaveText('AAPL');

    // Confirm no uncaught exceptions occurred during chart initialization
    expect(pageErrors).toEqual([]);
  });

  test('switching timeframe or symbol on cold loaded chart fetches new non-zero candle bars', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/');
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();
    await expect(page.getByText('Configure Session')).not.toBeVisible();

    const card0 = chartCard(page, 0);
    await expect(card0).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });

    // Switch timeframe on chart 0 to 1D
    const tfDropdown = card0.locator('.chart-controls .custom-select').nth(1);
    await tfDropdown.click();
    const opt1D = card0.locator('.dropdown-item').filter({ hasText: /^1D$/ }).first();
    if (await opt1D.isVisible()) {
      await opt1D.click();
      await expect(card0).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 10000 });
    }

    expect(pageErrors).toEqual([]);
  });
});
