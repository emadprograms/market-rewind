import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartViewport } from '../../src/hooks/chart/useChartViewport';

describe('useChartViewport Hook Tests', () => {
  let mockTimeScale: any;
  let mockPriceScale: any;
  let mockChart: any;
  let mockSeries: any;
  let chartRef: any;
  let priceSeriesRef: any;
  let pendingHistoryPrependRef: any;

  beforeEach(() => {
    mockTimeScale = {
      scrollToPosition: vi.fn(),
      scrollToRealTime: vi.fn(),
      getVisibleLogicalRange: vi.fn().mockReturnValue({ from: 90, to: 100 }),
      setVisibleLogicalRange: vi.fn(),
      options: vi.fn().mockReturnValue({ rightOffset: 20 }),
    };

    mockPriceScale = {
      applyOptions: vi.fn(),
    };

    mockChart = {
      timeScale: vi.fn().mockReturnValue(mockTimeScale),
      priceScale: vi.fn().mockReturnValue(mockPriceScale),
    };

    mockSeries = {
      data: vi.fn().mockReturnValue([]),
    };

    chartRef = { current: mockChart };
    priceSeriesRef = { current: mockSeries };
    pendingHistoryPrependRef = { current: null };
  });

  describe('scrollToRealTime', () => {
    it('calls scrollToPosition with options.rightOffset and no animation', () => {
      const { result } = renderHook(() =>
        useChartViewport({
          chartRef,
          priceSeriesRef,
          chartData: [{ time: 100 }],
          pendingHistoryPrependRef,
        })
      );

      act(() => {
        result.current.scrollToRealTime();
      });

      expect(mockTimeScale.scrollToPosition).toHaveBeenCalledWith(20, false);
      expect(mockTimeScale.scrollToRealTime).toHaveBeenCalled();
    });

    it('handles null chartRef gracefully without crashing', () => {
      chartRef.current = null;
      const { result } = renderHook(() =>
        useChartViewport({
          chartRef,
          priceSeriesRef,
          chartData: [],
          pendingHistoryPrependRef,
        })
      );

      expect(() => {
        act(() => {
          result.current.scrollToRealTime();
        });
      }).not.toThrow();
    });
  });

  describe('resetView', () => {
    it('snaps timeScale to right edge and enables autoScale on right priceScale', () => {
      const { result } = renderHook(() =>
        useChartViewport({
          chartRef,
          priceSeriesRef,
          chartData: [{ time: 100 }],
          pendingHistoryPrependRef,
        })
      );

      act(() => {
        result.current.resetView();
      });

      expect(mockTimeScale.scrollToPosition).toHaveBeenCalledWith(20, false);
      expect(mockChart.priceScale).toHaveBeenCalledWith('right');
      expect(mockPriceScale.applyOptions).toHaveBeenCalledWith({ autoScale: true });
    });
  });

  describe('syncViewport', () => {
    it('does nothing when chartData is empty', () => {
      const { result } = renderHook(() =>
        useChartViewport({
          chartRef,
          priceSeriesRef,
          chartData: [],
          pendingHistoryPrependRef,
        })
      );

      act(() => {
        result.current.syncViewport(false);
      });

      expect(mockTimeScale.scrollToPosition).not.toHaveBeenCalled();
      expect(mockTimeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    });

    it('snaps to right edge when isSameContext is false (switching chart)', () => {
      const { result } = renderHook(() =>
        useChartViewport({
          chartRef,
          priceSeriesRef,
          chartData: Array.from({ length: 50 }, (_, i) => ({ time: i })),
          pendingHistoryPrependRef,
        })
      );

      act(() => {
        result.current.syncViewport(false);
      });

      expect(mockTimeScale.scrollToPosition).toHaveBeenCalledWith(20, false);
    });

    it('advances logical range when user was at end and new bars arrive (wasAtEnd = true)', () => {
      // First sync with 50 bars, range is 40..50
      mockTimeScale.getVisibleLogicalRange.mockReturnValue({ from: 40, to: 50 });

      const chartDataInitial = Array.from({ length: 50 }, (_, i) => ({ time: i }));

      const { result, rerender } = renderHook(
        (props) => useChartViewport(props),
        {
          initialProps: {
            chartRef,
            priceSeriesRef,
            chartData: chartDataInitial,
            pendingHistoryPrependRef,
          },
        }
      );

      // Initial sync (lastDataCount becomes 50)
      act(() => {
        result.current.syncViewport(false);
      });

      // 5 new bars arrive (total 55)
      const chartDataUpdated = Array.from({ length: 55 }, (_, i) => ({ time: i }));
      rerender({
        chartRef,
        priceSeriesRef,
        chartData: chartDataUpdated,
        pendingHistoryPrependRef,
      });

      // User was at end (to: 50 >= 50 - 0.5)
      mockTimeScale.getVisibleLogicalRange.mockReturnValue({ from: 40, to: 50 });

      act(() => {
        result.current.syncViewport(true);
      });

      // Shift is 55 - 50 = 5 bars. Range should advance to 45..55
      expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({
        from: 45,
        to: 55,
      });
    });

    it('preserves exact logical range when user panned back in time (wasAtEnd = false)', () => {
      // Initial sync with 100 bars
      const chartDataInitial = Array.from({ length: 100 }, (_, i) => ({ time: i }));

      const { result, rerender } = renderHook(
        (props) => useChartViewport(props),
        {
          initialProps: {
            chartRef,
            priceSeriesRef,
            chartData: chartDataInitial,
            pendingHistoryPrependRef,
          },
        }
      );

      act(() => {
        result.current.syncViewport(false);
      });

      // User is looking at historical range (10..30), far behind 100
      mockTimeScale.getVisibleLogicalRange.mockReturnValue({ from: 10, to: 30 });

      // 5 new bars arrive (total 105)
      const chartDataUpdated = Array.from({ length: 105 }, (_, i) => ({ time: i }));
      rerender({
        chartRef,
        priceSeriesRef,
        chartData: chartDataUpdated,
        pendingHistoryPrependRef,
      });

      act(() => {
        result.current.syncViewport(true);
      });

      // Must NOT advance: preserves user historical view
      expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({
        from: 10,
        to: 30,
      });
    });

    it('correctly offsets logical range when history is prepended', () => {
      // User was viewing bars 0..20, with logical range 0..20
      pendingHistoryPrependRef.current = {
        oldFirstTime: 1000,
        oldLogicalRange: { from: 0, to: 20 },
      };

      // 30 historical bars prepended before time 1000
      const chartData = [
        ...Array.from({ length: 30 }, (_, i) => ({ time: 500 + i * 10 })),
        { time: 1000 }, // newFirstIndex = 30
        ...Array.from({ length: 20 }, (_, i) => ({ time: 1010 + i * 10 })),
      ];

      const { result } = renderHook(() =>
        useChartViewport({
          chartRef,
          priceSeriesRef,
          chartData,
          pendingHistoryPrependRef,
        })
      );

      act(() => {
        result.current.syncViewport(true);
      });

      // Range shifted by +30: from 0+30=30 to 20+30=50
      expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({
        from: 30,
        to: 50,
      });
      // Cleared prepend ref
      expect(pendingHistoryPrependRef.current).toBeNull();
    });

    it('handles matching date strings across ISO format differences', () => {
      pendingHistoryPrependRef.current = {
        oldFirstTime: '2024-01-01 09:30:00',
        oldLogicalRange: { from: 5, to: 25 },
      };

      const chartData = [
        { time: '2023-12-31 16:00:00' },
        { time: '2024-01-01T09:30:00Z' }, // Match! index = 1
        { time: '2024-01-01 09:31:00' },
      ];

      const { result } = renderHook(() =>
        useChartViewport({
          chartRef,
          priceSeriesRef,
          chartData,
          pendingHistoryPrependRef,
        })
      );

      act(() => {
        result.current.syncViewport(true);
      });

      expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({
        from: 6,
        to: 26,
      });
    });
  });
});
