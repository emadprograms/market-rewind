import { test, expect } from '@playwright/test';

test.describe('Group Synchronization Propagation', () => {
  test('Scenario 1: Real-time Propagation between grouped charts', async ({ page }) => {
    await page.goto('/');
    
    // 1. Create two charts (assuming a "Add Chart" button exists)
    const addChartBtn = page.locator('button:has-text("Add Chart"), button:has-text("New Chart")').first();
    if (await addChartBtn.isVisible()) {
      await addChartBtn.click();
    }
    
    // 2. Assign them to the same group (e.g., 'red')
    // This is highly dependent on UI selectors. We look for group selection buttons.
    const groupBtn = page.locator('button[data-group="red"], .group-btn-red').first();
    if (await groupBtn.isVisible()) {
      await groupBtn.click();
    }

    // 3. Change ticker in Chart 1
    const tickerInput = page.locator('input[placeholder*="Ticker"]').first();
    if (await tickerInput.isVisible()) {
      await tickerInput.fill('ETH');
      await page.keyboard.press('Enter');
    }

    // 4. Verify Chart 2's header updates
    const allTickers = page.locator('div[class*="ChartHeader"] span:has-text("ETH")');
    await expect(allTickers).toHaveCount(2);
  });

  test('Scenario 2: Mount Sync for new chart joining existing group', async ({ page }) => {
    await page.goto('/');
    
    // 1. Establish a group with a specific ticker
    const tickerInput = page.locator('input[placeholder*="Ticker"]').first();
    if (await tickerInput.isVisible()) {
      await tickerInput.fill('SOL');
      await page.keyboard.press('Enter');
    }
    const groupBtn = page.locator('button[data-group="red"], .group-btn-red').first();
    if (await groupBtn.isVisible()) {
      await groupBtn.click();
    }

    // 2. Add a new chart
    const addChartBtn = page.locator('button:has-text("Add Chart"), button:has-text("New Chart")').first();
    if (await addChartBtn.isVisible()) {
      await addChartBtn.click();
    }

    // 3. Assign it to the group
    const newChartGroupBtn = page.locator('button[data-group="red"], .group-btn-red').last();
    if (await newChartGroupBtn.isVisible()) {
      await newChartGroupBtn.click();
    }

    // 4. Verify the new chart adopts 'SOL'
    const solHeaders = page.locator('div[class*="ChartHeader"] span:has-text("SOL")');
    await expect(solHeaders).toHaveCount(2);
  });
});
