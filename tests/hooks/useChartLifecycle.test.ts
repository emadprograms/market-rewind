import { renderHook } from '@testing-library/react';
import { useChartLifecycle } from '../../src/hooks/useChartLifecycle';
import { describe, it, expect, vi } from 'vitest';

describe('useChartLifecycle Hydration Lock', () => {
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

  it('should initialize with isHydrated = false', () => {
    // Note: isHydrated is currently internal state, we need to expose it or test its effect
    // For now, this test will fail because isHydrated doesn't exist in the return value
    const { result } = renderHook(() => useChartLifecycle(mockParams));
    expect(result.current.isHydrated).toBe(false);
  });

  it('should set isHydrated to false when ticker changes', async () => {
    const { result, rerender } = renderHook(({ ticker }) => useChartLifecycle({ ...mockParams, ticker }), {
      initialProps: { ticker: 'AAPL' },
    });

    expect(result.current.isHydrated).toBe(false);

    rerender({ ticker: 'MSFT' });
    expect(result.current.isHydrated).toBe(false);
  });
});
