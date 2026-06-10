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
  const autoRevealLockedRef = useRef(false);
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
        const { oldFirstTime, oldLogicalRange: prependRange } = pendingHistoryPrependRef.current;
        if (oldFirstTime === null) {
          ts.setVisibleLogicalRange(oldLogicalRange);
          autoRevealLockedRef.current = true;
          pendingHistoryPrependRef.current = null;
          return;
        }
        const newFirstIndex = chartData.findIndex(d => d.time === oldFirstTime);
        if (newFirstIndex > 0 && prependRange) {
            const newRange = { from: prependRange.from + newFirstIndex, to: prependRange.to + newFirstIndex };
            ts.setVisibleLogicalRange(newRange);
            autoRevealLockedRef.current = true;
        } else {
            ts.setVisibleLogicalRange(oldLogicalRange);
            autoRevealLockedRef.current = true;
        }
        pendingHistoryPrependRef.current = null;
      } else if (wasAtEnd) {
        const shift = chartData.length - lastDataCountRef.current;
        if (shift > 0) {
          const newRange = { from: oldLogicalRange.from + shift, to: oldLogicalRange.to + shift };
          ts.setVisibleLogicalRange(newRange);
          autoRevealLockedRef.current = true;
        } else {
          ts.setVisibleLogicalRange(oldLogicalRange);
          autoRevealLockedRef.current = true;
        }
      } else {
        ts.setVisibleLogicalRange(oldLogicalRange);
        autoRevealLockedRef.current = true;
      }
    } else if (pendingHistoryPrependRef.current) {
        const { oldFirstTime, oldLogicalRange: prependRange } = pendingHistoryPrependRef.current;
        const newFirstIndex = chartData.findIndex(d => d.time === oldFirstTime);
        if (newFirstIndex > 0 && prependRange) {
            const newRange = { from: prependRange.from + newFirstIndex, to: prependRange.to + newFirstIndex };
            ts.setVisibleLogicalRange(newRange);
            autoRevealLockedRef.current = true;
        }
        pendingHistoryPrependRef.current = null;
    }

    lastDataCountRef.current = chartData.length;
  }, [chartRef, priceSeriesRef, chartData, pendingHistoryPrependRef]);

  const checkAutoReveal = useCallback(() => {
    if (!chartRef.current || !priceSeriesRef.current) return;

    if (autoRevealLockedRef.current) {
      autoRevealLockedRef.current = false;
      return;
    }

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
