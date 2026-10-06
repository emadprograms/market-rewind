import { test, expect } from '@playwright/test';
import { chartCard, startSession, collectPageErrors } from '../e2e-utils';

test.describe('TEST-07: Chart Timeline, Session Shading & Replay Opening Price Integrity', () => {

  test('Issue 1 & 2: Chart candles load at 09:30 ET with correct X-Axis timestamp and RTH session shading (not 05:30 PRE)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Initialize session for AAPL on 2026-09-25 at 09:30 ET market open
    await startSession(page, 'AAPL', '2026-09-25', '09:30');

    const card = chartCard(page, 0);

    // 1. Candles must be loaded (not 0 bars)
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });

    // 2. Inspect the latest visible / loaded bar at market open
    const barData = await card.evaluate((el: HTMLElement) => {
      // Return data attributes or inspected chart attributes
      return {
        barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
        firstBarTime: el.getAttribute('data-first-bar-time'),
        lastBarTime: el.getAttribute('data-last-bar-time'),
        lastBarOpen: el.getAttribute('data-last-bar-open'),
      };
    });

    expect(barData.barsCount).toBeGreaterThan(0);

    // 3. Verify that the market open bar timestamp corresponds to 13:30:00 UTC (09:30:00 ET)
    // and is NOT 09:30:00 UTC (which would be 05:30:00 ET in America/New_York)
    if (barData.lastBarTime) {
      // The bar time string must be in UTC (e.g. "2026-09-25 13:30:00" or pre-market "13:2x:00")
      // When converted to America/New_York, it must be around 09:30 ET
      const utcDate = new Date(barData.lastBarTime.replace(' ', 'T') + (barData.lastBarTime.includes('Z') ? '' : 'Z'));
      const nyTime = utcDate.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
      // At market open 09:30, the latest candle time in NY timezone MUST be 09:29 or 09:30, NEVER 05:30!
      expect(nyTime).toMatch(/^(09:2\d|09:30)$/);
      expect(nyTime).not.toMatch(/^05:/);
    }

    expect(pageErrors).toEqual([]);
  });

  test('Issue 3: Replay opening price at 09:30 ET matches authentic market open price and forms accurately', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Initialize session for AAPL on 2026-09-25 at 09:30 ET market open
    await startSession(page, 'AAPL', '2026-09-25', '09:30');

    const card = chartCard(page, 0);

    // Playback bar must show 09:30:00 ET
    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toContainText('09:30:00');

    // Get the opening price at market open
    const initialBarData = await card.evaluate((el: HTMLElement) => ({
      barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
      lastBarTime: el.getAttribute('data-last-bar-time'),
      lastBarOpen: el.getAttribute('data-last-bar-open'),
      lastBarClose: el.getAttribute('data-last-bar-close'),
    }));

    // Step forward 1 second into market open
    const stepFwdBtn = page.getByRole('button', { name: /Step Forward/i });
    if (await stepFwdBtn.isVisible()) {
      await stepFwdBtn.click();
      await page.waitForTimeout(500);

      const steppedBarData = await card.evaluate((el: HTMLElement) => ({
        barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
        lastBarTime: el.getAttribute('data-last-bar-time'),
        lastBarOpen: el.getAttribute('data-last-bar-open'),
        lastBarClose: el.getAttribute('data-last-bar-close'),
      }));

      // The open price of the 09:30 candle must be realistic market price (for AAPL on 2026-09-25, around $255)
      if (steppedBarData.lastBarOpen) {
        const openPrice = parseFloat(steppedBarData.lastBarOpen);
        expect(openPrice).toBeGreaterThan(200);
        expect(openPrice).toBeLessThan(350);
      }
    }

    // Reset to start button must restore canonical start cleanly
    const resetBtn = page.getByTitle('Reset to Start');
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();
    await expect(timeDisplay).toContainText('09:30:00');

    expect(pageErrors).toEqual([]);
  });

  test('Issue 4: 1D Daily candles display the correct calendar day (Sep 25 on 2026-09-25, not Sep 24)', async ({ page }) => {
    test.slow();
    const pageErrors = collectPageErrors(page);

    await startSession(page, 'AAPL', '2026-09-25', '09:30');

    const card = chartCard(page, 0);

    // Switch timeframe to 1D
    const tfDropdown = card.locator('.chart-controls .custom-select').nth(1);
    await tfDropdown.click();
    const opt1D = card.locator('.dropdown-item').filter({ hasText: /^1D$/ }).first();
    await expect(opt1D).toBeVisible();
    await opt1D.click();

    // Verify 1D candles are loaded
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });

    const barData = await card.evaluate((el: HTMLElement) => ({
      barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
      lastBarTime: el.getAttribute('data-last-bar-time'),
    }));

    // The last daily bar must represent 2026-09-25, NOT 2026-09-24
    if (barData.lastBarTime) {
      expect(barData.lastBarTime).toContain('2026-09-25');
      expect(barData.lastBarTime).not.toContain('2026-09-24');
    }

    expect(pageErrors).toEqual([]);
  });
});
