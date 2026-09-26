import { test, expect } from '@playwright/test';
import { startSession } from '../e2e-utils';

test.describe('Time and Sales Tick Count & Tape Density', () => {
  test('compares database tick density against Time and Sales tape display for TSLA on 2026-09-08', async ({ page }) => {
    // Start session on TSLA for 2026-09-08 at 09:30 market open
    await startSession(page, 'TSLA', '2026-09-08', '09:30');

    // Open Time & Sales drawer
    const tapeBtn = page.locator('button:has-text("TAPE")');
    await expect(tapeBtn).toBeVisible();
    await tapeBtn.click();

    // Verify Time & Sales panel is open
    const tapePanel = page.locator('.time-and-sales-panel');
    await expect(tapePanel).toBeVisible();

    // Inspect the store's buffered ticks and current index directly from window
    const storeState = await page.evaluate(() => {
      // Access Zustand store from window or component state
      const el = document.querySelector('.time-and-sales-panel');
      const footer = el?.querySelector('div[style*="justify-content: space-between"]')?.textContent;
      return { footer };
    });
    console.log('Time & Sales Footer:', storeState.footer);

    // Get all rendered tick rows
    const rows = page.locator('.tick-row');
    const totalRendered = await rows.count();
    console.log('Total .tick-row elements rendered in DOM:', totalRendered);

    // Collect all rendered tick timestamps and prices
    const renderedTicks = await page.evaluate(() => {
      const rowElements = Array.from(document.querySelectorAll('.tick-row'));
      return rowElements.map((el, i) => {
        const text = el.textContent || '';
        const timeEl = el.querySelector('div:first-child')?.textContent || '';
        const priceEl = el.querySelector('div:nth-child(2)')?.textContent || '';
        const sizeEl = el.querySelector('div:nth-child(3)')?.textContent || '';
        const isActive = el.classList.contains('is-active');
        return { index: i, time: timeEl, price: priceEl, size: sizeEl, isActive, text };
      });
    });

    console.log('Rendered Ticks Count:', renderedTicks.length);

    // Group by time string (e.g. 13:30:00 vs 09:30:00)
    const countsBySecond: Record<string, number> = {};
    for (const t of renderedTicks) {
      countsBySecond[t.time] = (countsBySecond[t.time] || 0) + 1;
    }
    console.log('Rendered ticks by second in Time & Sales:', countsBySecond);

    // Log the active tick
    const activeTick = renderedTicks.find(t => t.isActive);
    console.log('Active Tick in Tape:', activeTick);

    // Check buffered ticks in the playback store
    const playbackInfo = await page.evaluate(() => {
      const store = (window as any).__playbackStore;
      if (store) {
        const state = store.getState();
        const ticks = state.bufferedTicks || [];
        const sec0 = ticks.filter((t: any) => t.time.includes('13:30:00'));
        const sec1 = ticks.filter((t: any) => t.time.includes('13:30:01'));
        const sec2 = ticks.filter((t: any) => t.time.includes('13:30:02'));
        return {
          totalBuffered: ticks.length,
          currentIndex: state.currentTickIndex,
          currentTime: state.currentTime,
          sec0Count: sec0.length,
          sec1Count: sec1.length,
          sec2Count: sec2.length,
        };
      }
      return null;
    });
    console.log('Playback Store Info:', playbackInfo);

    // Start playback for 1.5 seconds at 1x to observe tick progression
    const playBtn = page.getByRole('button', { name: /PLAY/i });
    await playBtn.click();
    await page.waitForTimeout(1500);

    const pauseBtn = page.getByRole('button', { name: /PAUSE/i });
    await pauseBtn.click();

    // Check active tick after 1.5 seconds of playback
    const afterTicks = await page.evaluate(() => {
      const rowElements = Array.from(document.querySelectorAll('.tick-row'));
      const activeEl = document.querySelector('.tick-row.is-active');
      return {
        totalRendered: rowElements.length,
        activeText: activeEl?.textContent || null,
        footerText: document.querySelector('.time-and-sales-panel')?.textContent?.slice(-40) || null,
      };
    });
    console.log('After 1.5s Playback:', afterTicks);
  });
});
