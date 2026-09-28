import { renderHook } from '@testing-library/react';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockChart } from '../helpers/chart-simulation';

// Mock useChartInit to control chartRef
vi.mock('../../src/hooks/chart/useChartInit', () => ({
  useChartInit: vi.fn(() => ({
    chartRef: { current: mockChart },
    priceSeriesRef: { current: { setData: vi.fn(), applyOptions: vi.fn(), attachPrimitive: vi.fn() } },
    volumeSeriesRef: { current: { setData: vi.fn(), applyOptions: vi.fn(), attachPrimitive: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) } },
    lastBarSpacingRef: { current: null },
  })),
}));

// Mock useChartPlugins to prevent canvas/plugin crashes during testing
vi.mock('../../src/hooks/chart/useChartPlugins', () => ({
  useChartPlugins: vi.fn(() => ({
    shadingPluginRef: { current: null },
    vpPluginRef: { current: null },
    rayPluginRef: { current: null },
    rectPluginRef: { current: null },
    tradePluginRef: { current: null },
    updateShadingConfig: vi.fn(),
    pluginVersion: 0,
  })),
}));

describe('useChartLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    onFocus: vi.fn(),
  };

  it('should initialize with isHydrated = false', () => {
    const { result } = renderHook(() => useChartLifecycle(mockParams));
    expect(result.current.isHydrated).toBe(false);
  });

  it('should subscribe to chart clicks and call onFocus', () => {
    renderHook(() => useChartLifecycle(mockParams));
    
    expect(mockChart.subscribeClick).toHaveBeenCalled();
    
    // Simulate chart click by calling all registered handlers
    vi.mocked(mockChart.subscribeClick).mock.calls.forEach(call => {
      call[0]({} as any);
    });
    
    expect(mockParams.onFocus).toHaveBeenCalled();
  });

  it('should unsubscribe from chart clicks on unmount', () => {
    const { unmount } = renderHook(() => useChartLifecycle(mockParams));
    unmount();
    expect(mockChart.unsubscribeClick).toHaveBeenCalled();
  });

  it('should set isHydrated to false when ticker changes', async () => {
    const { result, rerender } = renderHook(({ ticker }) => useChartLifecycle({ ...mockParams, ticker }), {
      initialProps: { ticker: 'AAPL' },
    });

    expect(result.current.isHydrated).toBe(false);

    rerender({ ticker: 'MSFT' });
    expect(result.current.isHydrated).toBe(false);
  });

  it('DATA-03: should suppress rendering single bar while isLoadingHistory is true', async () => {
    const singleBarData: any = [
      { time: '2026-09-01 09:30:00', open: 150, high: 151, low: 149, close: 150.5, volume: 1000 }
    ];

    const { useChartInit } = await import('../../src/hooks/chart/useChartInit');
    const initMock = vi.mocked(useChartInit);
    const mockPriceSeries = { setData: vi.fn(), applyOptions: vi.fn(), attachPrimitive: vi.fn() };
    const mockVolumeSeries = { setData: vi.fn(), applyOptions: vi.fn(), attachPrimitive: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) };
    initMock.mockReturnValue({
      chartRef: { current: mockChart as any },
      priceSeriesRef: { current: mockPriceSeries as any },
      volumeSeriesRef: { current: mockVolumeSeries as any },
      lastBarSpacingRef: { current: null },
    });

    const { rerender } = renderHook(
      ({ isLoading }) =>
        useChartLifecycle({
          ...mockParams,
          chartData: singleBarData,
          localMasterData: singleBarData,
          isLoadingHistory: isLoading,
        }),
      { initialProps: { isLoading: true } }
    );

    // setData should NOT be called while isLoadingHistory is true
    expect(mockPriceSeries.setData).not.toHaveBeenCalled();

    // Rerender when loading completes
    rerender({ isLoading: false });

    // Now setData should be called with formatted data
    expect(mockPriceSeries.setData).toHaveBeenCalledTimes(1);
  });
});
