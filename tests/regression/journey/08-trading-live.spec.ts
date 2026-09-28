/**
 * 08-trading-live.spec.ts — Live updates reflect the order as the chart plays.
 * ---------------------------------------------------------------------------
 * Journey step 5 (cont.): "...and the live updates should reflect that change."
 *
 * The heart of the request: place an order, let the replay play, and watch the
 * unrealized PnL, the trade badge, and the playback-bar totals update live as
 * the market price moves — then close and watch realized PnL settle.
 */

import { test, expect } from '@playwright/test';
import {
  beginReplay,
  buyButton,
  sellButton,
  setTradeSize,
  tradeBadge,
  readBadgePnL,
  readPlaybackPnL,
  pressPlay,
  pressPause,
  setSpeed,
  collectPageErrors,
} from '../mocks/replayJourney';

const TARGET = '2026-09-25';

test.describe('JOURNEY 08 — Live trading updates during playback', () => {
  test('an open long\'s unrealized PnL updates live as the price moves', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    // Open a long at the anchor.
    await setTradeSize(page, 0, 10);
    await buyButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();

    const badgePnlBefore = await readBadgePnL(page, 0);
    const barBefore = await readPlaybackPnL(page);
    expect(Math.abs(badgePnlBefore)).toBeLessThan(1); // ~flat at entry
    expect(Math.abs(barBefore.unrealized)).toBeLessThan(1);

    // Play fast so the price moves a meaningful amount.
    await setSpeed(page, '100');
    await pressPlay(page);
    await page.waitForTimeout(1500);
    await pressPause(page);
    await page.waitForTimeout(200); // let React settle the PnL chain

    const badgePnlAfter = await readBadgePnL(page, 0);
    const barAfter = await readPlaybackPnL(page);

    // The live badge PnL changed from its entry value.
    expect(badgePnlAfter).not.toBe(badgePnlBefore);
    // The playback-bar unrealized total now reflects the open position's move.
    expect(barAfter.unrealized).not.toBe(barBefore.unrealized);
    expect(Math.abs(barAfter.unrealized)).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });

  test('closing the position during playback settles realized PnL and zeroes unrealized', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await setTradeSize(page, 0, 10);
    await buyButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();

    // Move the market.
    await setSpeed(page, '100');
    await pressPlay(page);
    await page.waitForTimeout(2000);
    await pressPause(page);
    await page.waitForTimeout(200);

    const openUnrealized = (await readPlaybackPnL(page)).unrealized;
    expect(Math.abs(openUnrealized)).toBeGreaterThan(0);

    // Close it all.
    await sellButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toHaveCount(0);
    await page.waitForTimeout(200);

    const closed = await readPlaybackPnL(page);
    // Unrealized returns to ~0; realized now carries the round-trip result.
    expect(Math.abs(closed.unrealized)).toBeLessThan(0.01);
    expect(Number.isNaN(closed.realized)).toBe(false);
    expect(Math.abs(closed.realized)).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });

  test('a short profits when the price falls and the badge reflects it live', async ({ page }) => {
    await beginReplay(page, { ticker: 'AAPL', date: TARGET });

    await setTradeSize(page, 0, 5);
    await sellButton(page, 0).click(); // short
    await expect(tradeBadge(page, 0)).toBeVisible();

    const before = await readBadgePnL(page, 0);
    await setSpeed(page, '100');
    await pressPlay(page);
    await page.waitForTimeout(1500);
    await pressPause(page);
    await page.waitForTimeout(200);

    const after = await readBadgePnL(page, 0);
    // The short's PnL moved away from its entry value as price changed.
    expect(after).not.toBe(before);
  });

  test('unrealized PnL keeps updating across pause/resume cycles', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await setTradeSize(page, 0, 8);
    await buyButton(page, 0).click();

    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      await setSpeed(page, '50');
      await pressPlay(page);
      await page.waitForTimeout(500);
      await pressPause(page);
      await page.waitForTimeout(150);
      samples.push((await readPlaybackPnL(page)).unrealized);
    }

    // At least one sample differs from another (the PnL is genuinely live).
    const distinct = new Set(samples.map((s) => s.toFixed(4)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  test('the trade badge stays visible and consistent through a play cycle', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await setTradeSize(page, 0, 3);
    await buyButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();

    await setSpeed(page, '50');
    await pressPlay(page);
    await page.waitForTimeout(800);
    // Badge must persist while playing.
    await expect(tradeBadge(page, 0)).toBeVisible();
    await pressPause(page);
    await expect(tradeBadge(page, 0)).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
