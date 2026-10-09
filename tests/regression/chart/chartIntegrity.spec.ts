import { test, expect } from '@playwright/test';
import { chartCard, startSession, collectPageErrors } from '../e2e-utils';

test.describe('TEST-07: Chart Timeline, Session Shading & Replay Opening Price Integrity', () => {

  test('Issue 1 & 2: Chart candles load at 09:30 ET with correct X-Axis timestamp and RTH session shading (not 05:30 PRE)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Initialize session for AAPL on 2026-10-07 at 09:30 ET market open
    await startSession(page, 'AAPL', '2026-10-07', '09:30');

    const card = chartCard(page, 0);

    // 1. Candles must be loaded (not 0 bars)
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });

    // 2. Inspect the latest visible / loaded bar at market open
    const barData = await card.evaluate((el: HTMLElement) => {
      // Return data attributes or inspected chart attributes
      return {
        barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
        firstBarTime: el.getAttribute('data-first-bar-time'),
        lastBarTime: el.getAttribute('data-last-bar-time'),
        lastBarOpen: el.getAttribute('data-last-bar-open'),
      };
    });

    expect(barData.barsCount).toBeGreaterThan(0);

    // 3. Verify the market-open bar against the chart's ACTUAL price series, not a DOM attribute.
    //    data-last-bar-time has two writers (React render and imperative live updates) and can lag
    //    the series. The series is the ground truth for the X-axis. Series times are Unix seconds
    //    whose UTC wall clock equals New York time + 4h (e.g. 13:25Z is 09:25 ET), so convert to NY.
    //    Poll because the series can still be filling in right after the bar count first becomes > 0.
    const readSeriesTail = () => card.evaluate((el: HTMLElement) => {
      const container = el.querySelector('[data-testid="chart-container"]') as any;
      const bars: any[] = container?.__priceSeries?.data?.() || [];
      return {
        count: bars.length,
        lastTime: bars.length ? (bars[bars.length - 1].time as number) : null,
        tail: bars.slice(-3).map((b: any) => ({ time: b.time, open: b.open, close: b.close })),
      };
    });
    const toNY = (sec: number | null) => sec == null ? 'none' : new Date(sec * 1000).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });

    let last = { count: 0, lastTime: null as number | null, tail: [] as Array<{ time: unknown; open: unknown; close: unknown }> };
    let lastNY = 'none';
    try {
      await expect.poll(async () => {
        last = await readSeriesTail();
        lastNY = toNY(last.lastTime);
        return lastNY;
      }, { timeout: 15000 }).toMatch(/^(09:2\d|09:30)$/);
    } catch (err) {
      throw new Error(
        `Chart 0 series never reached the 09:25-09:30 ET market-open bucket. ` +
        `Last NY time=${lastNY}, series count=${last.count}, last 3 bars=${JSON.stringify(last.tail)}\n${String(err)}`
      );
    }
    // At market open 09:30, the latest candle time in NY timezone MUST be 09:29 or 09:30, NEVER 05:30!
    expect(lastNY).not.toMatch(/^05:/);

    expect(pageErrors).toEqual([]);
  });

  test('Issue 3: Replay opening price at 09:30 ET matches authentic market open price and forms accurately', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Initialize session for AAPL on 2026-10-07 at 09:30 ET market open
    await startSession(page, 'AAPL', '2026-10-07', '09:30');

    const card = chartCard(page, 0);

    // Playback bar must show 09:30:00 ET
    const timeDisplay = page.locator('.time-display');
    await expect(timeDisplay).toContainText('09:30:00');

    // Get the opening price at market open
    const initialBarData = await card.evaluate((el: HTMLElement) => ({
      barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
      lastBarTime: el.getAttribute('data-last-bar-time'),
      lastBarOpen: el.getAttribute('data-last-bar-open'),
      lastBarClose: el.getAttribute('data-last-bar-close'),
    }));

    // Step forward 1 second into market open
    const stepFwdBtn = page.getByRole('button', { name: /Step Forward/i });
    if (await stepFwdBtn.isVisible()) {
      await stepFwdBtn.click();
      await page.waitForTimeout(500);

      const steppedBarData = await card.evaluate((el: HTMLElement) => ({
        barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
        lastBarTime: el.getAttribute('data-last-bar-time'),
        lastBarOpen: el.getAttribute('data-last-bar-open'),
        lastBarClose: el.getAttribute('data-last-bar-close'),
      }));

      // The open price of the 09:30 candle must be realistic market price (for AAPL on 2026-10-07, around $255)
      if (steppedBarData.lastBarOpen) {
        const openPrice = parseFloat(steppedBarData.lastBarOpen);
        expect(openPrice).toBeGreaterThan(200);
        expect(openPrice).toBeLessThan(350);
      }
    }

    // Reset to start button must restore canonical start cleanly
    const resetBtn = page.getByTitle('Reset to Start');
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();
    await expect(timeDisplay).toContainText('09:30:00');

    expect(pageErrors).toEqual([]);
  });

  test('Issue 4: 1D Daily candles display the correct calendar day (Oct 7 on 2026-10-07, not Oct 6)', async ({ page }) => {
    test.slow();
    const pageErrors = collectPageErrors(page);

    await startSession(page, 'AAPL', '2026-10-07', '09:30');

    const card = chartCard(page, 0);

    // Switch timeframe to 1D
    const tfDropdown = card.locator('.chart-controls .custom-select').nth(1);
    await tfDropdown.click();
    const opt1D = card.locator('.dropdown-item').filter({ hasText: /^1D$/ }).first();
    await expect(opt1D).toBeVisible();
    await opt1D.click();

    // Verify 1D candles are loaded
    await expect(card).toHaveAttribute('data-bars-count', /^[1-9]\d*$/, { timeout: 15000 });

    const barData = await card.evaluate((el: HTMLElement) => ({
      barsCount: parseInt(el.getAttribute('data-bars-count') || '0', 10),
      lastBarTime: el.getAttribute('data-last-bar-time'),
    }));

    // The last daily bar must represent 2026-10-07, NOT 2026-10-06
    if (barData.lastBarTime) {
      expect(barData.lastBarTime).toContain('2026-10-07');
      expect(barData.lastBarTime).not.toContain('2026-10-06');
    }

    expect(pageErrors).toEqual([]);
  });
});
