import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, TickMarkType } from 'lightweight-charts';
import type { Timeframe } from '../../types';

interface UseChartInitParams {
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  ticker: string;
  timeframe: Timeframe;
  onViewStateChange?: (atEnd: boolean, autoScale: boolean) => void;
  onAtEndChange?: (atEnd: boolean) => void;
}

export function useChartInit({
  chartContainerRef,
  ticker,
  timeframe,
  onViewStateChange,
  onAtEndChange,
}: UseChartInitParams) {
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastBarSpacingRef = useRef<number | null>(null);

  const onViewStateChangeRef = useRef(onViewStateChange);
  const onAtEndChangeRef = useRef(onAtEndChange);
  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange;
    onAtEndChangeRef.current = onAtEndChange;
  }, [onViewStateChange, onAtEndChange]);

  const notifyViewState = (atEnd: boolean, autoScale: boolean) => {
    if (onViewStateChangeRef.current) {
      onViewStateChangeRef.current(atEnd, autoScale);
    } else if (onAtEndChangeRef.current) {
      onAtEndChangeRef.current(atEnd);
    }
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
        attributionLogo: false,
      },
      rightPriceScale: {
        minimumWidth: 80,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: { mode: 0 },
      localization: {
        timeFormatter: (time: Time) => {
          const date = new Date((time as number) * 1000);
          return date.toLocaleString('en-US', { hour12: false, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
        shiftVisibleRangeOnNewBar: false,
        rightOffset: 15,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => {
          const date = new Date((time as number) * 1000);
          if (tickMarkType <= 2) return date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
          return date.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
      },
      handleScroll: true,
      handleScale: true,
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        const ts = chart.timeScale();
        lastBarSpacingRef.current = typeof ts.options === 'function' ? ts.options().barSpacing : null;

        const logicalRange = ts.getVisibleLogicalRange();
        if (logicalRange && priceSeriesRef.current) {
            const bars = priceSeriesRef.current.data();
            if (bars.length > 0) {
                const lastBarIndex = bars.length - 1;
                const newAtEnd = logicalRange.to >= lastBarIndex - 0.5;
                const scale = chart.priceScale('right');
                const autoScale = typeof scale.options === 'function' ? scale.options().autoScale : true;
                notifyViewState(newAtEnd, autoScale !== false);
            }
        }
    });

    const intervalId = setInterval(() => {
      if (!priceSeriesRef.current) return;
      const ts = chart.timeScale();
      const logicalRange = ts.getVisibleLogicalRange();
      const bars = priceSeriesRef.current.data();
      let isAtEnd = true;
      if (logicalRange && bars.length > 0) {
          const lastBarIndex = bars.length - 1;
          isAtEnd = logicalRange.to >= lastBarIndex - 0.5;
      }
      const scale = chart.priceScale('right');
      const autoScale = typeof scale.options === 'function' ? scale.options().autoScale : true;
      notifyViewState(isAtEnd, autoScale !== false);
    }, 250);

    chart.priceScale('right').applyOptions({
      minimumWidth: 80,
      scaleMargins: {
        top: 0.1,
        bottom: 0.15,
      },
    });

    const priceSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', 
      downColor: '#ef5350', 
      borderVisible: false, 
      wickUpColor: '#26a69a', 
      wickDownColor: '#ef5350',
      lastValueVisible: false, // Hide default price label
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
    });

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      chart.applyOptions({ width: newRect.width, height: newRect.height });
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    if (chartContainerRef.current) {
      (chartContainerRef.current as any).__chart = chart;
      (chartContainerRef.current as any).__priceSeries = priceSeries;
      (chartContainerRef.current as any).__volumeSeries = volumeSeries;
    }

    chartRef.current = chart;
    priceSeriesRef.current = priceSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      if (intervalId) clearInterval(intervalId);
      resizeObserver.disconnect();
      if (chartContainerRef.current) {
        delete (chartContainerRef.current as any).__chart;
        delete (chartContainerRef.current as any).__priceSeries;
        delete (chartContainerRef.current as any).__volumeSeries;
      }
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [chartContainerRef]); // Reuses canvas across ticker and timeframe switches

  return { chartRef, priceSeriesRef, volumeSeriesRef, lastBarSpacingRef };
}
