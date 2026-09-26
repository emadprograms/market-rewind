import { test, expect } from '@playwright/test';
import {
  uploadSeedAndStartSession,
  chartCard,
  headerTicker,
  changeTicker,
  collectPageErrors,
} from '../e2e-utils';

/**
 * E2E stability smoke tests for the viewport (QUAL-01).
 *
 * Note: the precise anchor-shift *math* (STAB-01/02/03) is asserted logically
 * by tests/regression/viewport/stability.test.ts via the mocked chart API —
 * that is where pixel/range correctness belongs. These specs verify the same
 * behaviors end-to-end through the real stack (DB worker → hook → canvas):
 * rapid input must not crash or desync the UI, and scrolling into history
 * (which triggers real FETCH_HISTORICAL_CHUNK prepends) must leave the app
 * stable and functional.
 */
test.describe('Viewport Visual Stability', () => {
  test('STAB-01: rapid ticker swaps do not crash or desync the chart', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await uploadSeedAndStartSession(page);

    const card = chartCard(page, 0);
    const swaps = ['AAPL', 'MSFT', 'AAPL', 'MSFT', 'AAPL'] as const;
    for (const ticker of swaps) {
      await changeTicker(card, ticker);
      await expect(headerTicker(card)).toHaveText(ticker);
    }

    // UI still fully functional: both charts present, canvas alive, no crash overlay
    await expect(page.locator('.chart-card')).toHaveCount(2);
    await expect(card.locator('canvas').first()).toBeVisible();
    await expect(headerTicker(chartCard(page, 1))).toHaveText('SPY');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('STAB-02: scrolling into deep history stays stable (real prepend)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await uploadSeedAndStartSession(page);

    const card = chartCard(page, 0);
    const canvas = card.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const boxBefore = await canvas.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Drag right repeatedly: viewport travels into the past, past the initial
    // 30-day fetch window, forcing the worker to prepend historical chunks.
    const cx = boxBefore!.x + boxBefore!.width / 2;
    const cy = boxBefore!.y + boxBefore!.height / 2;
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 320, cy, { steps: 5 });
      await page.mouse.up();
    }

    // App remains healthy: layout intact, header correct, canvas same size
    // (a "violent jump" regression would blur/crash or re-layout the pane)
    await expect(page.locator('.chart-card')).toHaveCount(2);
    await expect(headerTicker(card)).toHaveText('SPY');
    const boxAfter = await canvas.boundingBox();
    expect(boxAfter).not.toBeNull();
    // Allow slight price scale margin adjustment (typically 5-10px) while guarding against violent layout collapse
    expect(Math.abs(boxAfter!.width - boxBefore!.width)).toBeLessThan(15);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
