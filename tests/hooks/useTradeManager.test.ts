import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTradeManager } from '../../src/hooks/useTradeManager';
import type { ChartBar } from '../../src/types';

describe('useTradeManager', () => {
  const mockChartData: ChartBar[] = [
    { time: 1600000000, open: 100, high: 105, low: 95, close: 100, volume: 1000 },
  ];

  const mockRefs = {
    chartData: mockChartData,
    chartContainerRef: { current: document.createElement('div') } as any,
    priceSeriesRef: { current: null } as any,
    tradePluginRef: { current: { setTrade: vi.fn() } } as any,
  };

  it('should place an initial long order', () => {
    const { result } = renderHook(() => useTradeManager(mockRefs));
    
    act(() => {
      result.current.placeOrder('long');
    });

    expect(result.current.activeTrade).not.toBeNull();
    expect(result.current.activeTrade?.type).toBe('long');
    expect(result.current.activeTrade?.entryPrice).toBe(100);
    expect(result.current.activeTrade?.size).toBe(1);
  });

  it('should calculate cumulative entry price when adding to position', () => {
    const { result } = renderHook(() => useTradeManager(mockRefs));
    
    // First order at 100
    act(() => {
      result.current.placeOrder('long');
    });

    // Update price to 110 for the second order
    const updatedData: ChartBar[] = [
        { time: 1600000060, open: 100, high: 115, low: 95, close: 110, volume: 1000 },
    ];
    
    // We need to re-render or update the ref if the hook uses it
    // In our implementation, placeOrder uses chartData from props
    // Let's mock a second call with different data context if possible, 
    // or just rely on the fact that placeOrder closure captures tradeSize and chartData
    
    // For this test, we'll manually trigger the second order with "updated" chartData
    // Since chartData is passed as a prop to the hook, we need to update it.
    
    const { result: result2, rerender } = renderHook(
        (props) => useTradeManager(props),
        { initialProps: mockRefs }
    );

    act(() => {
        result2.current.placeOrder('long');
    });

    // Rerender with new price
    rerender({
        ...mockRefs,
        chartData: updatedData
    });

    act(() => {
        result2.current.placeOrder('long');
    });

    // Expected Entry: (100*1 + 110*1) / 2 = 105
    expect(result2.current.activeTrade?.entryPrice).toBe(105);
    expect(result2.current.activeTrade?.size).toBe(2);
  });

  it('should flip position when opposite order is larger than current size', () => {
    const { result, rerender } = renderHook(
        (props) => useTradeManager(props),
        { initialProps: { ...mockRefs, tradeSize: 1 } }
    );

    // Open Long 1
    act(() => {
      result.current.placeOrder('long');
    });

    // Set size to 5 and place Short
    act(() => {
        result.current.setTradeSize(5);
    });
    
    act(() => {
      result.current.placeOrder('short');
    });

    // Should be Short 4
    expect(result.current.activeTrade?.type).toBe('short');
    expect(result.current.activeTrade?.size).toBe(4);
  });

  it('should close position when opposite order matches size', () => {
    const { result } = renderHook(() => useTradeManager(mockRefs));

    act(() => {
      result.current.placeOrder('long');
    });

    act(() => {
      result.current.placeOrder('short');
    });

    expect(result.current.activeTrade).toBeNull();
  });
});
