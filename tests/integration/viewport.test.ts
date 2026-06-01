import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
    vi.useFakeTimers();
    
    const chartRef = { current: null };
    const priceSeriesRef = { current: null };

    const { rerender } = renderHook(
      ({ chartData }) => useChartLifecycle({ 
        ...mockParams, 
        chartData, 
        chartRef, 
        priceSeriesRef 
      }),
      { initialProps: { chartData: [] } }
    );

    chartRef.current = mockChart;
    priceSeriesRef.current = mockSeries;

    expect(mockTimeScale.scrollToRealTime).not.toHaveBeenCalled();
    
    await act(async () => {
      rerender({ chartData: [{ time: '2023-01-01 00:00', open: 100, high: 110, low: 90, close: 105, volume: 1000 }] });
    });
    
    expect(mockTimeScale.scrollToRealTime).not.toHaveBeenCalled();
    
    await act(async () => {
      vi.advanceTimersByTime(16);
      await vi.runAllTimersAsync();
    });
    
    expect(mockTimeScale.scrollToRealTime).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
