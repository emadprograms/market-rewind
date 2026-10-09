import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared constants and helpers for the Playwright regression suite.
 * All tests connect directly to the streaming DuckDB service (localhost:8765).
 */

export const SEED_DATE = '2026-10-07';
export const SEED_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'AMD'] as const;

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
 * configure session on target date and ticker → start simulator.
 */
export async function startSession(
  page: Page, 
  ticker: string = 'AAPL', 
  date: string = SEED_DATE,
  entryTime?: string
): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
  });
  await page.goto('/');
  const resetBtn = page.getByRole('button', { name: /Reset Session/i });
  if (await resetBtn.isVisible().catch(() => false)) {
    await resetBtn.click().catch(() => {});
  }
  await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.session-card select option')).not.toHaveCount(0);
  await page.locator('.session-card select').first().selectOption(ticker);
  await page.locator('.session-card input[type="date"]').fill(date);
  if (entryTime) {
    await page.locator('.session-card input[type="time"]').fill(entryTime);
  }
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();
  await expect(page.locator('.chart-card')).toHaveCount(2);
  await expect(headerTicker(chartCard(page, 0))).toHaveText(ticker);
  await expect(headerTicker(chartCard(page, 1))).toHaveText(ticker);
  // Verify that charts actually have loaded candle bars (not blank 0 bars)
  await expect(chartCard(page, 0)).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 25000 });
  await expect(chartCard(page, 1)).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 25000 });
  // Verify that replay session time has initialized and transport is ready
  await expect(page.locator('.playback-bar')).toHaveAttribute('data-ticks-loading', 'false', { timeout: 30000 });
  await expect(page.locator('.time-display')).not.toHaveText('--:--:--', { timeout: 30000 });
  await expect(page.getByRole('button', { name: /PLAY/i })).toBeEnabled({ timeout: 30000 });
  // Ensure masterData is populated from DuckDB before tests begin interactions
  await page.waitForFunction(() => {
    const store = (window as any).usePlaybackStore;
    return store && store.getState().masterData && store.getState().masterData.length > 0;
  }, { timeout: 30000 }).catch(() => {});
}


/** Backward compatibility alias */
export const uploadSeedAndStartSession = startSession;

export async function changeTicker(card: Locator, ticker: string): Promise<void> {
  const select = card.locator('.chart-controls .custom-select').first();
  await select.click();
  const searchInput = card.locator('.dropdown-search input');
  await searchInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await searchInput.isVisible()) {
    await searchInput.fill(ticker);
  }
  await card
    .locator('.dropdown-items .dropdown-item')
    .filter({ hasText: new RegExp(`^${ticker}$`) })
    .first()
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
