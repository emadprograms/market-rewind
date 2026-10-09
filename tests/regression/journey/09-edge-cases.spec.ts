/**
 * 09-edge-cases.spec.ts — Graceful handling of the awkward cases.
 * ---------------------------------------------------------------------------
 * Weekends/holidays, a truly empty market, sub-second timeframes, network
 * latency, and a full end-to-end smoke run that must stay free of page errors.
 */

import { test, expect } from '@playwright/test';
import {
  openWebsite,
  waitForBackendConnected,
  enterReplayDate,
  startReplay,
  beginReplay,
  chartCard,
  readBarData,
  readPlaybackState,
  playButton,
  pressPlay,
  pressPause,
  setSpeed,
  buyButton,
  sellButton,
  tradeBadge,
  collectPageErrors,
} from '../mocks/replayJourney';

const TARGET = '2026-09-25';

test.describe('JOURNEY 09 — Edge cases & resilience', () => {
  test('a weekend date has no replayable tape but still shows prior-day context', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    // 2026-09-05 is a Saturday.
    await beginReplay(page, { ticker: 'SPY', date: '2026-09-05' });

    // Clock anchors at the weekend 09:10 ET.
    await expect(page.locator('.time-display')).toContainText('09:10:00');

    // No ticks buffered for a non-trading day.
    const state = await readPlaybackState(page);
    expect(state.totalTicks).toBe(0);

    // The scrub slider only renders when there are ticks.
    await expect(page.locator('.playback-bar input[type="range"]')).toHaveCount(0);

    // Prior trading days still render as chart context.
    const bar = await readBarData(chartCard(page, 0));
    expect(bar.barsCount).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });

  test('a market holiday (Labor Day) is treated as non-trading', async ({ page }) => {
    // 2026-09-07 is Labor Day.
    await beginReplay(page, { ticker: 'AAPL', date: '2026-09-07' });
    const state = await readPlaybackState(page);
    expect(state.totalTicks).toBe(0);
  });

  test('a completely empty market shows the Market Closed state and disables PLAY', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await openWebsite(page, { emptyMarket: true });
    await waitForBackendConnected(page);
    await enterReplayDate(page, { ticker: 'SPY', date: TARGET });
    await startReplay(page, { ticker: 'SPY', anchorEt: '09:10:00' });

    // "Market Closed / No Data" guidance is shown.
    await expect(page.getByText('Market Closed / No Data')).toBeVisible({ timeout: 15_000 });

    // PLAY is disabled because there is nothing to replay.
    await expect(playButton(page)).toBeDisabled();

    // Charts are empty (0 bars).
    const bar = await readBarData(chartCard(page, 0));
    expect(bar.barsCount).toBe(0);

    expect(pageErrors).toEqual([]);
  });

  test('switching to a sub-second (1s) timeframe loads without errors', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const card = chartCard(page, 0);
    // Switch to a sub-second timeframe via the quick pill (title="Switch to 1s").
    await card.getByTitle('Switch to 1s').click();

    // Give the streaming/candles request time to resolve.
    await page.waitForTimeout(800);

    // The chart renders at least the forming sub-second candle.
    const bars = parseInt((await card.getAttribute('data-bars-count')) || '0', 10);
    expect(bars).toBeGreaterThanOrEqual(1);

    expect(pageErrors).toEqual([]);
  });

  test('the app tolerates artificial network latency during boot', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await openWebsite(page, { latencyMs: 250 });
    // Even with latency on every request, the configurator eventually appears.
    await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 45_000 });
    expect(pageErrors).toEqual([]);
  });

  test('full end-to-end journey runs clean: open → date → play → trade → close', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // 1. Open + configure + start.
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    // 2. Play timewise.
    await setSpeed(page, '100');
    await pressPlay(page);
    await page.waitForTimeout(900);
    await pressPause(page);

    // 3. Place a buy order.
    await buyButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toBeVisible();

    // 4. Let it play again so the live PnL reflects the move.
    await pressPlay(page);
    await page.waitForTimeout(700);
    await pressPause(page);
    await expect(tradeBadge(page, 0)).toBeVisible();

    // 5. Close the position.
    await sellButton(page, 0).click();
    await expect(tradeBadge(page, 0)).toHaveCount(0);

    // No uncaught errors anywhere in the journey.
    expect(pageErrors).toEqual([]);
  });

  test('switching ticker mid-session loads the new symbol and keeps replay working', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const card = chartCard(page, 0);
    await card.locator('.chart-controls .custom-select').first().click();
    const search = card.locator('.dropdown-search input');
    if (await search.isVisible()) await search.fill('NVDA');
    await card.locator('.dropdown-items .dropdown-item').filter({ hasText: /^NVDA$/ }).first().click();

    await expect(card).toHaveAttribute('data-ticker', 'NVDA', { timeout: 20_000 });
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });

    // Replay still advances after the symbol change.
    await setSpeed(page, '50');
    await pressPlay(page);
    await page.waitForTimeout(600);
    await pressPause(page);

    const state = await readPlaybackState(page);
    expect(state.currentTick).not.toBeNull();

    expect(pageErrors).toEqual([]);
  });
});
