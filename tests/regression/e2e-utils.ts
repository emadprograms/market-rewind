import path from 'path';
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared constants and helpers for the Playwright regression suite.
 *
 * Paths are resolved from `process.cwd()` so they work identically under
 * Playwright's ESM and CJS module loading, and assume `playwright test` is
 * invoked from the repository root (as `npm run test:regression` does).
 */

export const SEED_DATE = '2026-09-25';
export const SEED_SYMBOLS = ['AAPL', 'MSFT', 'SPY'] as const;
export const SEED_DB_DIR = path.resolve(process.cwd(), 'tests/regression/fixtures');
export const SEED_DB_PATH = path.join(SEED_DB_DIR, 'seed.db');

/** The root `.chart-card` element for the chart at `index` (layout '2v' → 2 charts). */
export function chartCard(page: Page, index: number): Locator {
  return page.locator('.chart-card').nth(index);
}

/** The ticker label inside a chart's header (ZONE A of ChartHeader). */
export function headerTicker(card: Locator): Locator {
  return card.locator('.chart-controls .custom-select').first().locator('span').first();
}

/**
 * Boot flow shared by every E2E scenario:
 * configure session on SEED_DATE → start simulator.
 * Supports both direct DuckDB streaming and legacy file input fixture if present.
 * Uses auto-retrying assertions instead of fixed sleeps.
 */
export async function uploadSeedAndStartSession(page: Page): Promise<void> {
  await page.goto('/');
  const fileInput = page.locator('input[type="file"]');
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(SEED_DB_PATH);
  }
  await expect(page.getByText('Configure Session')).toBeVisible();
  await page.locator('.session-card select').first().selectOption('SPY');
  await page.locator('.session-card input[type="date"]').fill(SEED_DATE);
  await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();
  await expect(page.locator('.chart-card')).toHaveCount(2);
  // Header hydrated with the session ticker before any interaction
  await expect(headerTicker(chartCard(page, 0))).toHaveText('SPY');
  await expect(headerTicker(chartCard(page, 1))).toHaveText('SPY');
}

/** Change a chart's ticker through its real UI (header dropdown → item click). */
export async function changeTicker(card: Locator, ticker: string): Promise<void> {
  await card.locator('.chart-controls .custom-select').first().click();
  await card
    .locator('.dropdown-menu .dropdown-item')
    .filter({ hasText: new RegExp(`^${ticker}$`) })
    .click();
}

/** Assign a chart to a group through its real UI ("Group" dropdown). */
export async function joinGroup(card: Locator, color: 'red' | 'blue' | 'green' | 'yellow' | 'none'): Promise<void> {
  const label = color === 'none' ? 'None' : color.charAt(0).toUpperCase() + color.slice(1);
  await card.locator('.chart-actions .custom-select').first().click();
  await card
    .locator('.dropdown-menu .dropdown-item')
    .filter({ hasText: label })
    .click();
}

/** Attach a pageerror collector; assert `expect(pageErrors).toEqual([])` at test end. */
export function collectPageErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  return pageErrors;
}
