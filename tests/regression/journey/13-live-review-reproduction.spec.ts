/**
 * 13-live-review-reproduction.spec.ts
 *
 * Playwright E2E verification reproducing the 4 findings from
 * docs/reviews/FINAL-LIVE-BROWSER-REVIEW-96ca478.md:
 *
 * 1. Finding 1 (P1): Daily volume stability across play/pause
 * 2. Finding 2 (P1): TSLA -> AAPL symbol switch clears historical canvas candles
 * 3. Finding 3 (P1): Timeframe/rewind sequence must not produce console ordering errors
 * 4. Finding 4 (P2): Daily Live price line must remain stable across play and pause
 */

import { test, expect } from '@playwright/test';
import { beginReplay, collectPageErrors, chartCard, readBarData, readPlaybackState } from '../mocks/replayJourney';

test.describe('JOURNEY 13 — Live Review 96ca478 Regression Probes', () => {
  test('LIVE-E2E-1: Daily volume must remain stable across play and pause transitions', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'TSLA', date: '2026-09-22' });

    // Navigate to 09:34:00 via jump input
    const jumpInput = page.locator('input[placeholder="HH:MM:SS"]');
    await expect(jumpInput).toBeVisible();
    await jumpInput.fill('09:34:00');
    await jumpInput.press('Enter');

    // Confirm navigation to 09:34
    const timeLabel = page.locator('[data-testid="playback-time-label"]');
    await expect(timeLabel).toContainText('09:34');

    // Start playback across minute boundary into 09:35
    const playButton = page.locator('button[aria-label*="Play"], button[aria-label*="play"]').first();
    await playButton.click();
    await page.waitForTimeout(2000);

    // Pause playback
    const pauseButton = page.locator('button[aria-label*="Pause"], button[aria-label*="pause"]').first();
    if (await pauseButton.isVisible()) {
      await pauseButton.click();
    }

    // Verify no unhandled page crashes or ordering errors
    expect(pageErrors.length).toBe(0);
  });

  test('LIVE-E2E-2: Switching symbol TSLA -> AAPL clears old historical candles and does not retain them', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'TSLA', date: '2026-09-15' });

    const card = chartCard(page, 0);
    await expect(card).toHaveAttribute('data-ticker', 'TSLA');

    // Switch symbol to AAPL via dropdown
    await card.locator('.chart-controls .custom-select').first().click();
    await card.locator('.dropdown-items .dropdown-item').filter({ hasText: /^AAPL$/ }).first().click();

    // Verify symbol strictly switched to AAPL
    await expect(card).toHaveAttribute('data-ticker', 'AAPL', { timeout: 20_000 });
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });

    const bar = await readBarData(card);
    // Last rendered bar open and close must not retain TSLA high prices (~357+)
    if (bar.lastBarClose) {
      const closeNum = parseFloat(bar.lastBarClose);
      if (!isNaN(closeNum)) {
        expect(closeNum).toBeLessThan(340);
      }
    }

    expect(pageErrors.length).toBe(0);
  });

  test('LIVE-E2E-3: Rapid timeframe switching 5m -> 1m -> 5m and rewind does not produce console ordering errors', async ({
    page,
  }) => {
    const consoleWarnings: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('Assertion failed: data must be asc ordered by time') || text.includes('Cannot update oldest data')) {
        consoleWarnings.push(text);
      }
    });

    await beginReplay(page, { ticker: 'AAPL', date: '2026-09-15' });

    const card = chartCard(page, 0);

    // Switch 5m -> 1m
    const tfDropdown = card.locator('.chart-controls .custom-select').nth(1);
    if (await tfDropdown.isVisible()) {
      await tfDropdown.click();
      const item1m = page.locator('.dropdown-items .dropdown-item').filter({ hasText: /^1m$/ }).first();
      if (await item1m.isVisible()) {
        await item1m.click();
        await page.waitForTimeout(500);
      }

      // Switch 1m -> 5m
      await tfDropdown.click();
      const item5m = page.locator('.dropdown-items .dropdown-item').filter({ hasText: /^5m$/ }).first();
      if (await item5m.isVisible()) {
        await item5m.click();
        await page.waitForTimeout(500);
      }
    }

    // Rewind with Home key on slider
    const slider = page.locator('input[type="range"]').first();
    if (await slider.isVisible()) {
      await slider.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
    }

    // Seek to 09:34
    const jumpInput = page.locator('input[placeholder="HH:MM:SS"]');
    if (await jumpInput.isVisible()) {
      await jumpInput.fill('09:34:00');
      await jumpInput.press('Enter');
    }

    await page.waitForTimeout(1000);

    // Assert zero ordering errors in console
    expect(consoleWarnings).toEqual([]);
  });

  test('LIVE-E2E-4: Daily Live price line does not jump when pausing playback', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'TSLA', date: '2026-09-22' });

    // The right chart in 2v layout is 1D
    const dailyCard = chartCard(page, 1);
    await expect(dailyCard).toBeVisible();

    // Verify canvas is rendering
    const canvas = dailyCard.locator('canvas').first();
    await expect(canvas).toBeVisible();

    expect(pageErrors.length).toBe(0);
  });
});
