import { test, expect } from '@playwright/test';
import { chartCard, headerTicker, collectPageErrors } from '../e2e-utils';

test.describe('TEST-01: Playwright Date Reset Isolation', () => {
  test('selecting a holiday/weekend date (Sept 7, 2026) does NOT load or play Sept 24 data', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/');
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 10000 });

    // Choose AAPL and Sept 7, 2026 (Labor Day)
    await page.locator('.session-card select').first().selectOption('AAPL');
    await page.locator('.session-card input[type="date"]').fill('2026-09-07');
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

    // Verify workspace loaded
    await expect(page.locator('.chart-card')).toHaveCount(2);

    // Verify time display shows 09:20 ET of Sept 7 or closed state, NOT Sept 24
    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toBeVisible();
    const timeText = await timeDisplay.innerText();
    expect(timeText).not.toContain('24');

    // Click PLAY
    const playBtn = page.getByRole('button', { name: /PLAY|PAUSE/i });
    if (await playBtn.isEnabled()) {
      await playBtn.click();
      await page.waitForTimeout(1000);

      // Verify the time does NOT jump to Sept 24
      const activeTime = await timeDisplay.innerText();
      expect(activeTime).not.toContain('2026-09-24');
      expect(activeTime).not.toContain('24');
    }

    expect(pageErrors).toEqual([]);
  });

  test('resetting date on a normal trading day (Sept 4, 2026) starts at canonical 9:20 AM ET', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/');
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 10000 });

    await page.locator('.session-card select').first().selectOption('AAPL');
    await page.locator('.session-card input[type="date"]').fill('2026-09-04');
    await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

    await expect(page.locator('.chart-card')).toHaveCount(2);

    // Playback bar must show 09:20 AM
    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toBeVisible();
    await expect(timeDisplay).toContainText('09:20:00');

    // Scrubber must be anchored to beginning
    const scrubberText = page.locator('.playback-bar').locator('text=/\\d+\\/\\d+/');
    if (await scrubberText.count() > 0) {
      const text = await scrubberText.innerText();
      const currentTickIdx = parseInt(text.split('/')[0], 10);
      expect(currentTickIdx).toBeLessThanOrEqual(10);
    }

    // Wait for replay buffering to settle
    await expect(page.locator('.playback-bar')).toHaveAttribute('data-ticks-loading', 'false', { timeout: 20000 }).catch(() => {});

    expect(pageErrors).toEqual([]);
  });

  test.afterEach(async ({ page }) => {
    const resetBtn = page.getByRole('button', { name: /Reset Session/i });
    if (await resetBtn.isVisible().catch(() => false)) {
      await resetBtn.click().catch(() => {});
    }
  });
});
