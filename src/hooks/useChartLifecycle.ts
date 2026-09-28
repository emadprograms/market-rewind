import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi, Time, TickMarkType, IPriceLine } from 'lightweight-charts';
import type { ActiveTrade, ChartBar, DrawType, RawBar, RayDrawing, RectDrawing, RectPoint, TickerDrawings, Timeframe, HistoryPrependState } from '../types';
import { TF_SECONDS } from '../types';
import { getTzForTicker, isRthTick } from '../lib/timezones';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { useChartInit } from './chart/useChartInit';
import { useChartPlugins } from './chart/useChartPlugins';
import { useChartDrawings } from './chart/useChartDrawings';
import { useChartViewport } from './chart/useChartViewport';

const getBucketTime = (timestampMs: number, tf: Timeframe): number => {
  const date = new Date(timestampMs);
  if (tf === '1D') {
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0) / 1000);
  }
  const durationSec = TF_SECONDS[tf] || 60;
  const bucketStartMs = Math.floor(timestampMs / (durationSec * 1000)) * (durationSec * 1000);
  return Math.floor(bucketStartMs / 1000);
};

interface UseChartLifecycleParams {
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  ticker: string;
  timeframe: Timeframe;
  showEth: boolean;
  showVP: boolean;
  theme?: 'light' | 'dark' | 'oled';
  chartData: ChartBar[];
  boundaryTime?: string | null;
  localMasterData: RawBar[];
  isReplayMode?: boolean;
  isLoadingHistory: boolean;
  pendingHistoryPrependRef: React.MutableRefObject<HistoryPrependState | null>;
  isDrawingMode: boolean;
  drawType: DrawType;
  rectAnchor: RectPoint | null;
  setRectAnchor: React.Dispatch<React.SetStateAction<RectPoint | null>>;
  ghostPoint: RectPoint | null;
  setGhostPoint: React.Dispatch<React.SetStateAction<RectPoint | null>>;
  drawings: TickerDrawings;
  onUpdateDrawings: (ticker: string, type: 'rays' | 'rects', items: RayDrawing[] | RectDrawing[]) => void;
  activeTrade?: ActiveTrade | null;
  tradeBadgeRef?: React.RefObject<HTMLDivElement | null>;
  chartRef: React.MutableRefObject<IChartApi | null>;
  priceSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  onFocus?: () => void;
}

export function useChartLifecycle({
  chartContainerRef,
  ticker,
  timeframe,
  showEth,
  showVP,
  theme = 'oled',
  chartData,
  boundaryTime = null,
  localMasterData,
  isReplayMode = false,
  isLoadingHistory,
  pendingHistoryPrependRef,
  isDrawingMode,
  drawType,
  rectAnchor,
  setRectAnchor,
  ghostPoint,
  setGhostPoint,
  drawings,
  onUpdateDrawings,
  activeTrade = null,
  tradeBadgeRef,
  chartRef,
  priceSeriesRef,
  onFocus,
}: UseChartLifecycleParams) {
  const [isViewModified, setIsViewModified] = useState(false);
  const isAtEnd = !isViewModified;

  const themeRef = useRef(theme);
  const isHydratedRef = useRef(false);
  const lastCandleRef = useRef<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);
  
  const { 
    chartRef: initChartRef, 
    priceSeriesRef: initPriceSeriesRef, 
    volumeSeriesRef: initVolumeSeriesRef, 
    lastBarSpacingRef: initLastBarSpacingRef 
  } = useChartInit({
    chartContainerRef,
    ticker,
    timeframe,
    onViewStateChange: useCallback((atEnd: boolean, autoScale: boolean) => setIsViewModified(!atEnd || !autoScale), []),
  });

  const {
    shadingPluginRef,
    vpPluginRef,
    rayPluginRef,
    rectPluginRef,
    tradePluginRef,
    updateShadingConfig,
    pluginVersion,
  } = useChartPlugins({
    priceSeriesRef: initPriceSeriesRef,
    ticker,
    timeframe,
    showEth,
    showVP,
    boundaryTime,
    drawings,
    tradeBadgeRef,
  });

  const {
    syncViewport,
    scrollToRealTime,
    resetView,
  } = useChartViewport({
    chartRef,
    priceSeriesRef,
    chartData,
    pendingHistoryPrependRef,
  });

  useChartDrawings({
    chartRef,
    priceSeriesRef,
    chartContainerRef,
    isDrawingMode,
    drawType,
    rectAnchor,
    setRectAnchor,
    ghostPoint,
    setGhostPoint,
    drawings,
    ticker,
    onUpdateDrawings,
  });

  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    isHydratedRef.current = isHydrated;
  }, [isHydrated]);

  // Seed lastCandleRef from chartData so ticks extend the latest completed candle
  useEffect(() => {
    if (chartData.length > 0) {
      const last = chartData[chartData.length - 1];
      const timeSec = typeof last.time === 'number'
        ? (last.time > 1e11 ? Math.floor(last.time / 1000) : last.time)
        : Math.floor(new Date(String(last.time).replace(' ', 'T') + (String(last.time).includes('Z') ? '' : 'Z')).getTime() / 1000);

      lastCandleRef.current = {
        time: timeSec,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume || 0,
      };
    } else {
      lastCandleRef.current = null;
    }
  }, [chartData]);

  useEffect(() => {
    chartRef.current = initChartRef.current;
    priceSeriesRef.current = initPriceSeriesRef.current;
  }, [initChartRef.current, initPriceSeriesRef.current, chartRef, priceSeriesRef]);

  // Theme support
  useEffect(() => {
    if (!initChartRef.current || !initPriceSeriesRef.current || !initVolumeSeriesRef.current) return;

    if (theme === 'light') {
        initChartRef.current.applyOptions({
            layout: { background: { color: '#cccccc' }, textColor: '#000000' },
            grid: { vertLines: { color: 'rgba(0, 0, 0, 0.05)' }, horzLines: { color: 'rgba(0, 0, 0, 0.05)' } },
            timeScale: { borderColor: '#a3a3a3' }
        });
        initChartRef.current.priceScale('right').applyOptions({
            borderColor: '#a3a3a3'
        });
        if (typeof initPriceSeriesRef.current.applyOptions === 'function') {
            initPriceSeriesRef.current.applyOptions({
                upColor: '#ffffff',
                downColor: '#000000',
                borderVisible: true,
                borderColor: '#000000',
                borderUpColor: '#000000',
                borderDownColor: '#000000',
                wickUpColor: '#000000',
                wickDownColor: '#000000',
            });
        }
    } else {
        initChartRef.current.applyOptions({
            layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
            grid: { vertLines: { color: 'rgba(255, 255, 255, 0.05)' }, horzLines: { color: 'rgba(255, 255, 255, 0.05)' } },
            timeScale: { borderColor: 'rgba(255, 255, 255, 0.1)' }
        });
        initChartRef.current.priceScale('right').applyOptions({
            borderColor: 'rgba(255, 255, 255, 0.1)'
        });
        if (typeof initPriceSeriesRef.current.applyOptions === 'function') {
            initPriceSeriesRef.current.applyOptions({
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                borderColor: 'transparent',
                borderUpColor: 'transparent',
                borderDownColor: 'transparent',
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350',
            });
        }
    }
  }, [theme, initChartRef.current, initPriceSeriesRef.current, initVolumeSeriesRef.current]);

  const lastDataCountRef = useRef(0);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const lastTickerRef = useRef(ticker);
  const lastTfRef = useRef(timeframe);
  const lastEthRef = useRef(showEth);
  
  const isDrawingModeRef = useRef(isDrawingMode);
  const currentTickerRef = useRef(ticker);

  useEffect(() => {
    isDrawingModeRef.current = isDrawingMode;
  }, [isDrawingMode]);

  useEffect(() => {
    currentTickerRef.current = ticker;
    setIsHydrated(false);
  }, [ticker]);

  useEffect(() => {
    setIsHydrated(false);
  }, [timeframe]);

  useEffect(() => {
    if (isHydrated && chartData.length > 0) {
      scrollToRealTime();
    }
  }, [isHydrated, scrollToRealTime]);

  // Update chart timezone and timeframe-aware formatters
  useEffect(() => {
    if (!initChartRef.current) return;
    const tz = getTzForTicker(ticker);
    initChartRef.current.applyOptions({
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
        timeVisible: timeframe !== '1D',
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => {
          const date = new Date((time as number) * 1000);
          if (tickMarkType <= 2) return date.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
          return date.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
        }
      }
    });
  }, [ticker, timeframe]);

  // Update effect for ghost rectangle
  useEffect(() => {
    if (rectPluginRef.current && rectAnchor && ghostPoint) {
      rectPluginRef.current.setRects([...(drawings.rects || []), { p1: rectAnchor, p2: ghostPoint }]);
    } else if (rectPluginRef.current) {
        rectPluginRef.current.setRects(drawings.rects || []);
    }
  }, [rectAnchor, ghostPoint, drawings.rects]);

  // Update active trade in trade plugin if provided
  useEffect(() => {
    if (tradePluginRef.current && activeTrade !== undefined) {
      tradePluginRef.current.setTrade(activeTrade);
    }
  }, [activeTrade, tradePluginRef, pluginVersion]);

  // 3. Update Chart Data
  useEffect(() => {
    if (initPriceSeriesRef.current && initVolumeSeriesRef.current && initChartRef.current && chartData.length > 0) {
      // DATA-03: Suppress rendering transient single-bar when background history is actively loading
      if (isLoadingHistory && chartData.length === 1) {
        return;
      }

      const isSameContext = lastTickerRef.current === ticker && 
                            lastTfRef.current === timeframe && 
                            lastEthRef.current === showEth;
      
      const formatBar = (d: RawBar) => {
        const timeSec = typeof d.time === 'number'
          ? (d.time > 1e11 ? Math.floor(d.time / 1000) : d.time)
          : Math.floor(new Date(String(d.time).replace(' ', 'T') + (String(d.time).includes('Z') ? '' : 'Z')).getTime() / 1000);
        return {
          time: timeSec as Time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
        };
      };

      const formatted: any[] = chartData.map(formatBar);

      if (vpPluginRef.current) {
        vpPluginRef.current.setData(formatted);
      }

      const hasPendingPrepend = pendingHistoryPrependRef.current !== null;
      const canIncrement = isSameContext && chartData.length >= lastDataCountRef.current && lastDataCountRef.current > 0 && !hasPendingPrepend;

      if (canIncrement) {
        try {
          const prevCount = lastDataCountRef.current;
          if (prevCount > 0) {
            const lastBar = formatted[prevCount - 1];
            initPriceSeriesRef.current.update({ time: lastBar.time, open: lastBar.open, high: lastBar.high, low: lastBar.low, close: lastBar.close });
            initVolumeSeriesRef.current.update({
              time: lastBar.time,
              value: lastBar.volume,
              color: lastBar.close >= lastBar.open ? (theme === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a') : (theme === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350')
            });
          }
          for (let i = prevCount; i < formatted.length; i++) {
            const bar = formatted[i];
            initPriceSeriesRef.current.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
            initVolumeSeriesRef.current.update({
              time: bar.time,
              value: bar.volume,
              color: bar.close >= bar.open ? (theme === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a') : (theme === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350')
            });
          }
        } catch {
          initPriceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
            time, open, high, low, close
          })));
          initVolumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
            time, value: volume, color: close >= open ? (theme === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a') : (theme === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350')
          })));
        }
      } else {
        try {
          initPriceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
            time, open, high, low, close
          })));
        } catch (err) {
          console.warn('lightweight-charts price series error:', err);
        }

        try {
          initVolumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
            time, value: volume, color: close >= open ? (theme === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a') : (theme === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350')
          })));
        } catch (err) {
          console.warn('lightweight-charts volume series error:', err);
        }
      }

      initChartRef.current.priceScale('right').applyOptions({ autoScale: true });
      syncViewport(isSameContext);

      lastTickerRef.current = ticker;
      lastTfRef.current = timeframe;
      lastEthRef.current = showEth;
      lastDataCountRef.current = chartData.length;

      requestAnimationFrame(() => {
        setIsHydrated(true);
      });

    } else if (initPriceSeriesRef.current && initVolumeSeriesRef.current && chartData.length === 0) {
      initPriceSeriesRef.current.setData([]);
      initVolumeSeriesRef.current.setData([]);
    }

  }, [chartData, syncViewport, theme, isLoadingHistory]);

  // 3b. Refresh shading plugin when ticker/timeframe/ETH changes
  useEffect(() => {
    const tz = getTzForTicker(ticker);
    const isET = tz === 'America/New_York';
    updateShadingConfig(isET);
  }, [ticker, timeframe, showEth, updateShadingConfig]);

  // 5. Handle Focus Click
  useEffect(() => {
    if (!initChartRef.current || !onFocus) return;
    
    const chart = initChartRef.current;
    const handleFocus = () => {
      onFocus();
    };

    chart.subscribeClick(handleFocus);
    return () => {
      try {
        chart.unsubscribeClick(handleFocus);
      } catch (_) {}
    };
  }, [initChartRef.current, onFocus]);

  // 6. Direct High-Performance Playback Tick Subscription (PERF-01, PERF-02, PERF-04)
  // Bypasses React render tree completely during active playback (~60fps O(1) direct canvas updates)
  useEffect(() => {
    if (!initPriceSeriesRef.current || !initVolumeSeriesRef.current) return;

    const sym = ticker.toUpperCase();

    const unsubscribe = usePlaybackStore.subscribe((state) => {
      // Guard: Only update if playing, series are ready, and chart is hydrated
      if (state.isPaused || !initPriceSeriesRef.current || !initVolumeSeriesRef.current || !isHydratedRef.current) return;

      const tick = state.latestTickBySymbol?.[sym] ||
        (state.currentTick?.symbol?.toUpperCase() === sym ? state.currentTick : null);
      if (!tick || !tick.price || tick.price <= 0) return;

      const tickTimeMs = typeof tick.time === 'number'
        ? (tick.time < 1e11 ? tick.time * 1000 : tick.time)
        : new Date(String(tick.time).replace(' ', 'T') + (String(tick.time).includes('Z') ? '' : 'Z')).getTime();

      // 1D Extended Hours Live Price Line
      if (timeframe === '1D') {
        if (!priceLineRef.current) {
          priceLineRef.current = initPriceSeriesRef.current.createPriceLine({
            price: tick.price,
            color: 'rgba(255, 210, 0, 0.6)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'Live',
          });
        } else {
          priceLineRef.current.applyOptions({ price: tick.price });
        }

        // Daily completed bars strictly use RTH ticks
        if (!isRthTick(tick, ticker)) return;
      }

      const bucketTime = getBucketTime(tickTimeMs, timeframe);
      const lastCandle = lastCandleRef.current;

      if (lastCandle) {
        if (bucketTime < lastCandle.time) return;

        const tickVol = tick.volume !== undefined && tick.volume !== null ? tick.volume : 1.0;

        if (lastCandle.time === bucketTime) {
          lastCandle.high = Math.max(lastCandle.high, tick.price);
          lastCandle.low = Math.min(lastCandle.low, tick.price);
          lastCandle.close = tick.price;
          lastCandle.volume = Number((lastCandle.volume + tickVol).toFixed(4));

          initPriceSeriesRef.current.update({
            time: bucketTime as any,
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            close: lastCandle.close,
          });

          initVolumeSeriesRef.current.update({
            time: bucketTime as any,
            value: lastCandle.volume,
            color: lastCandle.close >= lastCandle.open
              ? (themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a')
              : (themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350'),
          });
        } else {
          // New candle bucket!
          const newCandle = {
            time: bucketTime,
            open: tick.price,
            high: tick.price,
            low: tick.price,
            close: tick.price,
            volume: tickVol,
          };
          lastCandleRef.current = newCandle;

          initPriceSeriesRef.current.update({
            time: bucketTime as any,
            open: newCandle.open,
            high: newCandle.high,
            low: newCandle.low,
            close: newCandle.close,
          });

          initVolumeSeriesRef.current.update({
            time: bucketTime as any,
            value: newCandle.volume,
            color: themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a',
          });
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [ticker, timeframe, initPriceSeriesRef.current, initVolumeSeriesRef.current]);

  // 7. Static/Paused Price Line for 1D chart (Extended Hours)
  useEffect(() => {
    if (!initPriceSeriesRef.current) return;

    const unsub = usePlaybackStore.subscribe((state) => {
      if (!state.isPaused) return; // handled by direct tick subscriber during playback
      if (timeframe !== '1D' || !state.currentTime || localMasterData.length === 0) {
        if (priceLineRef.current && initPriceSeriesRef.current) {
          try {
            initPriceSeriesRef.current.removePriceLine(priceLineRef.current);
            priceLineRef.current = null;
          } catch (_) {}
        }
        return;
      }

      let lastPrice = null;
      for (let i = localMasterData.length - 1; i >= 0; i--) {
        const barMs = new Date(localMasterData[i].time.replace(' ', 'T') + 'Z').getTime();
        if (barMs <= state.currentTime) {
          lastPrice = localMasterData[i].close;
          break;
        }
      }

      if (lastPrice !== null) {
        if (!priceLineRef.current) {
          priceLineRef.current = initPriceSeriesRef.current.createPriceLine({
            price: lastPrice,
            color: 'rgba(255, 210, 0, 0.6)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'Live',
          });
        } else {
          priceLineRef.current.applyOptions({ price: lastPrice });
        }
      }
    });

    return () => {
      unsub();
      if (priceLineRef.current && initPriceSeriesRef.current) {
        try {
          initPriceSeriesRef.current.removePriceLine(priceLineRef.current);
          priceLineRef.current = null;
        } catch (_) {}
      }
    };
  }, [timeframe, localMasterData, initPriceSeriesRef.current]);

  return {
    volumeSeriesRef: initVolumeSeriesRef,
    tradePluginRef,
    pluginVersion,
    isAtEnd,
    isViewModified,
    scrollToRealTime,
    resetView,
    isHydrated,
  };
}
