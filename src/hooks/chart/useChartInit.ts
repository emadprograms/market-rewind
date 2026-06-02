import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, TickMarkType } from 'lightweight-charts';
import { getTzForTicker } from '../../lib/timezones';
import type { Timeframe } from '../../types';

interface UseChartInitParams {
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  ticker: string;
  timeframe: Timeframe;
  onAtEndChange: (atEnd: boolean) => void;
}

export function useChartInit({
  chartContainerRef,
  ticker,
  timeframe,
  onAtEndChange,
}: UseChartInitParams) {
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastBarSpacingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const tz = getTzForTicker(ticker);

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: { mode: 0 },
      localization: {
        timeFormatter: (time: Time) => {
          const date = new Date((time as number) * 1000);
          if (timeframe === '1D') {
            return date.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
          }
          return date.toLocaleString('en-US', { timeZone: tz, hour12: false, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: timeframe !== '1D',
        secondsVisible: false,
        shiftVisibleRangeOnNewBar: false,
        rightOffset: 15,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => {
          const date = new Date((time as number) * 1000);
          if (tickMarkType <= 2) return date.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
          return date.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
        }
      },
      handleScroll: true,
      handleScale: true,
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        const ts = chart.timeScale();
        lastBarSpacingRef.current = ts.options().barSpacing;

        const logicalRange = ts.getVisibleLogicalRange();
        if (logicalRange && priceSeriesRef.current) {
            const bars = priceSeriesRef.current.data();
            if (bars.length > 0) {
                const lastBarIndex = bars.length - 1;
                const newAtEnd = logicalRange.to >= lastBarIndex - 0.5;
                onAtEndChange(newAtEnd);
            }
        }
    });

    chart.priceScale('right').applyOptions({
      scaleMargins: {
        top: 0.1,
        bottom: 0.25,
      },
    });

    const priceSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
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

    chartRef.current = chart;
    priceSeriesRef.current = priceSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [chartContainerRef, ticker, timeframe, onAtEndChange]);

  return { chartRef, priceSeriesRef, volumeSeriesRef, lastBarSpacingRef };
}
