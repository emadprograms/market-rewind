import { test, expect } from '@playwright/test';
import { chartCard, startSession, collectPageErrors } from '../e2e-utils';

test.describe('TEST-08: Historical Random Day Replay (April 4th, 2025)', () => {

  test('Open SPY on 2025-04-04 at 09:30: verify neither 5min nor 1D leak future candles, press play, and verify clean playback', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // 1. Initialize session for SPY on 2025-04-04 at 09:30 ET market open
    await startSession(page, 'SPY', '2025-04-04', '09:30');

    const card0 = chartCard(page, 0); // 5min chart
    const card1 = chartCard(page, 1); // 1D chart

    // 2. Both charts must have loaded bars
    await expect(card0).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });
    await expect(card1).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });

    // 3. Inspect Chart 0 (5min) last bar timestamp immediately after startSession
    const barData0 = await card0.evaluate((el: HTMLElement) => ({
      barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
      firstBarTime: el.getAttribute('data-first-bar-time'),
      lastBarTime: el.getAttribute('data-last-bar-time'),
      lastBarOpen: el.getAttribute('data-last-bar-open'),
      lastBarClose: el.getAttribute('data-last-bar-close'),
    }));

    console.log('Chart 0 (5min) at 09:30:', barData0);

    // The last bar timestamp on 5min chart must be <= 09:30 ET (13:30 UTC), NEVER afternoon or evening
    expect(barData0.lastBarTime).toBeTruthy();
    if (barData0.lastBarTime) {
      const utcDate = new Date(barData0.lastBarTime.replace(' ', 'T') + (barData0.lastBarTime.includes('Z') ? '' : 'Z'));
      const nyTime = utcDate.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
      console.log('Chart 0 last bar in NY time:', nyTime);
      expect(nyTime).toMatch(/^(09:2\d|09:30)$/);
      expect(nyTime).not.toMatch(/^(16:|19:|20:)/);
    }

    // 4. Inspect Chart 1 (1D) at 09:30 ET
    const barData1 = await card1.evaluate((el: HTMLElement) => ({
      barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
      firstBarTime: el.getAttribute('data-first-bar-time'),
      lastBarTime: el.getAttribute('data-last-bar-time'),
      lastBarOpen: el.getAttribute('data-last-bar-open'),
      lastBarClose: el.getAttribute('data-last-bar-close'),
    }));

    console.log('Chart 1 (1D) at 09:30:', barData1);

    // On April 4th, 2025, SPY closed at $505.50 at 19:55 PM (a massive drop).
    // At 09:30 AM market open, SPY opened at ~$523.67.
    // The 1D chart at 09:30 AM must NOT display the future close of $505.50!
    if (barData1.lastBarClose) {
      const dailyClose = parseFloat(barData1.lastBarClose);
      console.log('Chart 1 daily last close price:', dailyClose);
      // It must be around $523 (forming) or $536 (previous day's close on April 3rd), NEVER 505!
      expect(dailyClose).toBeGreaterThan(515);
    }

    // 5. Time display must show 09:30:00 ET
    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toContainText('09:30:00');

    // 6. Click PLAY to start replay
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await expect(playBtn).toBeEnabled({ timeout: 10000 });
    await playBtn.click();

    // Replay is now running. Increase playback speed to 10x so we can watch time advance
    const speedSelect = page.locator('.playback-bar select');
    if (await speedSelect.isVisible()) {
      await speedSelect.selectOption('10');
    }

    // Wait 3 seconds for playback to advance (30s market time)
    await page.waitForTimeout(3000);

    // Check that time has advanced past 09:30:00
    const advancedTimeText = await timeDisplay.textContent();
    console.log('Advanced time text:', advancedTimeText);
    expect(advancedTimeText).not.toContain('09:30:00.000');

    // Inspect the chart bars after playback
    const playingBarData0 = await card0.evaluate((el: HTMLElement) => ({
      barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
      lastBarTime: el.getAttribute('data-last-bar-time'),
      lastBarOpen: el.getAttribute('data-last-bar-open'),
      lastBarClose: el.getAttribute('data-last-bar-close'),
    }));
    console.log('Chart 0 after 3s playback at 10x:', playingBarData0);

    if (playingBarData0.lastBarTime) {
      const utcDate = new Date(playingBarData0.lastBarTime.replace(' ', 'T') + (playingBarData0.lastBarTime.includes('Z') ? '' : 'Z'));
      const nyTime = utcDate.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
      console.log('Playing last bar in NY time:', nyTime);
      expect(nyTime).toMatch(/^(09:2\d|09:3\d|09:4\d)$/);
      expect(nyTime).not.toMatch(/^(16:|19:|20:)/);
    }

    expect(pageErrors).toEqual([]);
  });

  test('Cold load: Date selected as 2025-04-04 before session start never leaks end-of-day candles', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/');
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 20000 });

    // Pick 2025-04-04
    await page.locator('.session-card select').first().selectOption('SPY');
    await page.locator('.session-card input[type="date"]').fill('2025-04-04');
    await page.locator('.session-card input[type="time"]').fill('09:30');

    // Check chart behind modal
    const card0 = chartCard(page, 0);
    const barCount = await card0.getAttribute('data-bars-count');
    if (barCount && parseInt(barCount, 10) > 0) {
      const lastBar = await card0.getAttribute('data-last-bar-time');
      if (lastBar) {
        const utcDate = new Date(lastBar.replace(' ', 'T') + (lastBar.includes('Z') ? '' : 'Z'));
        const nyTime = utcDate.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
        });
        console.log('Cold load preview last bar NY time:', nyTime);
        expect(nyTime).not.toMatch(/^(16:|19:|20:)/);
      }
    }

    expect(pageErrors).toEqual([]);
  });

  test('Live progression: When playback advances across candle boundary, new candle dynamically appears', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Initialize session at 09:34 ET
    await startSession(page, 'SPY', '2025-04-04', '09:34');

    const card0 = chartCard(page, 0);
    await expect(card0).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });

    const initialBarsCount = await card0.evaluate((el: HTMLElement) => parseInt(el.getAttribute('data-bars-count') || '0', 10));
    console.log('Initial bars count at 09:34:', initialBarsCount);

    // Increase speed to 50x
    const speedSelect = page.locator('.playback-bar select');
    if (await speedSelect.isVisible()) {
      await speedSelect.selectOption('50');
    }

    // Press PLAY
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await expect(playBtn).toBeEnabled({ timeout: 10000 });
    await playBtn.click();

    // Wait 3 seconds at 50x (150 market seconds -> passes 09:35:00 to ~09:36:30)
    await page.waitForTimeout(3500);

    const timeDisplay = page.locator('.time-display');
    const advancedText = await timeDisplay.textContent();
    console.log('Advanced time text at 50x:', advancedText);

    // Verify time has passed 09:35:00
    expect(advancedText).toMatch(/09:3[5-9]:\d\d/);

    // Check that the new 09:35 candle appeared on Chart 0
    const advancedBarData = await card0.evaluate((el: HTMLElement) => ({
      barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
      lastBarTime: el.getAttribute('data-last-bar-time'),
      lastBarOpen: el.getAttribute('data-last-bar-open'),
      lastBarClose: el.getAttribute('data-last-bar-close'),
    }));
    console.log('Advanced bar data at 50x:', advancedBarData);

    expect(advancedBarData.barsCount).toBeGreaterThanOrEqual(initialBarsCount);
    if (advancedBarData.lastBarTime) {
      const utcDate = new Date(advancedBarData.lastBarTime.replace(' ', 'T') + (advancedBarData.lastBarTime.includes('Z') ? '' : 'Z'));
      const nyTime = utcDate.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
      console.log('Advanced last bar NY time:', nyTime);
      expect(nyTime).toMatch(/^(09:35|09:36|09:37)$/);
      expect(nyTime).not.toMatch(/^(16:|19:|20:)/);
    }

    expect(pageErrors).toEqual([]);
  });
});
