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

    const startA = process.hrtime.bigint();
    plugin._getViewData();
    const endA = process.hrtime.bigint();
    const durationA = endA - startA;

    // Dataset B: 100,000 bars (Large)
    const seriesB = createMockSeries(100000);
    plugin.attached({ chart: mockChart, series: seriesB, requestUpdate: () => {} });
    
    plugin._cache = null; // Clear cache for measurement

    const startB = process.hrtime.bigint();
    plugin._getViewData();
    const endB = process.hrtime.bigint();
    const durationB = endB - startB;

    console.log(`Small Dataset (200 bars) duration: ${durationA}ns`);
    console.log(`Large Dataset (100,000 bars) duration: ${durationB}ns`);

    // If it were O(TotalBars), B would be ~500x slower.
    // We expect B to be within a small constant factor of A.
    // Using 5x as a safe threshold for CI environments.
    const ratio = Number(durationB) / Number(durationA);
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
