import { describe, it, expect, vi } from 'vitest';
import { SessionShadingPlugin } from '../../src/lib/SessionShading';

/**
 * Mocking Lightweight Charts structures needed for SessionShadingPlugin
 */
function createMockChart(visibleRange: { from: number; to: number } | null, width: number = 1000) {
  return {
    timeScale: () => ({
      getVisibleLogicalRange: () => visibleRange,
      width: () => width,
      options: () => ({ barSpacing: 6 }),
      timeToCoordinate: (t: number) => t, // Simple 1:1 for testing
    }),
    applyOptions: vi.fn(),
  } as any;
}

function createMockSeries(dataCount: number) {
  const data = Array.from({ length: dataCount }, (_, i) => ({
    time: 1700000000 + i * 60, // Incrementing timestamps
    open: 100, high: 101, low: 99, close: 100
  }));
  
  return {
    data: () => data,
  } as any;
}

describe('SessionShadingPlugin Slicing Complexity (Test 1)', () => {
  it('should have O(VisibleBars) complexity, not O(TotalBars)', () => {
    const plugin = new SessionShadingPlugin('1m', true);
    
    // Setup Visible Range: 100 bars
    const visibleRange = { from: 50, to: 150 };
    const mockChart = createMockChart(visibleRange);

    // Dataset A: 200 bars (Small)
    const seriesA = createMockSeries(200);
    plugin.attached({ chart: mockChart, series: seriesA, requestUpdate: () => {} });
    
    // Warm up
    plugin._getViewData();
    plugin._cache = null; // Clear cache for measurement

    // Take minimum of 3 runs to avoid GC jitter
    let minA = Infinity;
    for (let i = 0; i < 3; i++) {
      plugin._cache = null;
      const s = process.hrtime.bigint();
      plugin._getViewData();
      const e = process.hrtime.bigint();
      const d = Number(e - s);
      if (d < minA) minA = d;
    }

    // Dataset B: 100,000 bars (Large)
    const seriesB = createMockSeries(100000);
    plugin.attached({ chart: mockChart, series: seriesB, requestUpdate: () => {} });

    let minB = Infinity;
    for (let i = 0; i < 3; i++) {
      plugin._cache = null;
      const s = process.hrtime.bigint();
      plugin._getViewData();
      const e = process.hrtime.bigint();
      const d = Number(e - s);
      if (d < minB) minB = d;
    }

    console.log(`Small Dataset (200 bars) min duration: ${minA}ns`);
    console.log(`Large Dataset (100,000 bars) min duration: ${minB}ns`);

    // If it were O(TotalBars), B would be ~500x slower.
    const ratio = minB / Math.max(1, minA);
    console.log(`Performance Ratio: ${ratio.toFixed(2)}x`);
    
    expect(ratio).toBeLessThan(10); 
  });

  it('should handle boundary conditions (range completely outside data)', () => {
    const plugin = new SessionShadingPlugin('1m', true);
    const series = createMockSeries(1000);
    
    // Scenario: Range before data
    const chartBefore = createMockChart({ from: -500, to: -400 });
    plugin.attached({ chart: chartBefore, series, requestUpdate: () => {} });
    plugin._cache = null;
    const dataBefore = plugin._getViewData();
    expect(dataBefore?.bars.length).toBe(0);

    // Scenario: Range after data
    const chartAfter = createMockChart({ from: 1500, to: 1600 });
    plugin.attached({ chart: chartAfter, series, requestUpdate: () => {} });
    plugin._cache = null;
    const dataAfter = plugin._getViewData();
    expect(dataAfter?.bars.length).toBe(0);
  });
});
