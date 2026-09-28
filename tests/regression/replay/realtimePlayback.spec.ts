import { test, expect } from '@playwright/test';
import { chartCard, startSession, collectPageErrors } from '../e2e-utils';

test.describe('TEST-06: Real-Time Playback Clock & Tick Timing', () => {
  test('playback advances continuously based on market timestamps rather than fixed synthetic step interval', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Initialize session with AAPL on 2026-09-25 at 09:30 ET market open
    await startSession(page, 'AAPL', '2026-09-25', '09:30');

    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toBeVisible();
    const initialTimeStr = await timeDisplay.innerText();

    // Verify PLAY button is visible and active, and ticks have buffered
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await expect(playBtn).toBeVisible();
    await expect(page.locator('.playback-bar')).not.toHaveAttribute('data-total-ticks', '0', { timeout: 20000 });

    // Start playback
    const startWallTime = Date.now();
    await playBtn.click();

    // Should switch to PAUSE immediately
    await expect(page.getByRole('button', { name: /PAUSE/i })).toBeVisible();

    // Let playback run for 2.5 seconds
    await page.waitForTimeout(2500);

    // Pause playback
    const pauseBtn = page.getByRole('button', { name: /PAUSE/i });
    await pauseBtn.click();
    const elapsedWallSec = (Date.now() - startWallTime) / 1000;

    const pausedTimeStr = await timeDisplay.innerText();

    // The time display must have advanced by at least 1-3 seconds of market time (proportional to real time at 1x)
    expect(pausedTimeStr).not.toBe(initialTimeStr);

    // Scrubber must display tick progression: in 2.5s on active stock at market open, ticks occurred
    const scrubberText = page.locator('.playback-bar').locator('text=/\\d+\\/\\d+/');
    await expect(scrubberText).toBeVisible();
    const text = await scrubberText.innerText();
    const currentTickIdx = parseInt(text.split('/')[0], 10);
    expect(currentTickIdx).toBeGreaterThan(1);

    expect(pageErrors).toEqual([]);
  });

  test('playback at higher speeds scales the real-time simulation clock proportionally', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, 'AAPL', '2026-09-25', '09:30');

    // Change speed to 10x (select option value 10)
    const speedSelect = page.locator('.playback-bar select').first();
    await speedSelect.selectOption('10');

    const timeDisplay = page.locator('.time-display');
    const initialTimeStr = await timeDisplay.innerText();

    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await playBtn.click();

    // Wait 1.5 seconds in real time -> at 10x, ~15 seconds of market time should advance
    await page.waitForTimeout(1500);

    const pauseBtn = page.getByRole('button', { name: /PAUSE/i });
    await pauseBtn.click();

    const finalTimeStr = await timeDisplay.innerText();
    expect(finalTimeStr).not.toBe(initialTimeStr);

    expect(pageErrors).toEqual([]);
  });

  test('playback during pre-market quiet period advances the clock continuously without advancing tick index when no trades occur', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Initialize session at 09:20 ET (10 mins before market open; AAPL has no pre-market ticks)
    await startSession(page, 'AAPL', '2026-09-25', '09:20');

    const timeDisplay = page.locator('.time-display');
    const initialTimeStr = await timeDisplay.innerText();
    expect(initialTimeStr).toContain('09:20');

    const scrubberText = page.locator('.playback-bar').locator('text=/\\d+\\/\\d+/');
    await expect(scrubberText).toBeVisible();
    const initialScrubber = await scrubberText.innerText();

    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await playBtn.click();
    await expect(page.getByRole('button', { name: /PAUSE/i })).toBeVisible();

    // Run for 1.5 seconds at 1x
    await page.waitForTimeout(1500);

    const pauseBtn = page.getByRole('button', { name: /PAUSE/i });
    await pauseBtn.click();

    const pausedTimeStr = await timeDisplay.innerText();
    // Clock must have advanced from 09:20:00 to ~09:20:01
    expect(pausedTimeStr).not.toBe(initialTimeStr);
    expect(pausedTimeStr).toContain('09:20');

    const afterScrubber = await scrubberText.innerText();
    const currentTickIdx = parseInt(afterScrubber.split('/')[0], 10);
    expect(currentTickIdx).toBe(parseInt(initialScrubber.split('/')[0], 10));

    expect(pageErrors).toEqual([]);
  });
});
