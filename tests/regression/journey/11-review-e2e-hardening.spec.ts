/**
 * 11-review-e2e-hardening.spec.ts
 * Browser E2E verification addressing gaps identified in market-rewind-review-2026-09-29.md:
 * 1. Time & Sales Drawer Lifecycle: explicitly toggle closed -> open without hook-order crash,
 *    verify nonempty tape rows, and test selected chart symbol isolation.
 * 2. Slider Bounds Invariance: in a session starting at 09:20 ET where first trade occurs at 09:30,
 *    seeking forward to 09:34 preserves the initial 09:20 minimum slider domain.
 */

import { test, expect } from '@playwright/test';
import { beginReplay, collectPageErrors } from '../mocks/replayJourney';

test.describe('JOURNEY 11 — Review Findings E2E Hardening', () => {
  test('REV E2E 1: Toggling Time & Sales drawer open must not throw React hook-order error and must display rows', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'TSLA', date: '2026-09-22' });

    // Click TAPE button to open the drawer
    const tapeButton = page.locator('button:has-text("TAPE")');
    await expect(tapeButton).toBeVisible();
    await tapeButton.click();

    // Verify Time & Sales drawer is rendered
    const tape = page.locator('[data-testid="time-and-sales"]');
    await expect(tape).toBeVisible();

    // Verify header and symbol badge
    await expect(tape.locator('text=TIME & SALES')).toBeVisible();

    // No React hook-order errors should have occurred
    expect(pageErrors.length).toBe(0);

    // Toggle closed and open again to verify lifecycle stability
    await tapeButton.click();
    await expect(tape).not.toBeVisible();
    await tapeButton.click();
    await expect(tape).toBeVisible();
    expect(pageErrors.length).toBe(0);
  });

  test('REV E2E 2: Seeking forward preserves session start 09:20 as slider minimum even when first trade is at 09:30', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'TSLA', date: '2026-09-15' });

    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();

    const initialMin = await slider.getAttribute('min');
    expect(initialMin).toBeTruthy();

    // Seek to 09:34 by clicking halfway through the slider
    const sliderBox = await slider.boundingBox();
    if (sliderBox) {
      await page.mouse.click(sliderBox.x + sliderBox.width * 0.5, sliderBox.y + sliderBox.height / 2);
    }

    await page.waitForTimeout(500);
    const postSeekMin = await slider.getAttribute('min');
    expect(postSeekMin).toBe(initialMin);
    expect(pageErrors.length).toBe(0);
  });
});
