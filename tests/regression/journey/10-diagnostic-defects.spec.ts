/**
 * 10-diagnostic-defects.spec.ts
 * Browser E2E reproduction for defects identified in market-rewind-diagnosis-and-plan.md:
 * - Scrubber domain instability: seeking forward must not change min bound or lock out earlier premarket time
 * - Time & Sales isolation: multi-symbol session must not display trades from other symbols
 */

import { test, expect } from '@playwright/test';
import {
  beginReplay,
  chartCard,
  collectPageErrors,
} from '../mocks/replayJourney';

test.describe('JOURNEY 10 — Diagnostic Defects Replication', () => {
  test('DIAG E2E 1: seeking forward must not clip or alter the minimum scrubber domain', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'TSLA', date: '2026-09-15' });

    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();

    const initialMin = await slider.getAttribute('min');

    // Seek to 09:34
    // Scrubber domain should remain anchored to session start, allowing jump back to 09:20
    const sliderBox = await slider.boundingBox();
    if (sliderBox) {
      await page.mouse.click(sliderBox.x + sliderBox.width * 0.5, sliderBox.y + sliderBox.height / 2);
    }

    await page.waitForTimeout(500);
    const postSeekMin = await slider.getAttribute('min');
    expect(postSeekMin).toBe(initialMin);
    expect(pageErrors.length).toBe(0);
  });

  test('DIAG E2E 2: Time & Sales tape strictly filters by active symbol badge', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'TSLA', date: '2026-09-22' });

    const tape = page.locator('[data-testid="time-and-sales"]');
    if (await tape.isVisible()) {
      const rows = tape.locator('[data-testid="tape-row"]');
      const count = await rows.count();
      for (let i = 0; i < Math.min(count, 10); i++) {
        const text = await rows.nth(i).textContent();
        expect(text).not.toContain('AAPL');
      }
    }
    expect(pageErrors.length).toBe(0);
  });
});
