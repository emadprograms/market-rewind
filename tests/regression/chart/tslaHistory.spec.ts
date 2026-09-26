import { test, expect } from '@playwright/test';
import { startSession, chartCard, headerTicker } from '../e2e-utils';

test.describe('TSLA Historical Data Range Investigation', () => {
  test('inspect loaded candles for TSLA on 2026-09-08', async ({ page }) => {
    page.on('console', msg => {
      if (msg.text().includes('useChartData') || msg.text().includes('Loaded')) {
        console.log('BROWSER:', msg.text());
      }
    });

    await startSession(page, 'TSLA', '2026-09-08');

    const chartDetails = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.chart-card')).map((card, i) => {
        const title = card.querySelector('.chart-controls')?.textContent;
        const timeScaleElem = card.querySelector('.tv-lightweight-charts');
        return { index: i, title };
      });
      return { cards };
    });

    console.log('CHART DETAILS:', chartDetails);

    // Wait a moment for chart to render fully
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'chart_tsla_sep8.png' });

    // Inspect the actual data loaded in each chart
    const dataRanges = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.chart-card'));
      return cards.map((c, i) => {
        const barCount = Number(c.getAttribute('data-bars-count') || 0);
        const ticker = c.getAttribute('data-ticker');
        return { index: i, ticker, barCount };
      });
    });
    console.log('DATA RANGES:', dataRanges);

    // Chart 0 (5min) must have loaded significantly more than 5,000 bars (not capped to 5 days / Sept 1)
    expect(dataRanges[0].barCount).toBeGreaterThan(8000);
    // Chart 1 (1D) must contain full daily history
    expect(dataRanges[1].barCount).toBeGreaterThan(300);

    // Click 1m timeframe on Chart 0
    const tf1mBtn = page.locator('.chart-card').first().locator('button:has-text("1m")');
    await tf1mBtn.click();
    await page.waitForTimeout(1500);

    const rangeAfter1m = await page.evaluate(() => {
      const card = document.querySelector('.chart-card');
      return Number(card?.getAttribute('data-bars-count') || 0);
    });
    console.log('DATA RANGE AFTER 1m:', rangeAfter1m);

    // 1-minute chart must also load deep history (> 8,000 bars, extending well beyond 5 days / Sept 1)
    expect(rangeAfter1m).toBeGreaterThan(8000);

    await page.screenshot({ path: 'chart_tsla_1m.png' });
  });
});
