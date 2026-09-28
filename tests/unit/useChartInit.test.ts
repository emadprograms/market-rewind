import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartInit } from '../../src/hooks/chart/useChartInit';
import { createChart } from 'lightweight-charts';

vi.mock('lightweight-charts', () => {
  return {
    createChart: vi.fn(),
  };
});

describe('useChartInit Hook Tests', () => {
  let mockTimeScale: any;
  let mockPriceScale: any;
  let mockCandlestickSeries: any;
  let mockHistogramSeries: any;
  let mockChart: any;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTimeScale = {
      subscribeVisibleLogicalRangeChange: vi.fn(),
      getVisibleLogicalRange: vi.fn().mockReturnValue({ from: 90, to: 100 }),
      options: vi.fn().mockReturnValue({ barSpacing: 6 }),
    };

    mockPriceScale = {
      applyOptions: vi.fn(),
      options: vi.fn().mockReturnValue({ autoScale: true }),
    };

    mockCandlestickSeries = {
      applyOptions: vi.fn(),
      data: vi.fn().mockReturnValue(Array.from({ length: 100 }, (_, i) => ({ time: i }))),
    };

    mockHistogramSeries = {
      priceScale: vi.fn().mockReturnValue(mockPriceScale),
    };

    mockChart = {
      timeScale: vi.fn().mockReturnValue(mockTimeScale),
      priceScale: vi.fn().mockReturnValue(mockPriceScale),
      addCandlestickSeries: vi.fn().mockReturnValue(mockCandlestickSeries),
      addHistogramSeries: vi.fn().mockReturnValue(mockHistogramSeries),
      applyOptions: vi.fn(),
      remove: vi.fn(),
    };

    (createChart as any).mockReturnValue(mockChart);

    container = document.createElement('div');
  });

  it('initializes lightweight-charts with container and default layout options', () => {
    const onViewStateChange = vi.fn();
    const { result } = renderHook(() =>
      useChartInit({
        chartContainerRef: { current: container },
        ticker: 'AAPL',
        timeframe: '1H' as const,
        onViewStateChange,
      })
    );

    expect(createChart).toHaveBeenCalledWith(container, expect.objectContaining({
      layout: expect.objectContaining({
        background: { color: 'transparent' },
        textColor: '#94a3b8',
      }),
      crosshair: { mode: 0 },
    }));

    expect(mockChart.addCandlestickSeries).toHaveBeenCalled();
    expect(mockChart.addHistogramSeries).toHaveBeenCalled();
    expect(result.current.chartRef.current).toBe(mockChart);
    expect(result.current.priceSeriesRef.current).toBe(mockCandlestickSeries);
    expect(result.current.volumeSeriesRef.current).toBe(mockHistogramSeries);
  });

  it('does NOT re-create chart or destroy canvas when ticker or timeframe changes', () => {
    const chartContainerRef = { current: container };
    const { rerender } = renderHook(
      (props) => useChartInit(props),
      {
        initialProps: {
          chartContainerRef,
          ticker: 'AAPL',
          timeframe: '1H' as const,
          onViewStateChange: vi.fn(),
        },
      }
    );

    expect(createChart).toHaveBeenCalledTimes(1);

    // Switch ticker and timeframe
    rerender({
      chartContainerRef,
      ticker: 'TSLA',
      timeframe: '5min' as const,
      onViewStateChange: vi.fn(),
    });

    // createChart and remove must NOT be called again
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(mockChart.remove).not.toHaveBeenCalled();
  });

  it('notifies view state change when timeScale range changes', () => {
    let rangeCallback: () => void = () => {};
    mockTimeScale.subscribeVisibleLogicalRangeChange.mockImplementation((cb: () => void) => {
      rangeCallback = cb;
    });

    const onViewStateChange = vi.fn();
    renderHook(() =>
      useChartInit({
        chartContainerRef: { current: container },
        ticker: 'AAPL',
        timeframe: '1H' as const,
        onViewStateChange,
      })
    );

    // 100 bars, visible range 90..100 -> logicalRange.to (100) >= lastBarIndex(99) - 0.5 -> atEnd = true
    act(() => {
      rangeCallback();
    });

    expect(onViewStateChange).toHaveBeenCalledWith(true, true);
  });

  it('calls chart.remove() on unmount', () => {
    const { unmount } = renderHook(() =>
      useChartInit({
        chartContainerRef: { current: container },
        ticker: 'AAPL',
        timeframe: '1H' as const,
        onViewStateChange: vi.fn(),
      })
    );

    unmount();

    expect(mockChart.remove).toHaveBeenCalledTimes(1);
  });
});
