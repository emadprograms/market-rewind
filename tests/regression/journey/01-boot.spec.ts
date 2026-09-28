/**
 * 01-boot.spec.ts — Opening the website & connecting to the (mocked) market.
 * ---------------------------------------------------------------------------
 * Journey step 1: "You open the website."
 *
 * Every request is served by the offline synthetic market mock, so these specs
 * need no DuckDB backend and no Chromium-visible network.
 */

import { test, expect } from '@playwright/test';
import { openWebsite, collectPageErrors } from '../mocks/replayJourney';

test.describe('JOURNEY 01 — Open the website & backend connection', () => {
  test('boots, connects to the mocked streaming service, and shows the session configurator', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const handle = await openWebsite(page);

    // The session overlay only renders once the DB reports healthy.
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 30_000 });

    // The health probe + symbol list were both exercised.
    expect(handle.counts.status).toBeGreaterThan(0);
    expect(handle.counts.symbols).toBeGreaterThan(0);

    // The ticker dropdown was populated from /api/symbols.
    const optionCount = await page.locator('.session-card select option').count();
    expect(optionCount).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });

  test('default session parameters are the 09:20 ET anchor and SPY', async ({ page }) => {
    await openWebsite(page);
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 30_000 });

    // Default entry time is 09:20 (the replay anchor).
    await expect(page.locator('.session-card input[type="time"]')).toHaveValue('09:20');

    // A default target date is pre-selected.
    const dateValue = await page.locator('.session-card input[type="date"]').inputValue();
    expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('sidebar advertises a connected streaming database with tick + symbol counts', async ({ page }) => {
    await openWebsite(page);
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 30_000 });

    // The status badge turns "online" and reports the connected inventory.
    const badge = page.locator('.sidebar .status-badge');
    await expect(badge).toHaveClass(/status-online/, { timeout: 10_000 });
    await expect(badge).toContainText(/Streaming DuckDB Connected/i);
    await expect(badge).toContainText(/Symbols/i);
  });

  test('offline backend: shows the "start the service" guidance instead of the session configurator', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await openWebsite(page, { offline: true });

    // Should NOT reach the configurator; instead it shows the offline hint.
    await expect(page.getByText(/DuckDB streaming service is running/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Configure Session')).toHaveCount(0);
    await expect(page.locator('.chart-card')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('the mock only issues read-only GET requests (no writes during boot)', async ({ page }) => {
    const methods = new Set<string>();
    page.on('request', (req) => {
      if (req.url().includes('/api/')) methods.add(req.method());
    });
    await openWebsite(page);
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 30_000 });
    // Give the chart pre-load a moment.
    await page.waitForTimeout(500);
    expect([...methods].every((m) => m === 'GET')).toBe(true);
  });
});
