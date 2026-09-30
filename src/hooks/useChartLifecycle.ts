import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi, Time, TickMarkType, IPriceLine } from 'lightweight-charts';
import type { ActiveTrade, ChartBar, DrawType, RawBar, RayDrawing, RectDrawing, RectPoint, TickerDrawings, Timeframe, HistoryPrependState } from '../types';
import { TF_SECONDS } from '../types';
import { getTzForTicker, isRthTick } from '../lib/timezones';
import { usePlaybackStore, isoToMs } from '../store/usePlaybackStore';
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

const getTickMs = (t: any): number => {
  if (!t) return 0;
  if (typeof t.time === 'number') {
    return t.time < 1e11 ? t.time * 1000 : t.time;
  }
  const str = String(t.time);
  return new Date(str.replace(' ', 'T') + (str.includes('Z') ? '' : 'Z')).getTime();
};

const findFirstTickAfter = (ticks: any[], targetMs: number): number => {
  let low = 0;
  let high = ticks.length - 1;
  let result = ticks.length;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const tMs = getTickMs(ticks[mid]);
    if (tMs > targetMs) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return result;
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

  // lastCandleRef is maintained directly by the data update effect and PERF-01 tick subscriber


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
  const initialPlayback = usePlaybackStore.getState();
  const lastTickerRef = useRef(ticker);
  const lastTfRef = useRef(timeframe);
  const lastEthRef = useRef(showEth);
  const lastConsumedTickRef = useRef<any>(
    initialPlayback.latestTickBySymbol?.[ticker.toUpperCase()] ||
    (initialPlayback.currentTick?.symbol?.toUpperCase() === ticker.toUpperCase() ? initialPlayback.currentTick : null)
  );
  const lastConsumedTimeRef = useRef<number>(initialPlayback.currentTime || 0);
  const wasPausedRef = useRef<boolean>(initialPlayback.isPaused);
  const syntheticBucketVolumesRef = useRef<{ bucketTime: number; minutes: Map<number, number> }>({
    bucketTime: -1,
    minutes: new Map(),
  });
  
  const isDrawingModeRef = useRef(isDrawingMode);
  const currentTickerRef = useRef(ticker);

  useEffect(() => {
    isDrawingModeRef.current = isDrawingMode;
  }, [isDrawingMode]);

  useEffect(() => {
    currentTickerRef.current = ticker;
    setIsHydrated(false);
    const playbackState = usePlaybackStore.getState();
    const symUpper = ticker.toUpperCase();
    lastConsumedTimeRef.current = playbackState.currentTime || 0;
    lastConsumedTickRef.current = playbackState.latestTickBySymbol?.[symUpper] ||
      (playbackState.currentTick?.symbol?.toUpperCase() === symUpper ? playbackState.currentTick : null);
    syntheticBucketVolumesRef.current = { bucketTime: -1, minutes: new Map() };
  }, [ticker]);

  const hasScrolledToRealTimeRef = useRef(false);
  useEffect(() => {
    setIsHydrated(false);
    hasScrolledToRealTimeRef.current = false;
    lastConsumedTimeRef.current = usePlaybackStore.getState().currentTime || 0;
    syntheticBucketVolumesRef.current = { bucketTime: -1, minutes: new Map() };
  }, [timeframe, ticker]);

  const prevLoadingRef = useRef(isLoadingHistory);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoadingHistory && chartData.length === 0) {
      setIsHydrated(true);
    }
    prevLoadingRef.current = isLoadingHistory;
  }, [isLoadingHistory, chartData.length]);

  useEffect(() => {
    if (isHydrated && chartData.length > 0 && !hasScrolledToRealTimeRef.current) {
      hasScrolledToRealTimeRef.current = true;
      scrollToRealTime();
    }
  }, [isHydrated, chartData.length, scrollToRealTime]);

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
      const hasPendingPrepend = pendingHistoryPrependRef.current !== null;

      let updatedIncrementally = false;

      // Incremental candle update:
      // When in same context, no history prepend, and we have a rendered last candle whose timestamp exists in formatted data
      if (isSameContext && !hasPendingPrepend && lastCandleRef.current && lastDataCountRef.current > 0) {
        const lastTime = lastCandleRef.current.time;
        let matchIdx = -1;
        for (let i = formatted.length - 1; i >= 0; i--) {
          if (formatted[i].time === lastTime) {
            matchIdx = i;
            break;
          }
        }

        // An incremental update is only valid if the number of bars preceding matchIdx matches what was already rendered.
        // If older bars were added before matchIdx, lightweight-charts cannot prepend via .update(); it requires setData().
        const isPrefixUnchanged = matchIdx === lastDataCountRef.current - 1;

        if (matchIdx !== -1 && isPrefixUnchanged) {
          try {

            // Update the candle at matchIdx (forming candle or recently closed candle)
            const curBar = formatted[matchIdx];
            initPriceSeriesRef.current.update({
              time: curBar.time,
              open: curBar.open,
              high: curBar.high,
              low: curBar.low,
              close: curBar.close,
            });
            initVolumeSeriesRef.current.update({
              time: curBar.time,
              value: curBar.volume,
              color: curBar.close >= curBar.open
                ? (theme === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a')
                : (theme === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350'),
            });

            // If there are subsequent new candles, append them in chronological order
            for (let i = matchIdx + 1; i < formatted.length; i++) {
              const bar = formatted[i];
              initPriceSeriesRef.current.update({
                time: bar.time,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
              });
              initVolumeSeriesRef.current.update({
                time: bar.time,
                value: bar.volume,
                color: bar.close >= bar.open
                  ? (theme === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a')
                  : (theme === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350'),
              });
            }

            const lastBar = formatted[formatted.length - 1];
            lastCandleRef.current = {
              time: lastBar.time as number,
              open: lastBar.open,
              high: lastBar.high,
              low: lastBar.low,
              close: lastBar.close,
              volume: lastBar.volume || 0,
            };
            updatedIncrementally = true;
          } catch (err) {
            console.warn('[useChartLifecycle] Incremental update threw error, falling back to setData:', err);
            updatedIncrementally = false;
          }
        }
      }


      if (!updatedIncrementally) {
        // Full dataset load (initial load, context switch, timeline seek/jump, or history prepend)
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

        if (vpPluginRef.current) {
          vpPluginRef.current.setData(formatted);
        }

        const lastBar = formatted[formatted.length - 1];
        lastCandleRef.current = {
          time: lastBar.time as number,
          open: lastBar.open,
          high: lastBar.high,
          low: lastBar.low,
          close: lastBar.close,
          volume: lastBar.volume || 0,
        };

        // Only apply autoScale and sync viewport on context changes, history prepends, or initial load
        if (!isSameContext || hasPendingPrepend || lastDataCountRef.current === 0) {
          initChartRef.current.priceScale('right').applyOptions({ autoScale: true });
          syncViewport(isSameContext);
        }
      }

      // REV-SYNC-02: Synchronize consumed cursor with seek snapshot
      const currentPlayback = usePlaybackStore.getState();
      const symUpper = ticker.toUpperCase();
      if (currentPlayback.currentTime) {
        lastConsumedTimeRef.current = currentPlayback.currentTime;
      }
      lastConsumedTickRef.current = currentPlayback.latestTickBySymbol?.[symUpper] ||
        (currentPlayback.currentTick?.symbol?.toUpperCase() === symUpper ? currentPlayback.currentTick : null);

      lastTickerRef.current = ticker;
      lastTfRef.current = timeframe;
      lastEthRef.current = showEth;
      lastDataCountRef.current = chartData.length;

      // CONV-VOL-01: Reconstruct constituent fallback volume state upon snapshot hydration
      if (lastCandleRef.current) {
        const bucketTime = lastCandleRef.current.time;
        const bucketMinutes = new Map<number, number>();
        const currentCutoffMs = currentPlayback.currentTime || 0;
        const masterData = currentPlayback.masterData || [];

        for (const bar of masterData) {
          if (bar.symbol && bar.symbol.toUpperCase() !== symUpper) continue;
          const barMs = isoToMs(bar.time);
          if (getBucketTime(barMs, timeframe) === bucketTime) {
            if (barMs < currentCutoffMs) {
              bucketMinutes.set(Math.floor(barMs / 60000) * 60000, bar.volume || 0);
            }
          }
        }

        if (bucketMinutes.size === 0 && (lastCandleRef.current.volume || 0) > 0) {
          const anchorMinute = Math.floor((bucketTime * 1000) / 60000) * 60000;
          bucketMinutes.set(anchorMinute, lastCandleRef.current.volume);
        }

        syntheticBucketVolumesRef.current = {
          bucketTime,
          minutes: bucketMinutes,
        };
      } else {
        syntheticBucketVolumesRef.current = { bucketTime: -1, minutes: new Map() };
      }

      if (!isHydratedRef.current) {
        requestAnimationFrame(() => {
          setIsHydrated(true);
        });
      }

    } else if (initPriceSeriesRef.current && initVolumeSeriesRef.current && chartData.length === 0) {
      initPriceSeriesRef.current.setData([]);
      initVolumeSeriesRef.current.setData([]);
      lastCandleRef.current = null;
      lastDataCountRef.current = 0;
      lastConsumedTickRef.current = null;
      lastConsumedTimeRef.current = usePlaybackStore.getState().currentTime || 0;
      syntheticBucketVolumesRef.current = { bucketTime: -1, minutes: new Map() };
    }

  }, [chartData, ticker, timeframe, showEth, syncViewport, theme, isLoadingHistory]);

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

  // 6. Direct High-Performance Playback Tick Subscription (PERF-01, PERF-02, PERF-04, INGEST-01..05)
  // Bypasses React render tree completely during active playback (~60fps O(1) direct canvas updates)
  useEffect(() => {
    if (!initPriceSeriesRef.current || !initVolumeSeriesRef.current) return;

    const sym = ticker.toUpperCase();

    const unsubscribe = usePlaybackStore.subscribe((state) => {
      // REV-SYNC-02 & REV-SYNC-03: Temporal discontinuity detection (rewind during pause or playback)
      if (state.currentTime !== null && state.currentTime !== undefined) {
        if (lastConsumedTimeRef.current > state.currentTime) {
          lastConsumedTimeRef.current = state.currentTime;
          lastConsumedTickRef.current = null;
          syntheticBucketVolumesRef.current = { bucketTime: -1, minutes: new Map() };
        }

        if (state.isPaused) {
          wasPausedRef.current = true;
          return;
        }
      }

      // Guard: Only update if playing, series are ready, and chart is hydrated
      if (state.isPaused || !initPriceSeriesRef.current || !initVolumeSeriesRef.current || !isHydratedRef.current) {
        wasPausedRef.current = state.isPaused;
        return;
      }

      const isUnpausing = wasPausedRef.current && !state.isPaused;
      wasPausedRef.current = state.isPaused;

      const latestTick = state.latestTickBySymbol?.[sym] ||
        (state.currentTick?.symbol?.toUpperCase() === sym ? state.currentTick : null);
      if (!latestTick || !latestTick.price || latestTick.price <= 0) return;

      // 1D Extended Hours Live Price Line
      if (timeframe === '1D') {
        if (!priceLineRef.current) {
          priceLineRef.current = initPriceSeriesRef.current.createPriceLine({
            price: latestTick.price,
            color: 'rgba(255, 210, 0, 0.6)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'Live',
          });
        } else {
          priceLineRef.current.applyOptions({ price: latestTick.price });
        }

        // Daily completed bars strictly use RTH ticks
        if (!isRthTick(latestTick, ticker)) return;
      }

      // INGEST-05: Strict ETH-off filtering for intraday charts
      if (!showEth && !isRthTick(latestTick, ticker)) return;

      // INGEST-01 & REV-SYNC-04: Multi-tick / Intra-frame aggregation with binary search cursor
      const symbolTicks = state.ticksBySymbol?.[sym];
      let newlyElapsedTicks: any[] = [];

      if (symbolTicks && symbolTicks.length > 0 && state.currentTime) {
        const lastTime = lastConsumedTimeRef.current;
        const startIdx = findFirstTickAfter(symbolTicks, lastTime);
        for (let i = startIdx; i < symbolTicks.length; i++) {
          const t = symbolTicks[i];
          const tMs = getTickMs(t);
          if (tMs > state.currentTime) {
            break; // Stop scanning future ticks!
          }
          if (tMs > lastTime) {
            if (showEth || isRthTick(t, ticker)) {
              newlyElapsedTicks.push(t);
            }
          }
        }
      }

      if (newlyElapsedTicks.length === 0) {
        if (latestTick && latestTick !== lastConsumedTickRef.current) {
          newlyElapsedTicks = [latestTick];
        }
      }

      if (newlyElapsedTicks.length === 0) {
        if (isUnpausing && lastCandleRef.current) {
          initVolumeSeriesRef.current.update({
            time: lastCandleRef.current.time as any,
            value: lastCandleRef.current.volume,
            color: lastCandleRef.current.close >= lastCandleRef.current.open
              ? (themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a')
              : (themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350'),
          });
        }
        return; // No new trade events to consume in this frame
      }

      lastConsumedTickRef.current = latestTick;
      if (state.currentTime) {
        lastConsumedTimeRef.current = state.currentTime;
      }

      // Process newly elapsed ticks in order
      for (const tick of newlyElapsedTicks) {
        const tickTimeMs = getTickMs(tick);

        const bucketTime = getBucketTime(tickTimeMs, timeframe);
        const lastCandle = lastCandleRef.current;

        // INGEST-03: Create first candle if history was empty
        if (!lastCandle) {
          const isSynthetic = Boolean((tick as any).isSynthesized);
          const tickVol = tick.volume !== undefined && tick.volume !== null ? tick.volume : 1.0;
          if (isSynthetic) {
            syntheticBucketVolumesRef.current = {
              bucketTime,
              minutes: new Map([[Math.floor(tickTimeMs / 60000) * 60000, tickVol]]),
            };
          }
          const firstCandle = {
            time: bucketTime,
            open: tick.price,
            high: tick.price,
            low: tick.price,
            close: tick.price,
            volume: tickVol,
          };
          lastCandleRef.current = firstCandle;

          initPriceSeriesRef.current.update({
            time: bucketTime as any,
            open: firstCandle.open,
            high: firstCandle.high,
            low: firstCandle.low,
            close: firstCandle.close,
          });

          initVolumeSeriesRef.current.update({
            time: bucketTime as any,
            value: firstCandle.volume,
            color: themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a',
          });
          continue;
        }

        if (bucketTime < lastCandle.time) continue;

        const isSynthetic = Boolean((tick as any).isSynthesized);
        const tickVol = tick.volume !== undefined && tick.volume !== null ? tick.volume : 1.0;

        if (lastCandle.time === bucketTime) {
          lastCandle.high = Math.max(lastCandle.high, tick.price);
          lastCandle.low = Math.min(lastCandle.low, tick.price);
          lastCandle.close = tick.price;
          // REV-FORM-02: For synthetic fallback ticks, accumulate constituent minutes within this higher-tf bucket
          if (isSynthetic) {
            if (syntheticBucketVolumesRef.current.bucketTime !== bucketTime) {
              syntheticBucketVolumesRef.current = {
                bucketTime,
                minutes: new Map(),
              };
            }
            const minuteKey = Math.floor(tickTimeMs / 60000) * 60000;
            syntheticBucketVolumesRef.current.minutes.set(minuteKey, tickVol);
            let totalBucketVol = 0;
            for (const vol of syntheticBucketVolumesRef.current.minutes.values()) {
              totalBucketVol += vol;
            }
            lastCandle.volume = Number(totalBucketVol.toFixed(4));
          } else {
            lastCandle.volume = Number((lastCandle.volume + tickVol).toFixed(4));
          }

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
          let initVol = tickVol;
          if (isSynthetic) {
            syntheticBucketVolumesRef.current = {
              bucketTime,
              minutes: new Map([[Math.floor(tickTimeMs / 60000) * 60000, tickVol]]),
            };
            initVol = tickVol;
          }
          const newCandle = {
            time: bucketTime,
            open: tick.price,
            high: tick.price,
            low: tick.price,
            close: tick.price,
            volume: initVol,
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
  }, [ticker, timeframe, showEth, initPriceSeriesRef.current, initVolumeSeriesRef.current]);

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
