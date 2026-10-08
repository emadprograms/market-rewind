import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi, Time, TickMarkType, IPriceLine } from 'lightweight-charts';
import type { ActiveTrade, ChartBar, DrawType, RawBar, RayDrawing, RectDrawing, RectPoint, TickerDrawings, Timeframe, HistoryPrependState } from '../types';

import { getTzForTicker, isRthTick, isRthBar } from '../lib/timezones';
import { usePlaybackStore, isoToMs } from '../store/usePlaybackStore';
import { useChartInit } from './chart/useChartInit';
import { useChartPlugins } from './chart/useChartPlugins';
import { useChartDrawings } from './chart/useChartDrawings';
import { useChartViewport } from './chart/useChartViewport';
import { getBucketTime, resolveDailyIndex, type DailyIndex } from '../lib/dailyIndex';

const getTickMs = (t: any): number => {
  if (!t) return 0;
  if (typeof t.time === 'number') {
    return t.time < 1e11 ? t.time * 1000 : t.time;
  }
  const str = String(t.time);
  return new Date(str.replace(' ', 'T') + (str.includes('Z') ? '' : 'Z')).getTime();
};

/**
 * Tick-independent part of the 1D bucket aggregation.
 *
 * Previously this ran once per catch-up tick. For a 60-minute forward seek on a dense session that
 * is ~9,000 ticks into 12 daily-bucket updates, and the forming-minute scan started at the END of
 * the full buffered tape, walking past every future tick on each call. Both are functions of
 * (bucket, evaluation time), so they are computed once and memoised by the caller.
 *
 * `lastBarClose` is null when no bar or forming tick set it, so the caller can fall back to the
 * current tick exactly as the original code did.
 */
export type DailyBucketAggregate = {
  completedVol: number;
  maxHigh: number;
  minLow: number;
  lastBarClose: number | null;
  firstBarOpen: number | undefined;
  foundAny: boolean;
  formingMinuteVol: number;
};

/**
 * The per-tick part of the 1D aggregation: O(1), and the only place a tick's own price or volume
 * enters the bucket values. Shared by subscriber 6 and by the tests, so there is one
 * implementation to verify rather than a copy in the test that can drift from the hook.
 */
export const applyDailyTickFallback = (
  agg: DailyBucketAggregate,
  tick: { price: number },
  tickVol: number,
  symbolTicks: any[] | undefined,
  isSynthetic: boolean,
): { maxHigh: number; minLow: number; lastBarClose: number; formingMinuteVol: number } => {
  let maxHigh = agg.maxHigh;
  let minLow = agg.minLow;
  let formingMinuteVol = agg.formingMinuteVol;
  // null means no bar or forming tick set it, so it falls back to this tick, as before.
  let lastBarClose = agg.lastBarClose ?? tick.price;
  // Only when there are no buffered ticks for this symbol.
  if (!isSynthetic && !(symbolTicks && symbolTicks.length > 0) && tick.price) {
    lastBarClose = tick.price;
    maxHigh = Math.max(maxHigh, tick.price);
    minLow = Math.min(minLow, tick.price);
    formingMinuteVol = tickVol;
  }
  return { maxHigh, minLow, lastBarClose, formingMinuteVol };
};

export const aggregateDailyBucket = (
  dailyIndexRef: any,
  masterData: any[],
  sym: string,
  ticker: string,
  bucketTime: number,
  evalTimeMs: number,
  isSynthetic: boolean,
  symbolTicks: any[] | undefined,
): DailyBucketAggregate => {
  let completedVol = 0;
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let lastBarClose: number | null = null;
  let firstBarOpen: number | undefined = undefined;
  let foundAny = false;

  const bucketBars = masterData.length > 0
    ? (resolveDailyIndex(dailyIndexRef, masterData, sym, ticker, '1D').byBucket.get(bucketTime) || [])
    : [];

  for (const entry of bucketBars) {
    const bar = entry.bar;
    const barMs = entry.barMs;
    if (barMs <= evalTimeMs) {
      if (firstBarOpen === undefined) {
        firstBarOpen = bar.open;
      }
      foundAny = true;
      const isForming = barMs + 60000 > evalTimeMs;
      if (isForming) {
        maxHigh = Math.max(maxHigh, bar.open);
        minLow = Math.min(minLow, bar.open);
        lastBarClose = bar.open;
      } else {
        completedVol += (bar.volume || 0);
        maxHigh = Math.max(maxHigh, bar.high);
        minLow = Math.min(minLow, bar.low);
        lastBarClose = bar.close;
      }
    }
  }

  // Forming minute from buffered real ticks. Scan backwards from the last tick at or before the
  // evaluation time, not from the end of the tape: the tape includes every future tick, and the
  // old start point walked all of them on every call.
  let formingMinuteVol = 0;
  if (!isSynthetic && symbolTicks && symbolTicks.length > 0) {
    const currentMinuteStartMs = Math.floor(evalTimeMs / 60000) * 60000;
    const lastElapsedIdx = findFirstTickAfter(symbolTicks, evalTimeMs) - 1;
    for (let i = lastElapsedIdx; i >= 0; i--) {
      const t = symbolTicks[i];
      const tMs = getTickMs(t);
      if (tMs < currentMinuteStartMs) break;
      if (tMs <= evalTimeMs && isRthTick(t, ticker)) {
        formingMinuteVol += (t.volume !== undefined && t.volume !== null ? t.volume : 1.0);
        maxHigh = Math.max(maxHigh, t.price);
        minLow = Math.min(minLow, t.price);
        lastBarClose = t.price;
      }
    }
  }

  return { completedVol, maxHigh, minLow, lastBarClose, firstBarOpen, foundAny, formingMinuteVol };
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
  const bidPriceLineRef = useRef<IPriceLine | null>(null);
  const askPriceLineRef = useRef<IPriceLine | null>(null);
  // Last price actually pushed to each line, so the per-frame subscriber can skip
  // applyOptions() when nothing moved (see updateBidAskPriceLines).
  const lastBidRef = useRef<number | null>(null);
  const lastAskRef = useRef<number | null>(null);

  const cleanupBidAskPriceLines = () => {
    if (initPriceSeriesRef.current && typeof initPriceSeriesRef.current.removePriceLine === 'function') {
      if (bidPriceLineRef.current) {
        try {
          initPriceSeriesRef.current.removePriceLine(bidPriceLineRef.current);
        } catch (_) {}
        bidPriceLineRef.current = null;
      }
      if (askPriceLineRef.current) {
        try {
          initPriceSeriesRef.current.removePriceLine(askPriceLineRef.current);
        } catch (_) {}
        askPriceLineRef.current = null;
      }
    } else {
      bidPriceLineRef.current = null;
      askPriceLineRef.current = null;
    }
    // The lines are gone, so the cached prices no longer describe anything on the chart.
    lastBidRef.current = null;
    lastAskRef.current = null;
  };

  const updateBidAskPriceLines = (tick: any | null, fallbackPrice: number | null) => {
    if (!initPriceSeriesRef.current || typeof initPriceSeriesRef.current.createPriceLine !== 'function') return;

    let bid: number | null = null;
    let ask: number | null = null;

    if (tick) {
      if (tick.bid !== undefined && tick.bid !== null && !isNaN(Number(tick.bid)) && Number(tick.bid) > 0) {
        bid = Number(tick.bid);
      }
      if (tick.ask !== undefined && tick.ask !== null && !isNaN(Number(tick.ask)) && Number(tick.ask) > 0) {
        ask = Number(tick.ask);
      }
      const p = tick.price !== undefined && tick.price !== null ? Number(tick.price) : NaN;
      if (bid === null && !isNaN(p) && p > 0) {
        bid = ask !== null ? Math.min(ask, Number((p - 0.01).toFixed(2))) : Number((p - 0.01).toFixed(2));
      }
      if (ask === null && !isNaN(p) && p > 0) {
        ask = bid !== null ? Math.max(bid, Number((p + 0.01).toFixed(2))) : Number((p + 0.01).toFixed(2));
      }
    } else if (fallbackPrice !== null && !isNaN(Number(fallbackPrice)) && Number(fallbackPrice) > 0) {
      const fb = Number(fallbackPrice);
      bid = Number((fb - 0.01).toFixed(2));
      ask = Number((fb + 0.01).toFixed(2));
    }

    // Bid price line on y-axis
    if (bid !== null && bid > 0) {
      if (!bidPriceLineRef.current) {
        try {
          const line = initPriceSeriesRef.current.createPriceLine({
            price: bid,
            color: '#2196f3',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'Bid',
            axisLabelColor: '#2196f3',
            axisLabelTextColor: '#ffffff',
          });
          bidPriceLineRef.current = line || null;
        } catch (_) {}
      } else if (lastBidRef.current !== bid) {
        // Only when the value actually changes. applyOptions() marks the chart dirty and
        // schedules a repaint even when the price is identical, and this runs from the
        // per-frame store subscriber -- so an unguarded call repainted every chart at
        // 60fps for the whole replay with nothing moving.
        try {
          if (typeof bidPriceLineRef.current.applyOptions === 'function') {
            bidPriceLineRef.current.applyOptions({ price: bid });
          }
        } catch (_) {}
      }
      lastBidRef.current = bid;
    } else if (bidPriceLineRef.current) {
      try {
        if (typeof initPriceSeriesRef.current.removePriceLine === 'function') {
          initPriceSeriesRef.current.removePriceLine(bidPriceLineRef.current);
        }
      } catch (_) {}
      bidPriceLineRef.current = null;
      lastBidRef.current = null;
    }

    // Ask price line on y-axis
    if (ask !== null && ask > 0) {
      if (!askPriceLineRef.current) {
        try {
          const line = initPriceSeriesRef.current.createPriceLine({
            price: ask,
            color: '#ef5350',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'Ask',
            axisLabelColor: '#ef5350',
            axisLabelTextColor: '#ffffff',
          });
          askPriceLineRef.current = line || null;
        } catch (_) {}
      } else if (lastAskRef.current !== ask) {
        // Guarded for the same reason as the bid line above.
        try {
          if (typeof askPriceLineRef.current.applyOptions === 'function') {
            askPriceLineRef.current.applyOptions({ price: ask });
          }
        } catch (_) {}
      }
      lastAskRef.current = ask;
    } else if (askPriceLineRef.current) {
      try {
        if (typeof initPriceSeriesRef.current.removePriceLine === 'function') {
          initPriceSeriesRef.current.removePriceLine(askPriceLineRef.current);
        }
      } catch (_) {}
      askPriceLineRef.current = null;
      lastAskRef.current = null;
    }
  };

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
  // SEEK-BULK-01: set by the playback subscriber when it skips a multi-bucket seek batch. The
  // next snapshot rebuild must then use setData, not the incremental append path, which would
  // write one candle per bucket again.
  const forceFullRebuildRef = useRef(false);
  // Daily bar buckets, rebuilt once per session load instead of rescanned per tick.
  // See src/lib/dailyIndex.ts for the measurements that motivated this.
  const dailyIndexRef = useRef<DailyIndex | null>(null);
  
  const isDrawingModeRef = useRef(isDrawingMode);
  const currentTickerRef = useRef(ticker);

  useEffect(() => {
    isDrawingModeRef.current = isDrawingMode;
  }, [isDrawingMode]);

  useEffect(() => {
    currentTickerRef.current = ticker;
    setIsHydrated(false);
    cleanupBidAskPriceLines();
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
    cleanupBidAskPriceLines();
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

      const forceFullRebuild = forceFullRebuildRef.current;
      forceFullRebuildRef.current = false;

      let updatedIncrementally = false;

      // Incremental candle update:
      // When in same context, no history prepend, and we have a rendered last candle whose timestamp exists in formatted data
      if (isSameContext && !hasPendingPrepend && !forceFullRebuild && lastCandleRef.current && lastDataCountRef.current > 0) {
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

      const fallbackClose = lastCandleRef.current?.close ?? (chartData.length > 0 ? chartData[chartData.length - 1].close : null);
      updateBidAskPriceLines(lastConsumedTickRef.current, fallbackClose);

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
          if (timeframe === '1D' && !isRthBar(bar, ticker, timeframe)) continue;
          if (!showEth && !isRthBar(bar, ticker, timeframe)) continue;
          const barMs = isoToMs(bar.time);
          if (getBucketTime(barMs, timeframe) === bucketTime) {
            if (barMs + 60000 <= currentCutoffMs) {
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

    // SEEK-BULK-01: the epoch this subscriber last saw. Read on every call, including the early
    // returns below, so a seek made while paused is consumed by the paused rebuild and cannot
    // leak into a later playing frame.
    let seenSeekEpoch = usePlaybackStore.getState().seekEpoch;
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      const seekJumped = state.seekEpoch !== seenSeekEpoch;
      seenSeekEpoch = state.seekEpoch;
      // SEEK-REBUILD-01: An explicit playhead move (seek, step, scrub, time jump) is a
      // temporal *discontinuity*, not elapsed playback. Subscriber 6 cannot render a rewind
      // at all -- the monotonic `bucketTime < lastCandle.time` guard below drops every rewound
      // tick, leaving candles from *after* the playhead on the series -- so `useChartData`
      // now refreshes React state on `seekEpoch` and effect 3 rebuilds the series in bulk
      // from the authoritative snapshot. A seek that crosses more than one bucket skips the
      // catch-up entirely (SEEK-BULK-01, below). A single-bucket seek, or any playback frame,
      // still runs the catch-up, coalesced to one write per bucket by INGEST-06.
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

      // Update Live Bid & Ask Price Lines on y-axis
      updateBidAskPriceLines(latestTick, null);

      // Daily completed bars strictly use RTH ticks
      if (timeframe === '1D') {
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
            const isEligible = timeframe === '1D' ? isRthTick(t, ticker) : (showEth || isRthTick(t, ticker));
            if (isEligible) {
              newlyElapsedTicks.push(t);
            }
          }
        }
      }

      const minuteBoundaryCrossed = Boolean(
        lastConsumedTimeRef.current && state.currentTime &&
        Math.floor(state.currentTime / 60000) > Math.floor(lastConsumedTimeRef.current / 60000)
      );

      if (newlyElapsedTicks.length === 0) {
        if (latestTick && latestTick !== lastConsumedTickRef.current) {
          newlyElapsedTicks = [latestTick];
        } else if (timeframe === '1D' && minuteBoundaryCrossed && latestTick) {
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

      // SEEK-BULK-01: a seek that crosses more than one bucket is not played back. Writing it per
      // bucket costs O(buckets) primitive writes (about 12 for an hour on the 5-minute chart). The
      // seek already bumped seekEpoch, so useChartData refreshes the snapshot and effect 3 rebuilds
      // the series with one setData per series. Playback frames without a seek still take the
      // per-bucket path below, so a real stall still renders.
      if (seekJumped) {
        const bucketsSpanned = new Set(
          newlyElapsedTicks.map((t) => getBucketTime(getTickMs(t), timeframe))
        ).size;
        if (bucketsSpanned > 1) {
          forceFullRebuildRef.current = true;
          syntheticBucketVolumesRef.current = { bucketTime: -1, minutes: new Map() };
          return;
        }
      }

      // INGEST-06: Coalesce chart-primitive writes per candle bucket. Every branch below
      // merges the tick into its bucket's candle and then rewrites that candle, so a tape at
      // 20+ prints/second -- or any high speed multiplier, where one frame elapses seconds of
      // tape -- issues one candlestick write plus one volume write per tick for intermediate
      // states that are never visible. Queueing the write and flushing when the bucket changes
      // (or when the batch ends) produces identical final series content with O(buckets)
      // writes instead of O(ticks), which is what keeps a frame inside its 16ms budget.
      let queuedPrice: any = null;
      let queuedVolume: any = null;
      const queueUpdate = (bar: any, vol: any) => {
        if (queuedPrice !== null && queuedPrice.time !== bar.time) {
          initPriceSeriesRef.current!.update(queuedPrice);
          initVolumeSeriesRef.current!.update(queuedVolume);
        }
        queuedPrice = bar;
        queuedVolume = vol;
      };
      const flushQueuedUpdates = () => {
        if (queuedPrice === null) return;
        initPriceSeriesRef.current!.update(queuedPrice);
        initVolumeSeriesRef.current!.update(queuedVolume);
        queuedPrice = null;
        queuedVolume = null;
      };

      // SEEK-COST-01: memo for the daily-bucket aggregate. It depends on the bucket and the
      // evaluation time, not on the individual tick, so it is computed once per distinct pair.
      let dailyAggKey: string | null = null;
      let dailyAgg: DailyBucketAggregate | null = null;

      // Process newly elapsed ticks in order
      for (const tick of newlyElapsedTicks) {
        const tickTimeMs = getTickMs(tick);
        const bucketTime = getBucketTime(tickTimeMs, timeframe);
        const isSynthetic = Boolean((tick as any).isSynthesized);
        let tickVol = tick.volume !== undefined && tick.volume !== null ? tick.volume : 1.0;

        if (timeframe === '1D') {
          // LIVE-VOL-01: Unified daily chart policy for both real ticks and synthetic fallback
          const evalTimeMs = state.currentTime && state.currentTime > tickTimeMs ? state.currentTime : tickTimeMs;
          const aggKey = `${bucketTime}|${evalTimeMs}|${isSynthetic ? 1 : 0}`;
          if (dailyAgg === null || dailyAggKey !== aggKey) {
            dailyAgg = aggregateDailyBucket(
              dailyIndexRef, state.masterData || [], sym, ticker, bucketTime, evalTimeMs, isSynthetic, symbolTicks,
            );
            dailyAggKey = aggKey;
          }
          const agg: DailyBucketAggregate = dailyAgg;
          const { completedVol, firstBarOpen, foundAny } = agg;
          const { maxHigh, minLow, lastBarClose, formingMinuteVol } =
            applyDailyTickFallback(agg, tick, tickVol, symbolTicks, isSynthetic);

          const fallbackOpen = foundAny ? firstBarOpen! : tick.price;
          const totalVol = foundAny
            ? Number((completedVol + formingMinuteVol).toFixed(4))
            : (lastCandleRef.current && lastCandleRef.current.time === bucketTime
                ? Number((lastCandleRef.current.volume + tickVol).toFixed(4))
                : tickVol);

          const newCandle = {
            time: bucketTime,
            open: fallbackOpen,
            high: foundAny ? Math.max(fallbackOpen, maxHigh) : Math.max(fallbackOpen, tick.price),
            low: foundAny ? Math.min(fallbackOpen, minLow) : Math.min(fallbackOpen, tick.price),
            close: foundAny ? lastBarClose : tick.price,
            volume: totalVol,
          };

          if (!lastCandleRef.current || lastCandleRef.current.time !== bucketTime) {
            lastDataCountRef.current = (lastDataCountRef.current || 0) + 1;
            const cardEl = chartContainerRef.current?.closest('.chart-card');
            if (cardEl) {
              cardEl.setAttribute('data-bars-count', String(lastDataCountRef.current));
              const isoTime = new Date(bucketTime * 1000).toISOString().replace('T', ' ').slice(0, 19);
              cardEl.setAttribute('data-last-bar-time', isoTime);
            }
          }
          lastCandleRef.current = newCandle;

          queueUpdate(
            {
              time: bucketTime as any,
              open: newCandle.open,
              high: newCandle.high,
              low: newCandle.low,
              close: newCandle.close,
            },
            {
              time: bucketTime as any,
              value: newCandle.volume,
              color: newCandle.close >= newCandle.open
                ? (themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a')
                : (themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350'),
            }
          );
          continue;
        }

        const lastCandle = lastCandleRef.current;

        // INGEST-03: Create first candle if history was empty
        if (!lastCandle) {
          if (isSynthetic) {
            syntheticBucketVolumesRef.current = {
              bucketTime,
              minutes: new Map(tickVol > 0 ? [[Math.floor(tickTimeMs / 60000) * 60000, tickVol]] : []),
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

          queueUpdate(
            {
              time: bucketTime as any,
              open: firstCandle.open,
              high: firstCandle.high,
              low: firstCandle.low,
              close: firstCandle.close,
            },
            {
              time: bucketTime as any,
              value: firstCandle.volume,
              color: themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a',
            }
          );
          continue;
        }

        if (bucketTime < lastCandle.time) continue;

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

          queueUpdate(
            {
              time: bucketTime as any,
              open: lastCandle.open,
              high: lastCandle.high,
              low: lastCandle.low,
              close: lastCandle.close,
            },
            {
              time: bucketTime as any,
              value: lastCandle.volume,
              color: lastCandle.close >= lastCandle.open
                ? (themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a')
                : (themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.5)' : '#ef5350'),
            }
          );
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
          lastDataCountRef.current = (lastDataCountRef.current || 0) + 1;
          const cardEl = chartContainerRef.current?.closest('.chart-card');
          if (cardEl) {
            cardEl.setAttribute('data-bars-count', String(lastDataCountRef.current));
            const isoTime = new Date(bucketTime * 1000).toISOString().replace('T', ' ').slice(0, 19);
            cardEl.setAttribute('data-last-bar-time', isoTime);
          }

          queueUpdate(
            {
              time: bucketTime as any,
              open: newCandle.open,
              high: newCandle.high,
              low: newCandle.low,
              close: newCandle.close,
            },
            {
              time: bucketTime as any,
              value: newCandle.volume,
              color: themeRef.current === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#26a69a',
            }
          );
        }
      }

      flushQueuedUpdates();
    });

    return () => {
      unsubscribe();
      cleanupBidAskPriceLines();
    };
  }, [ticker, timeframe, showEth, initPriceSeriesRef.current, initVolumeSeriesRef.current]);

  // 7. Static/Paused Price Line for 1D chart (Extended Hours) & Live Bid/Ask Price Lines
  useEffect(() => {
    if (!initPriceSeriesRef.current) return;

    const unsub = usePlaybackStore.subscribe((state) => {
      if (!state.isPaused) return; // handled by direct tick subscriber during playback

      const sym = ticker.toUpperCase();
      const latestTick = state.latestTickBySymbol?.[sym] ||
        (state.currentTick?.symbol?.toUpperCase() === sym ? state.currentTick : null);
      let lastPrice = (latestTick && latestTick.price && latestTick.price > 0) ? latestTick.price : null;

      if (lastPrice === null && localMasterData.length > 0) {
        for (let i = localMasterData.length - 1; i >= 0; i--) {
          const barMs = new Date(localMasterData[i].time.replace(' ', 'T') + (localMasterData[i].time.includes('Z') ? '' : 'Z')).getTime();
          if (!state.currentTime || barMs <= state.currentTime) {
            lastPrice = localMasterData[i].close;
            break;
          }
        }
      }

      // Update Bid & Ask Price Lines on y-axis when paused or scrubbing
      updateBidAskPriceLines(latestTick, lastPrice);
    });

    return () => {
      unsub();
      cleanupBidAskPriceLines();
    };
  }, [timeframe, localMasterData, initPriceSeriesRef.current, ticker]);

  return {
    volumeSeriesRef: initVolumeSeriesRef,
    tradePluginRef,
    pluginVersion,
    isAtEnd,
    isViewModified,
    scrollToRealTime,
    resetView,
    isHydrated,
    bidPriceLineRef,
    askPriceLineRef,
  };
}
