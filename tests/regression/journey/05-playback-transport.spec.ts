/**
 * 05-playback-transport.spec.ts — Playing the chart timewise.
 * ---------------------------------------------------------------------------
 * Journey step 4: "When the user clicks play, then timewise the chart should
 * be playing."
 *
 * Covers the transport controls: play/pause toggling, continuous time advance,
 * speed multipliers, single-tick stepping, scrubber seeking, and reset-to-open.
 */

import { test, expect } from '@playwright/test';
import {
  beginReplay,
  chartCard,
  readBarData,
  readPlaybackState,
  readReplayClock,
  pressPlay,
  pressPause,
  playButton,
  setSpeed,
  readScrubber,
  seekScrubber,
  utcToEtClock,
  collectPageErrors,
} from '../mocks/replayJourney';

const TARGET = '2026-09-25';

test.describe('JOURNEY 05 — Playback transport (play / pause / step / scrub / speed)', () => {
  test('clicking PLAY toggles the control to PAUSE and starts the clock', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await expect(playButton(page)).toBeEnabled();
    await pressPlay(page); // PLAY -> PAUSE, clock running

    const running = await readPlaybackState(page);
    expect(running.isPaused).toBe(false);

    expect(pageErrors).toEqual([]);
  });

  test('the replay clock advances continuously while playing', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const startClock = await readReplayClock(page);
    await pressPlay(page);
    await page.waitForTimeout(1200);
    await pressPause(page);
    const endClock = await readReplayClock(page);

    expect(endClock).not.toBe(startClock);
    // Time strictly moved forward.
    expect(endClock > startClock).toBe(true);
  });

  test('a higher speed multiplier advances more market-time per wall-second', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    // 1x baseline.
    await pressPlay(page);
    await page.waitForTimeout(700);
    await pressPause(page);
    const after1x = await readPlaybackState(page);

    // Reset to the anchor, then run at 50x.
    await page.getByTitle('Reset to Start').click();
    await setSpeed(page, '50');
    await pressPlay(page);
    await page.waitForTimeout(700);
    await pressPause(page);
    const after50x = await readPlaybackState(page);

    // Both advanced from the anchor; the 50x run advanced the tick cursor
    // strictly further than the 1x run did in the same wall-clock window.
    expect(after1x.currentTime!).toBeGreaterThan(0);
    expect(after50x.currentTickIndex).toBeGreaterThan(after1x.currentTickIndex);
  });

  test('PAUSE freezes the clock and PLAY resumes from where it stopped', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    await pressPlay(page);
    await page.waitForTimeout(600);
    await pressPause(page);

    const frozen = await readReplayClock(page);
    await page.waitForTimeout(400);
    const stillFrozen = await readReplayClock(page);
    expect(stillFrozen).toBe(frozen); // paused => no movement

    await pressPlay(page);
    await page.waitForTimeout(500);
    await pressPause(page);
    const resumed = await readReplayClock(page);
    expect(resumed > frozen).toBe(true);
  });

  test('single-tick step forward / backward moves the cursor by one tick', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const start = await readPlaybackState(page);

    await page.getByTitle('Step 1 Tick Forward').click();
    await page.waitForTimeout(150);
    const fwd = await readPlaybackState(page);
    expect(fwd.currentTickIndex).toBe(start.currentTickIndex + 1);

    await page.getByTitle('Step 1 Tick Backward').click();
    await page.waitForTimeout(150);
    const back = await readPlaybackState(page);
    expect(back.currentTickIndex).toBe(start.currentTickIndex);
  });

  test('the scrubber seek jumps the cursor and updates the clock', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const { total } = await readScrubber(page);
    expect(total).toBeGreaterThan(10);

    // Seek to ~25% into the tape.
    const targetIndex = Math.floor(total * 0.25);
    await seekScrubber(page, targetIndex);
    await page.waitForTimeout(250);

    const state = await readPlaybackState(page);
    expect(Math.abs(state.currentTickIndex - targetIndex)).toBeLessThanOrEqual(1);

    // The scrubber label reflects the new position.
    const { current } = await readScrubber(page);
    expect(Math.abs(current - (targetIndex + 1))).toBeLessThanOrEqual(1);
  });

  test('Reset to Start returns the cursor to the 09:10 anchor', async ({ page }) => {
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    // Advance well into the session first.
    await setSpeed(page, '100');
    await pressPlay(page);
    await page.waitForTimeout(900);
    await pressPause(page);

    const advancedClock = await readReplayClock(page);
    expect(advancedClock > '09:10:00.000').toBe(true);

    await page.getByTitle('Reset to Start').click();
    await page.waitForTimeout(250);

    const resetClock = await readReplayClock(page);
    expect(resetClock.startsWith('09:10:00')).toBe(true);

    const state = await readPlaybackState(page);
    expect(state.isPaused).toBe(true);
    expect(state.currentTickIndex).toBeLessThanOrEqual(2);
  });

  test('playing across a candle boundary grows the chart (a new bar forms)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await beginReplay(page, { ticker: 'SPY', date: TARGET });

    const card = chartCard(page, 0);
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20_000 });
    const before = await readBarData(card);

    // Run fast for long enough to cross at least one 5-minute boundary
    // (09:10 -> past 09:15 needs >300s of market time; 100x * ~3.5s ≈ 350s).
    await setSpeed(page, '100');
    await pressPlay(page);
    await expect(async () => {
      const current = await readBarData(card);
      expect(current.barsCount).toBeGreaterThan(before.barsCount);
    }).toPass({ timeout: 15_000 });
    await pressPause(page);

    const after = await readBarData(card);
    // A fresh intraday candle formed, so the bar count grew.
    expect(after.barsCount).toBeGreaterThan(before.barsCount);
    // And the latest bar advanced past the 09:10 anchor.
    expect(utcToEtClock(after.lastBarTime!) >= utcToEtClock(before.lastBarTime!)).toBe(true);

    expect(pageErrors).toEqual([]);
  });
});
