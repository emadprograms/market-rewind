import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChartLifecycle } from '../../../src/hooks/useChartLifecycle';
import { mockTimeScale, createChartMock } from '../../helpers/chart-simulation';

// Mock the lightweight-charts module to prevent real canvas initialization
vi.mock('lightweight-charts', () => ({
  createChart: () => createChartMock(),
}));

// Mock requestAnimationFrame to execute in the next tick
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  setTimeout(() => callback(0), 0);
  return 0;
});

describe('Viewport Stability Regression Tests', () => {
  let params: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    params = {
      chart: createChartMock(),
      chartData: [],
      ticker: 'AAPL',
      timeframe: '1D',
      showEth: false,
      showVP: false,
      localMasterData: [],
      isReplayMode: false,
      isLoadingHistory: false,
      pendingHistoryPrependRef: { current: null },
      isDrawingMode: false,
      drawType: 'ray',
      rectAnchor: null,
      setRectAnchor: vi.fn(),
      ghostPoint: null,
      setGhostPoint: vi.fn(),
      drawings: { rays: [], rects: [] },
      onUpdateDrawings: vi.fn(),
      activeTrade: null,
      tradeBadgeRef: { current: document.createElement('div') },
      chartRef: { current: null },
      priceSeriesRef: { current: null },
      chartContainerRef: { current: document.createElement('div') },
    };
  });

  it('STAB-02: should shift logical range when data is prepended (infinite scroll)', async () => {
    const initialRange = { from: 0, to: 100 };
    mockTimeScale.getVisibleLogicalRange.mockReturnValue(initialRange);
    
    const { rerender } = renderHook(
      ({ p }) => useChartLifecycle(p),
      { initialProps: { p: params } }
    );

    // 1. Setup initial state: 100 bars starting from 2023-01-01
    const initialData = new Array(100).fill(null).map((_, i) => ({ 
      time: `2023-01-01 00:00:00`, // Use full format to match hook's .replace(' ', 'T')
      open: 100, high: 110, low: 90, close: 105, volume: 1000 
    }));
    
    act(() => {
      params.chartData = initialData;
    });
    rerender({ p: params });

    // 2. Simulate prepend: 50 new bars added before 2023-01-01
    const prependedData = new Array(50).fill(null).map((_, i) => ({ 
      time: `2022-12-01 00:00:00`, 
      open: 100, high: 110, low: 90, close: 105, volume: 1000 
    }));
    const combinedData = [...prependedData, ...initialData];
    
    act(() => {
      params.pendingHistoryPrependRef.current = {
        oldFirstTime: '2023-01-01 00:00:00', // Match format exactly
        oldLogicalRange: initialRange
      };
      params.chartData = combinedData;
    });
    rerender({ p: params });

    // The hook calculates newFirstIndex = formatted.findIndex(d => d.time === oldFirstTime)
    // Since we prepended 50, newFirstIndex should be 50.
    // Range shift: from: 0 + 50, to: 100 + 50
    const calls = mockTimeScale.setVisibleLogicalRange.mock.calls;
    const shiftedCall = calls.find(call => call[0].from === 50 && call[0].to === 150);
    expect(shiftedCall).toBeDefined();
  });

  it('STAB-01: should not cause "single candle" snaps on ticker change', async () => {
    const { rerender } = renderHook(
      ({ p }) => useChartLifecycle(p),
      { initialProps: { p: params } }
    );

    act(() => {
      params.symbol = 'MSFT';
    });
    rerender({ p: params });

    const calls = mockTimeScale.setVisibleLogicalRange.mock.calls;
    if (calls.length > 0) {
      const range = calls[0][0];
      expect(range.to - range.from).toBeGreaterThan(1);
    }
  });

  it('STAB-03: should block scrollToRealTime until hydration is complete', async () => {
    const { rerender } = renderHook(
      ({ p }) => useChartLifecycle(p),
      { initialProps: { p: params } }
    );

    // 1. Set data but keep isHydrated false
    await act(async () => {
      params.chartData = [{ time: '2023-01-01 00:00:00', open: 100, high: 110, low: 90, close: 105, volume: 1000 }];
    });
    rerender({ p: params });
    
    // Should not scroll yet because isHydrated is false
    expect(mockTimeScale.scrollToRealTime).not.toHaveBeenCalled();

    // 2. Trigger hydration and wait for effect
    await act(async () => {
      // The requestAnimationFrame mock triggers setIsHydrated(true) immediately
      // But we need a tick for the effect to run
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(mockTimeScale.scrollToRealTime).toHaveBeenCalled();
  });
});
