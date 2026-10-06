import { test, expect } from '@playwright/test';
import { startSession, chartCard, collectPageErrors } from '../e2e-utils';

test.describe('Chart Shaking & Viewport Jitter E2E Regression', () => {
  test('playback streaming updates candles in-place without setData reloads or range jitter', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // 1. Initialize session with SPY on 2026-09-25 at 09:30 ET
    await startSession(page, 'AAPL', '2026-09-25', '09:30');

    const card0 = chartCard(page, 0);
    await expect(card0).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 20000 });

    // 2. Instrument chart in browser to monitor calls to setData, update, and logical range changes
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="chart-container"]') as any;
      if (!container || !container.__chart || !container.__priceSeries) return;

      const chart = container.__chart;
      const series = container.__priceSeries;

      (window as any).__debugLog = {
        setDataCalls: 0,
        updateCalls: 0,
        rangeHistory: [] as Array<{ from: number; to: number; timestamp: number }>,
      };

      const origSetData = series.setData.bind(series);
      series.setData = (...args: any[]) => {
        (window as any).__debugLog.setDataCalls++;
        return origSetData(...args);
      };

      const origUpdate = series.update.bind(series);

      series.update = (...args: any[]) => {
        (window as any).__debugLog.updateCalls++;
        return origUpdate(...args);
      };

      chart.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
        if (range) {
          (window as any).__debugLog.rangeHistory.push({
            from: range.from,
            to: range.to,
            timestamp: performance.now(),
          });
        }
      });
    });

    // Wait for initial session data (masterData and streaming ticks) to fully settle
    await page.waitForFunction(() => {
      const store = (window as any).usePlaybackStore;
      return store && store.getState().masterData && store.getState().masterData.length > 0 && !store.getState().isLoadingTicks;
    }, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      if ((window as any).__debugLog) {
        (window as any).__debugLog.setDataCalls = 0;
        (window as any).__debugLog.updateCalls = 0;
        (window as any).__debugLog.rangeHistory = [];
      }
    });


    // 3. Start playback
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await playBtn.click();
    await expect(page.getByRole('button', { name: /PAUSE/i })).toBeVisible();


    // 4. Let playback stream live ticks for 3 seconds
    await page.waitForTimeout(3000);

    // 5. Pause playback
    const pauseBtn = page.getByRole('button', { name: /PAUSE/i });
    await pauseBtn.click();
    await expect(page.getByRole('button', { name: /PLAY/i })).toBeVisible();

    // Small delay to capture any post-pause transition
    await page.waitForTimeout(500);

    // 6. Inspect recorded metrics
    const metrics = await page.evaluate(() => (window as any).__debugLog);

    expect(metrics).toBeDefined();
    // During active playback, updates must happen via update()
    expect(metrics.updateCalls).toBeGreaterThan(0);

    // CRITICAL: setData() reloads the entire chart and causes visible flashing/shaking.
    // Zero setData calls are allowed during active tick playback and pause transition!
    expect(metrics.setDataCalls).toBe(0);

    // Check logical range stability: range.to must not violently oscillate back and forth
    if (metrics.rangeHistory.length > 2) {
      let backAndForthOscillations = 0;
      for (let i = 2; i < metrics.rangeHistory.length; i++) {
        const prevDiff = metrics.rangeHistory[i - 1].to - metrics.rangeHistory[i - 2].to;
        const currDiff = metrics.rangeHistory[i].to - metrics.rangeHistory[i - 1].to;
        // Jitter: moving forward then immediately backwards by > 0.5 bars repeatedly
        if (prevDiff > 0.5 && currDiff < -0.5) {
          backAndForthOscillations++;
        }
      }
      expect(backAndForthOscillations).toBeLessThanOrEqual(1);
    }

    expect(pageErrors).toEqual([]);
  });

  test('jumping in timeline to 10:15 immediately preserves all previous elapsed candles without eating them', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // 1. Initialize session at 09:30
    await startSession(page, 'AAPL', '2026-09-25', '09:30');

    const card0 = chartCard(page, 0);
    // Allow initial 09:30 session state to settle
    await page.waitForTimeout(500);

    const initialBarsInfo = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="chart-container"]') as any;
      const series = container?.__priceSeries;
      const data = series ? series.data() : [];
      return {
        count: data.length,
        first: data[0],
        last: data[data.length - 1],
      };
    });
    expect(initialBarsInfo.count).toBeGreaterThan(0);

    // 2. Seek to 10:15:00 ET immediately via store action (simulating slider jump to 10:15 AM)
    // 2026-09-25 10:15:00 ET = 14:15:00 UTC
    const targetMs = new Date('2026-09-25T14:15:00Z').getTime();

    await page.evaluate((seekMs) => {
      const store = (window as any).usePlaybackStore;
      if (store) {
        store.getState().seekTickTime(seekMs);
      }
    }, targetMs);

    // Wait for the chart to settle
    await page.waitForTimeout(1000);

    // 3. Verify that previous candles have NOT been eaten
    // On a 5min chart, from 09:30 to 10:15 there should be 9 completed bars (9:30..10:10) + forming bar
    const chartBars = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="chart-container"]') as any;
      const series = container?.__priceSeries;
      return series ? series.data() : [];
    });

    // Bars count should reflect history + elapsed candles today (NOT a reset to 1 lone candle)
    expect(chartBars.length).toBeGreaterThanOrEqual(initialBarsInfo.count);
    // Verify that elapsed bars were actually added (from 09:30 to 10:15 = 9 bars)
    expect(chartBars.length - initialBarsInfo.count).toBeGreaterThanOrEqual(8);

    // Verify time display shows 10:15
    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toContainText('10:15');

    // 4. Verify that the chart is NOT displaying as if the market just opened at 10:15
    // The history is preserved, and the latest bar is at 10:15
    expect(chartBars[0].time).toBe(initialBarsInfo.first.time);
    expect(chartBars[chartBars.length - 1].time).toBeGreaterThan(initialBarsInfo.last.time);

    expect(pageErrors).toEqual([]);
  });

  test('rapid slider scrubbing back and forth maintains canvas stability and does not throw errors', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, 'AAPL', '2026-09-25', '09:30');

    const card0 = chartCard(page, 0);
    const canvas = card0.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const boxBefore = await canvas.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Rapidly seek between 09:35, 10:00, 10:15, 09:45, 10:30
    const testTimesUtc = [
      '2026-09-25T13:35:00Z',
      '2026-09-25T14:00:00Z',
      '2026-09-25T14:15:00Z',
      '2026-09-25T13:45:00Z',
      '2026-09-25T14:30:00Z',
    ];

    for (const timeStr of testTimesUtc) {
      const ms = new Date(timeStr).getTime();
      await page.evaluate((target) => {
        const store = (window as any).usePlaybackStore;
        if (store) {
          store.getState().seekTickTime(target);
        }
      }, ms);
      await page.waitForTimeout(200);
    }

    // After rapid scrubbing, canvas dimensions must remain stable
    const boxAfter = await canvas.boundingBox();
    expect(boxAfter).not.toBeNull();
    expect(Math.abs(boxAfter!.width - boxBefore!.width)).toBeLessThan(5);
    expect(Math.abs(boxAfter!.height - boxBefore!.height)).toBeLessThan(5);

    expect(pageErrors).toEqual([]);
  });

  test('seeking backward to earlier time preserves elapsed history and does not trigger errors or blank charts', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, 'AAPL', '2026-09-25', '09:30');

    const card0 = chartCard(page, 0);
    await page.waitForTimeout(500);

    // 1. Seek forward to 10:30 ET (14:30 UTC)
    const forwardMs = new Date('2026-09-25T14:30:00Z').getTime();
    await page.evaluate((target) => {
      const store = (window as any).usePlaybackStore;
      if (store) store.getState().seekTickTime(target);
    }, forwardMs);

    await page.waitForTimeout(600);

    const forwardBars = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="chart-container"]') as any;
      return container?.__priceSeries?.data() || [];
    });
    const stateInfo = await page.evaluate(() => {
      const store = (window as any).usePlaybackStore?.getState();
      return {
        currentTime: store?.currentTime,
        masterDataLen: store?.masterData?.length,
        latestTick: store?.latestTickBySymbol,
        isPaused: store?.isPaused,
      };
    });
    console.log('[Test 4 Diagnostic] stateInfo:', stateInfo);
    console.log('[Test 4 Diagnostic] card0 data-bars-count:', await card0.getAttribute('data-bars-count'));
    console.log('[Test 4 Diagnostic] forwardBars:', {
      count: forwardBars.length,
      first: forwardBars[0],
      last3: forwardBars.slice(-3),
    });



    // 2. Seek backward to 09:45 ET (13:45 UTC)
    const backwardMs = new Date('2026-09-25T13:45:00Z').getTime();
    await page.evaluate((target) => {
      const store = (window as any).usePlaybackStore;
      if (store) store.getState().seekTickTime(target);
    }, backwardMs);

    await page.waitForTimeout(600);

    const backwardBars = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="chart-container"]') as any;
      return container?.__priceSeries?.data() || [];
    });
    console.log('[Test 4 Diagnostic] backwardBars:', {
      count: backwardBars.length,
      first: backwardBars[0],
      last: backwardBars[backwardBars.length - 1],
    });

    // Chart must not be blank
    expect(backwardBars.length).toBeGreaterThan(0);

    // Verify today's elapsed bars specifically:
    // Today's trading starts at 13:30 UTC (09:30 EDT)
    const todayStartSec = Math.floor(new Date('2026-09-25T13:30:00Z').getTime() / 1000);
    const forwardTodayBars = forwardBars.filter((b: any) => (b.time as number) >= todayStartSec);
    const backwardTodayBars = backwardBars.filter((b: any) => (b.time as number) >= todayStartSec);

    // Backward seeking has fewer today bars (3-4 bars: 9:30..9:40/45) than forward (12-13 bars up to 10:30)
    expect(forwardTodayBars.length).toBeGreaterThanOrEqual(12);
    expect(backwardTodayBars.length).toBeGreaterThanOrEqual(3);
    expect(backwardTodayBars.length).toBeLessThan(forwardTodayBars.length);

    // Latest bar time matches or precedes the backward target (<= 13:45 UTC = 1790343900)
    const lastBar = backwardBars[backwardBars.length - 1];
    expect(lastBar.time).toBeLessThanOrEqual(Math.floor(backwardMs / 1000));

    expect(pageErrors).toEqual([]);
  });

  test('seeking forward to future time and pressing play resumes streaming and continues updating candles in-place', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, 'AAPL', '2026-09-25', '09:30');
    await page.waitForTimeout(500);

    // 1. Instrument chart price series update calls
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="chart-container"]') as any;
      if (!container || !container.__priceSeries) return;
      (window as any).__playbackUpdates = {
        updateCalls: 0,
        lastUpdatedTime: null as any,
      };
      const origUpdate = container.__priceSeries.update.bind(container.__priceSeries);
      container.__priceSeries.update = (bar: any) => {
        (window as any).__playbackUpdates.updateCalls++;
        (window as any).__playbackUpdates.lastUpdatedTime = bar.time;
        return origUpdate(bar);
      };
    });

    // 2. Seek forward to future time 14:50 ET (18:50 UTC) where ticks exist in bufferedTicks
    const forwardMs = new Date('2026-09-25T18:50:00Z').getTime();
    await page.evaluate((target) => {
      const store = (window as any).usePlaybackStore;
      if (store) store.getState().seekTickTime(target);
    }, forwardMs);

    await page.waitForTimeout(500);

    // Verify time display shows 14:50
    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toContainText('14:50');

    // Reset update counter before playing
    await page.evaluate(() => {
      if ((window as any).__playbackUpdates) {
        (window as any).__playbackUpdates.updateCalls = 0;
      }
    });

    // 3. Press PLAY
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await playBtn.click();
    await expect(page.getByRole('button', { name: /PAUSE/i })).toBeVisible();

    // 4. Let it stream for 3 seconds
    await page.waitForTimeout(3000);

    // 5. Inspect playback engine state and chart update counts
    const stats = await page.evaluate(() => {
      const store = (window as any).usePlaybackStore;
      return {
        updates: (window as any).__playbackUpdates?.updateCalls || 0,
        currentTime: store?.getState().currentTime,
        isPaused: store?.getState().isPaused,
        currentTickIndex: store?.getState().currentTickIndex,
      };
    });

    console.log('[Seek & Play Diagnostic]', stats);
    expect(stats.isPaused).toBe(false);
    expect(stats.currentTime).toBeGreaterThan(forwardMs);
    expect(stats.updates).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });

  test('seeking forward to 10:15 ET (historical bar period before raw ticks) and pressing play resumes playback and updates candles in-place', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, 'AAPL', '2026-09-25', '09:30');
    await page.waitForTimeout(500);

    // 1. Instrument chart price series update calls
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="chart-container"]') as any;
      if (!container || !container.__priceSeries) return;
      (window as any).__playbackUpdates = {
        updateCalls: 0,
        lastUpdatedTime: null as any,
      };
      const origUpdate = container.__priceSeries.update.bind(container.__priceSeries);
      container.__priceSeries.update = (bar: any) => {
        (window as any).__playbackUpdates.updateCalls++;
        (window as any).__playbackUpdates.lastUpdatedTime = bar.time;
        return origUpdate(bar);
      };
    });

    // 2. Seek forward to 10:15 ET (14:15 UTC) where data is in masterData before raw streaming ticks
    const forwardMs = new Date('2026-09-25T14:15:00Z').getTime();
    await page.evaluate((target) => {
      const store = (window as any).usePlaybackStore;
      if (store) store.getState().seekTickTime(target);
    }, forwardMs);

    await page.waitForTimeout(500);

    // Verify time display shows 10:15
    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toContainText('10:15');

    // Reset update counter before playing
    await page.evaluate(() => {
      if ((window as any).__playbackUpdates) {
        (window as any).__playbackUpdates.updateCalls = 0;
      }
    });

    // 3. Press PLAY
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await playBtn.click();
    await expect(page.getByRole('button', { name: /PAUSE/i })).toBeVisible();

    // 4. Let it stream/advance for 3 seconds
    await page.waitForTimeout(3000);

    // 5. Inspect playback engine state and chart update counts
    const stats = await page.evaluate(() => {
      const store = (window as any).usePlaybackStore;
      return {
        updates: (window as any).__playbackUpdates?.updateCalls || 0,
        currentTime: store?.getState().currentTime,
        isPaused: store?.getState().isPaused,
        currentTickIndex: store?.getState().currentTickIndex,
      };
    });

    console.log('[Seek 10:15 & Play Diagnostic]', stats);
    expect(stats.isPaused).toBe(false);
    expect(stats.currentTime).toBeGreaterThan(forwardMs);
    expect(stats.updates).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });

  test('seeking forward via playback slider UI to future time and pressing play resumes playback and updates candles in-place', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await startSession(page, 'AAPL', '2026-09-25', '09:30');
    await page.waitForTimeout(500);

    // 1. Instrument chart price series update calls
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="chart-container"]') as any;
      if (!container || !container.__priceSeries) return;
      (window as any).__playbackUpdates = {
        updateCalls: 0,
        lastUpdatedTime: null as any,
      };
      const origUpdate = container.__priceSeries.update.bind(container.__priceSeries);
      container.__priceSeries.update = (bar: any) => {
        (window as any).__playbackUpdates.updateCalls++;
        (window as any).__playbackUpdates.lastUpdatedTime = bar.time;
        return origUpdate(bar);
      };
    });

    // 2. Locate slider and move it forward to ~10:45 ET (14:45 UTC)
    const slider = page.locator('[data-testid="playback-time-slider"]');
    await expect(slider).toBeVisible();

    const minVal = Number(await slider.getAttribute('min'));
    const maxVal = Number(await slider.getAttribute('max'));
    expect(maxVal).toBeGreaterThan(minVal);

    // Move to 25% into the day (~11:00 AM ET)
    const targetVal = Math.floor(minVal + (maxVal - minVal) * 0.25);
    await slider.evaluate((el: HTMLInputElement, val) => {
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, targetVal);

    await page.waitForTimeout(500);

    // Reset update counter before playing
    await page.evaluate(() => {
      if ((window as any).__playbackUpdates) {
        (window as any).__playbackUpdates.updateCalls = 0;
      }
    });

    // 3. Click PLAY button
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await playBtn.click();
    await expect(page.getByRole('button', { name: /PAUSE/i })).toBeVisible();

    // 4. Let it play for 3 seconds
    await page.waitForTimeout(3000);

    // 5. Verify chart receives updates and time advances
    const stats = await page.evaluate(() => {
      const store = (window as any).usePlaybackStore;
      return {
        updates: (window as any).__playbackUpdates?.updateCalls || 0,
        currentTime: store?.getState().currentTime,
        isPaused: store?.getState().isPaused,
        currentTickIndex: store?.getState().currentTickIndex,
      };
    });

    console.log('[Slider Seek & Play Diagnostic]', stats);
    expect(stats.isPaused).toBe(false);
    expect(stats.currentTime).toBeGreaterThan(targetVal);
    expect(stats.updates).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });
});


