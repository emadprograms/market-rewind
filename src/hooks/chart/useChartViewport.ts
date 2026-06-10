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

    console.log(`[ViewportDebug] syncViewport start: isSameContext=${isSameContext}, dataLen=${chartData.length}, lastCount=${lastDataCountRef.current}`);
    if (oldLogicalRange) {
      console.log(`[ViewportDebug] Input Range: from=${oldLogicalRange.from.toFixed(2)}, to=${oldLogicalRange.to.toFixed(2)}`);
    }

    if (isSameContext && oldLogicalRange) {
      const wasAtEnd = oldLogicalRange.to >= lastDataCountRef.current - 0.5;
      console.log(`[ViewportDebug] wasAtEnd: ${wasAtEnd}`);

      if (pendingHistoryPrependRef.current) {
        const { oldFirstTime, oldLogicalRange: prependRange } = pendingHistoryPrependRef.current;
        if (oldFirstTime === null) {
          console.log(`[ViewportDebug] Action: Prepend Null -> Restore`);
          ts.setVisibleLogicalRange(oldLogicalRange);
          autoRevealLockedRef.current = true;
          pendingHistoryPrependRef.current = null;
          return;
        }
        const newFirstIndex = chartData.findIndex(d => d.time === oldFirstTime);
        if (newFirstIndex > 0 && prependRange) {
            const newRange = { from: prependRange.from + newFirstIndex, to: prependRange.to + newFirstIndex };
            console.log(`[ViewportDebug] Action: Prepend Shift -> from=${newRange.from.toFixed(2)}, to=${newRange.to.toFixed(2)}`);
            ts.setVisibleLogicalRange(newRange);
            autoRevealLockedRef.current = true;
        } else {
            console.log(`[ViewportDebug] Action: Prepend Restore`);
            ts.setVisibleLogicalRange(oldLogicalRange);
            autoRevealLockedRef.current = true;
        }
        pendingHistoryPrependRef.current = null;
      } else if (wasAtEnd) {
        const shift = chartData.length - lastDataCountRef.current;
        if (shift > 0) {
          const newRange = { from: oldLogicalRange.from + shift, to: oldLogicalRange.to + shift };
          console.log(`[ViewportDebug] Action: End Shift (shift=${shift}) -> from=${newRange.from.toFixed(2)}, to=${newRange.to.toFixed(2)}`);
          ts.setVisibleLogicalRange(newRange);
          autoRevealLockedRef.current = true;
        } else {
          console.log(`[ViewportDebug] Action: End Restore (no shift)`);
          ts.setVisibleLogicalRange(oldLogicalRange);
          autoRevealLockedRef.current = true;
        }
      } else {
        console.log(`[ViewportDebug] Action: Pure Restore -> from=${oldLogicalRange.from.toFixed(2)}, to=${oldLogicalRange.to.toFixed(2)}`);
        ts.setVisibleLogicalRange(oldLogicalRange);
        autoRevealLockedRef.current = true;
      }
    } else if (pendingHistoryPrependRef.current) {
        const { oldFirstTime, oldLogicalRange: prependRange } = pendingHistoryPrependRef.current;
        const newFirstIndex = chartData.findIndex(d => d.time === oldFirstTime);
        if (newFirstIndex > 0 && prependRange) {
            const newRange = { from: prependRange.from + newFirstIndex, to: prependRange.to + newFirstIndex };
            console.log(`[ViewportDebug] Action: Context-Change Prepend Shift -> from=${newRange.from.toFixed(2)}, to=${newRange.to.toFixed(2)}`);
            ts.setVisibleLogicalRange(newRange);
            autoRevealLockedRef.current = true;
        }
        pendingHistoryPrependRef.current = null;
    } else {
        console.log(`[ViewportDebug] Action: No Sync (Context Changed/No Range)`);
    }

    lastDataCountRef.current = chartData.length;
  }, [chartRef, priceSeriesRef, chartData, pendingHistoryPrependRef]);

  const checkAutoReveal = useCallback(() => {
    if (!chartRef.current || !priceSeriesRef.current) return;

    if (autoRevealLockedRef.current) {
      console.log(`[ViewportDebug] Auto-Reveal SUPPRESSED (Lock active). Releasing lock.`);
      autoRevealLockedRef.current = false;
      return;
    }

    const ts = chartRef.current.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;

    const data = priceSeriesRef.current.data();
    const dataEnd = data.length - 1;
    
    if (range.to >= dataEnd - AUTO_REVEAL_THRESHOLD) {
      console.log(`[ViewportDebug] Auto-Reveal TRIGGERED: range.to=${range.to.toFixed(2)}, dataEnd=${dataEnd}`);
      scrollToRealTime();
    }
  }, [chartRef, priceSeriesRef, scrollToRealTime]);

  return {
    syncViewport,
    checkAutoReveal,
    scrollToRealTime,
  };
}
