import { useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi, LogicalRange } from 'lightweight-charts';
import type { HistoryPrependState } from '../../types';

interface UseChartViewportParams {
  chartRef: React.MutableRefObject<IChartApi | null>;
  priceSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  chartData: any[];
  pendingHistoryPrependRef: React.MutableRefObject<HistoryPrependState | null>;
}

export function useChartViewport({
  chartRef,
  priceSeriesRef,
  chartData,
  pendingHistoryPrependRef,
}: UseChartViewportParams) {
  const lastDataCountRef = useRef(0);
  const AUTO_REVEAL_THRESHOLD = 10;

  const scrollToRealTime = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().scrollToRealTime();
    }
  }, [chartRef]);

  const syncViewport = useCallback((isSameContext: boolean, capturedRange?: LogicalRange | null) => {
    if (!chartRef.current || !priceSeriesRef.current || chartData.length === 0) return;

    const ts = chartRef.current.timeScale();
    const oldLogicalRange = capturedRange || ts.getVisibleLogicalRange();

    if (isSameContext && oldLogicalRange) {
      const wasAtEnd = oldLogicalRange.to >= lastDataCountRef.current - 0.5;

      if (pendingHistoryPrependRef.current) {
        // Priority 1: Prepend History
        const { oldFirstTime, oldLogicalRange: prependRange } = pendingHistoryPrependRef.current;
        
        if (oldFirstTime === null) {
          pendingHistoryPrependRef.current = null;
          ts.setVisibleLogicalRange(oldLogicalRange);
          return;
        }

        const newFirstIndex = chartData.findIndex(d => d.time === oldFirstTime);
        
        if (newFirstIndex > 0 && prependRange) {
            ts.setVisibleLogicalRange({
                from: prependRange.from + newFirstIndex,
                to: prependRange.to + newFirstIndex
            });
        } else {
            ts.setVisibleLogicalRange(oldLogicalRange);
        }
        pendingHistoryPrependRef.current = null;
      } else if (wasAtEnd) {
        // Priority 2: Manual Shift (End-of-chart)
        const shift = chartData.length - lastDataCountRef.current;
        if (shift > 0) {
          ts.setVisibleLogicalRange({
            from: oldLogicalRange.from + shift,
            to: oldLogicalRange.to + shift
          });
        } else {
          ts.setVisibleLogicalRange(oldLogicalRange);
        }
      } else {
        ts.setVisibleLogicalRange(oldLogicalRange);
      }
    } else if (pendingHistoryPrependRef.current) {
        // Handle prepend even if context changed
        const { oldFirstTime, oldLogicalRange: prependRange } = pendingHistoryPrependRef.current;
        const newFirstIndex = chartData.findIndex(d => d.time === oldFirstTime);
        
        if (newFirstIndex > 0 && prependRange) {
            ts.setVisibleLogicalRange({
                from: prependRange.from + newFirstIndex,
                to: prependRange.to + newFirstIndex
            });
        }
        pendingHistoryPrependRef.current = null;
    }

    lastDataCountRef.current = chartData.length;
  }, [chartRef, priceSeriesRef, chartData, pendingHistoryPrependRef]);

  const checkAutoReveal = useCallback(() => {
    if (!chartRef.current || !priceSeriesRef.current) return;

    const ts = chartRef.current.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;

    const data = priceSeriesRef.current.data();
    const dataEnd = data.length - 1;
    
    if (range.to >= dataEnd - AUTO_REVEAL_THRESHOLD) {
      console.log(`[StabilityTrace] Auto-Reveal TRIGGERED: range.to=${range.to.toFixed(2)}, dataEnd=${dataEnd}`);
      scrollToRealTime();
    } else {
      // console.log(`[StabilityTrace] Auto-Reveal ignored: distance=${(dataEnd - range.to).toFixed(2)}`);
    }
  }, [chartRef, priceSeriesRef, scrollToRealTime]);

  return {
    syncViewport,
    checkAutoReveal,
    scrollToRealTime,
  };
}
hartRef, priceSeriesRef, chartData, pendingHistoryPrependRef]);

  const checkAutoReveal = useCallback(() => {
    if (!chartRef.current || !priceSeriesRef.current) return;

    const ts = chartRef.current.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;

    const data = priceSeriesRef.current.data();
    const dataEnd = data.length - 1;
    
    if (range.to >= dataEnd - AUTO_REVEAL_THRESHOLD) {
      scrollToRealTime();
    }
  }, [chartRef, priceSeriesRef, scrollToRealTime]);

  return {
    syncViewport,
    checkAutoReveal,
    scrollToRealTime,
  };
}
