import { describe, it, expect, vi } from 'vitest';
import { SessionShadingPlugin } from '../../src/lib/SessionShading';

function createMockChart(visibleRange: { from: number; to: number } | null, width: number = 1000) {
  return {
    timeScale: () => ({
      getVisibleLogicalRange: () => visibleRange,
      width: () => width,
      options: () => ({ barSpacing: 6 }),
      timeToCoordinate: (t: number) => t,
    }),
    applyOptions: vi.fn(),
  } as any;
}

function createMockSeries(dataCount: number) {
  const data = Array.from({ length: dataCount }, (_, i) => ({
    time: 1700000000 + i * 60,
    open: 100, high: 101, low: 99, close: 100
  }));
  
  return {
    data: () => data,
  } as any;
}

describe('SessionShadingPlugin Cache Efficiency (Test 2)', () => {
  it('should prevent redundant calculations during stable viewports', () => {
    const plugin = new SessionShadingPlugin('1m', true);
    const series = createMockSeries(1000);
    const visibleRange = { from: 100, to: 200 };
    const mockChart = createMockChart(visibleRange);
    
    plugin.attached({ chart: mockChart, series, requestUpdate: () => {} });

    // 1. Cold Start
    const startCold = process.hrtime.bigint();
    const dataCold = plugin._getViewData();
    const endCold = process.hrtime.bigint();
    const durationCold = endCold - startCold;

    // 2. Warm Hit (Same range)
    const startWarm = process.hrtime.bigint();
    const dataWarm = plugin._getViewData();
    const endWarm = process.hrtime.bigint();
    const durationWarm = endWarm - startWarm;

    console.log(`Cold Start: ${durationCold}ns`);
    console.log(`Warm Hit: ${durationWarm}ns`);

    expect(dataWarm).toBe(dataCold); // Referential equality check
    expect(Number(durationWarm)).toBeLessThan(Number(durationCold) / 2);
  });

  it('should re-calculate on cache miss (range change)', () => {
    const plugin = new SessionShadingPlugin('1m', true);
    const series = createMockSeries(1000);
    const visibleRange1 = { from: 100, to: 200 };
    const mockChart1 = createMockChart(visibleRange1);
    
    plugin.attached({ chart: mockChart1, series, requestUpdate: () => {} });
    const data1 = plugin._getViewData();

    // Change range
    const visibleRange2 = { from: 105, to: 205 };
    const mockChart2 = createMockChart(visibleRange2);
    plugin.attached({ chart: mockChart2, series, requestUpdate: () => {} });
    
    const data2 = plugin._getViewData();

    expect(data2).not.toBe(data1); // Should be a new object
    expect(data2?.bars[0].time).not.toBe(data1?.bars[0].time);
  });

  it('should respect Intl.DateTimeFormat singleton (Allocation Stability)', () => {
    // Spy on Intl.DateTimeFormat
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    
    const plugin = new SessionShadingPlugin('1m', true);
    const series = createMockSeries(100);
    const mockChart = createMockChart({ from: 0, to: 50 });
    plugin.attached({ chart: mockChart, series, requestUpdate: () => {} });

    // Trigger calculations
    for (let i = 0; i < 100; i++) {
        plugin._cache = null; // Force recalculation but formatter should be stable
        plugin._getViewData();
    }

    // It might be called once during module load, but should NOT be called during the loop.
    // However, since the singleton is created at the top level of the file, 
    // it was already instantiated when the test started.
    // We check that it wasn't called AGAIN.
    expect(spy).toHaveBeenCalledTimes(0);
    
    spy.mockRestore();
  });
});
