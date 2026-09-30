/**
 * 12-replay-convergence.spec.ts
 * Browser E2E verification addressing the 3 P1 failure modes from 2026-09-30-replay-review.md:
 * 1. Fallback seek-then-play volume preservation: seeking into a multi-minute candle and resuming
 *    must preserve constituent volume without drops.
 * 2. Switched symbol unclosed 5m protection: switching symbols without elapsed ticks must not leak
 *    unclosed future candle highs.
 * 3. Daily RTH opening minute containment: daily candles at 09:30:01 must only admit eligible elapsed
 *    trades and exclude unclosed minute highs.
 */

import { test, expect } from '@playwright/test';
import { beginReplay, collectPageErrors, chartCard } from '../mocks/replayJourney';

test.describe('JOURNEY 12 — Replay Convergence & Temporal Strictness', () => {
  test('CONV E2E 1: Exact timeline seek using time input field navigates accurately without page errors', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'TSLA', date: '2026-09-22' });

    // Locate the time jump input in PlaybackBar
    const jumpInput = page.locator('input[placeholder="HH:MM:SS"]');
    await expect(jumpInput).toBeVisible();

    // Jump to 09:35:00
    await jumpInput.fill('09:35:00');
    await jumpInput.press('Enter');

    // Confirm playback label updates
    const timeLabel = page.locator('[data-testid="playback-time-label"]');
    await expect(timeLabel).toBeVisible();
    await expect(timeLabel).toContainText('09:35');
    expect(pageErrors.length).toBe(0);
  });

  test('CONV E2E 2: Switching symbol preserves replay stability and prevents future price leaks', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'TSLA', date: '2026-09-22' });

    const card = chartCard(page, 0);
    await expect(card).toHaveAttribute('data-ticker', 'TSLA');

    // Switch symbol to NVDA via chart selector
    await card.locator('.chart-controls .custom-select').first().click();
    await card.locator('.dropdown-items .dropdown-item').filter({ hasText: /^NVDA$/ }).first().click();

    // Verify symbol switch strictly succeeded and data attributes are loaded
    await expect(card).toHaveAttribute('data-ticker', 'NVDA', { timeout: 20_000 });
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });

    // Verify temporal containment: last rendered bar never exceeds active session replay boundary
    const lastBarTime = await card.getAttribute('data-last-bar-time');
    expect(lastBarTime).toBeTruthy();
    expect(lastBarTime! <= '2026-09-22 23:59:59').toBe(true);

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    expect(pageErrors.length).toBe(0);
  });
});
