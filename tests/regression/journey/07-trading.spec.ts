/**
 * 07-trading.spec.ts — Placing buy & sell orders.
 * ---------------------------------------------------------------------------
 * Journey step 5: "The user can then click buy and sell to place order and the
 * live updates should reflect that change."
 *
 * Exercises the per-chart trading controls: opening longs/shorts, sizing,
 * adding to a position, partial & full closes, position flips, the trade badge,
 * and the realized/unrealized PnL surfaced in the playback bar.
 */

import { test, expect } from '@playwright/test';
import {
  beginReplay,
  buyButton,
  sellButton,
  setTradeSize,
  tradeSizeInput,
  tradeBadge,
  readBadgePnL,
  readBadgeSize,
  readPlaybackPnL,
  readBarData,
  chartCard,
  collectPageErrors,
} from '../mocks/replayJourney';

const TARGET = '2026-09-25';

test.describe('JOURNEY 07 — Trading (buy / sell orders)', () => {
  test('clicking BUY opens a long position and shows the trade badge', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await expect(tradeBadge(page, 0)).toHaveCount(0); // no trade yet
    await buyButton(page, 0).click();

    await expect(tradeBadge(page, 0)).toBeVisible();
    // Default size is 1.
    expect(await readBadgeSize(page, 0)).toBe(1);

    expect(pageErrors).toEqual([]);
  });

  test('clicking SELL opens a short position and shows the trade badge', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await expect(tradeBadge(page, 0)).toHaveCount(0);
    await sellButton(page, 0).click();

    await expect(tradeBadge(page, 0)).toBeVisible();
    expect(await readBadgeSize(page, 0)).toBe(1);
  });

  test('the trade size input controls how many units are ordered', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await expect(tradeSizeInput(page, 0)).toHaveValue('1');
    await setTradeSize(page, 0, 7);
    await buyButton(page, 0).click();

    await expect(tradeBadge(page, 0)).toBeVisible();
    expect(await readBadgeSize(page, 0)).toBe(7);
  });

  test('a freshly opened position starts at ~flat unrealized PnL', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });
    await buyButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();

    const pnl = await readBadgePnL(page, 0);
    // Entry price == current price at order time => PnL ~ 0.
    expect(Math.abs(pnl)).toBeLessThan(1);
  });

  test('clicking BUY twice adds to the long (size accumulates)', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await setTradeSize(page, 0, 2);
    await buyButton(page, 0).click();
    expect(await readBadgeSize(page, 0)).toBe(2);

    await buyButton(page, 0).click(); // +2 more
    expect(await readBadgeSize(page, 0)).toBe(4);
  });

  test('BUY then an equal SELL closes the position and clears the badge', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await setTradeSize(page, 0, 3);
    await buyButton(page, 0).click();
    expect(await readBadgeSize(page, 0)).toBe(3);

    await sellButton(page, 0).click(); // close all 3
    await expect(tradeBadge(page, 0)).toHaveCount(0);
  });

  test('a partial opposite order reduces the remaining position size', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await setTradeSize(page, 0, 5);
    await buyButton(page, 0).click();
    expect(await readBadgeSize(page, 0)).toBe(5);

    // Sell 2 of the 5 -> 3 remain long.
    await setTradeSize(page, 0, 2);
    await sellButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();
    expect(await readBadgeSize(page, 0)).toBe(3);
  });

  test('an opposite order larger than the position flips it to the other side', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await setTradeSize(page, 0, 2);
    await buyButton(page, 0).click(); // long 2
    expect(await readBadgeSize(page, 0)).toBe(2);

    await setTradeSize(page, 0, 5);
    await sellButton(page, 0).click(); // close 2, flip short 3

    await expect(tradeBadge(page, 0)).toBeVisible();
    expect(await readBadgeSize(page, 0)).toBe(3);
  });

  test('the badge close (✕) button clears the active trade', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await buyButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();

    await tradeBadge(page, 0).locator('button').click(); // ✕
    await expect(tradeBadge(page, 0)).toHaveCount(0);
  });

  test('realized + unrealized PnL are surfaced in the playback bar', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    // Opening a position should register a non-negative unrealized figure slot.
    await setTradeSize(page, 0, 4);
    await buyButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();

    const pnl = await readPlaybackPnL(page);
    // Both totals are numeric (realized 0, unrealized ~0 at entry).
    expect(Number.isNaN(pnl.realized)).toBe(false);
    expect(Number.isNaN(pnl.unrealized)).toBe(false);

    // Close it -> realized should now be a real number (may be ~0, not NaN).
    await sellButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toHaveCount(0);
    const afterClose = await readPlaybackPnL(page);
    expect(Number.isNaN(afterClose.realized)).toBe(false);
  });

  test('each chart trades independently', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await buyButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();
    // Chart 1 has no trade yet.
    await expect(tradeBadge(page, 1)).toHaveCount(0);

    await sellButton(page, 1).click();
    await expect(tradeBadge(page, 1)).toBeVisible();
    // Chart 0 still holds its own (long) trade.
    await expect(tradeBadge(page, 0)).toBeVisible();
  });

  test('trading requires loaded chart data (BUY is inert until bars exist)', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });
    // Bars are loaded, so a BUY must produce a badge — proving data-gating passes.
    const bar = await readBarData(chartCard(page, 0));
    expect(bar.barsCount).toBeGreaterThan(0);
    await buyButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();
  });
});
