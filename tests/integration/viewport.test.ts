import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';

// Mock lightweight-charts
const mockTimeScale = {
  scrollToRealTime: vi.fn(),
  getVisibleLogicalRange: vi.fn().mockReturnValue({ from: 0, to: 100 }),
  setVisibleLogicalRange: vi.fn(),
  subscribeVisibleLogicalRangeChange: vi.fn(),
  options: vi.fn().mockReturnValue({ barSpacing: 1 }),
  width: vi.fn().mockReturnValue(1000),
};

const mockSeries = {
  setData: vi.fn(),
  data: vi.fn().mockReturnValue([]),
  createPriceLine: vi.fn(),
  removePriceLine: vi.fn(),
  attachPrimitive: vi.fn(),
  priceScale: vi.fn().mockReturnValue({
    applyOptions: vi.fn(),
  }),
};

const mockChart = {
  timeScale: () => mockTimeScale,
  addCandlestickSeries: () => mockSeries,
  addHistogramSeries: () => mockSeries,
  applyOptions: vi.fn(),
  priceScale: vi.fn().mockReturnValue({
    applyOptions: vi.fn(),
  }),
  subscribeClick: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  subscribeDblClick: vi.fn(),
  remove: vi.fn(),
};

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => mockChart),
}));

describe('Viewport Stability Integration', () => {
  const mockParams = {
    chartContainerRef: { current: document.createElement('div') },
    ticker: 'AAPL',
    timeframe: '1h' as any,
    showEth: false,
    showVP: false,
    chartData: [],
    localMasterData: [],
    isReplayMode: false,
    isLoadingHistory: false,
    pendingHistoryPrependRef: { current: null },
    isDrawingMode: false,
    drawType: 'ray' as any,
    rectAnchor: null,
    setRectAnchor: vi.fn(),
    ghostPoint: null,
    setGhostPoint: vi.fn(),
    drawings: {},
    onUpdateDrawings: vi.fn(),
    activeTrade: null,
    tradeBadgeRef: { current: null },
    chartRef: { current: null },
    priceSeriesRef: { current: null },
  };

  it('should NOT call scrollToRealTime before data is processed (Race Condition Test)', async () => {
    const { rerender } = renderHook(
      ({ chartData }) => {
        // Simulate the hook logic
        const { chartRef } = useChartLifecycle({ ...mockParams, chartData });
        return { chartRef };
      }, 
      { initialProps: { chartData: [] } }
    );

    // Simulate symbol change (which triggers the race condition in the current implementation)
    // In the current implementation, there's a setTimeout(..., 80)
    // We expect that if we just changed symbols, it shouldn't have scrolled yet.
    
    expect(mockTimeScale.scrollToRealTime).not.toHaveBeenCalled();
    
    // Now provide data
    rerender({ chartData: [{ time: '2023-01-01 00:00', open: 100, high: 110, low: 90, close: 105, volume: 1000 }] });
    
    // It should still NOT have called it instantly (because of the 80ms timer)
    // but the test should prove that the timer is non-deterministic.
    // We want to prove that WITHOUT a lock, it might fire too early or late.
    
    // Actually, for Task 1, we just need to prove the race condition exists.
    // The current implementation uses setTimeout(..., 80).
    // If we use vi.useFakeTimers(), we can prove it's waiting for a magic number.
    
    vi.useFakeTimers();
    // ... simulate symbol change and data load ...
    vi.advanceTimersByTime(79);
    expect(mockTimeScale.scrollToRealTime).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mockTimeScale.scrollToRealTime).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
