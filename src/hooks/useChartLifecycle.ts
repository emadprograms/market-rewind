import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi, MouseEventParams, Time, TickMarkType, IPriceLine } from 'lightweight-charts';
import type { ActiveTrade, ChartBar, DrawType, RawBar, RayDrawing, RectDrawing, RectPoint, TickerDrawings, Timeframe, HistoryPrependState } from '../types';
import { getTzForTicker } from '../lib/timezones';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { useChartInit } from './chart/useChartInit';
import { useChartPlugins } from './chart/useChartPlugins';
import { useChartDrawings } from './chart/useChartDrawings';
import { useChartViewport } from './chart/useChartViewport';


interface UseChartLifecycleParams {
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  ticker: string;
  timeframe: Timeframe;
  showEth: boolean;
  showVP: boolean;
  chartData: ChartBar[];
  localMasterData: RawBar[];
  isReplayMode: boolean;
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
  activeTrade: ActiveTrade | null;
  tradeBadgeRef: React.RefObject<HTMLDivElement | null>;
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
  chartData,
  localMasterData,
  isReplayMode,
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
  activeTrade,
  tradeBadgeRef,
  chartRef,
  priceSeriesRef,
  onFocus,
}: UseChartLifecycleParams) {
  const globalTime = usePlaybackStore((state) => state.currentTime);
  
  const { 
    chartRef: initChartRef, 
    priceSeriesRef: initPriceSeriesRef, 
    volumeSeriesRef: initVolumeSeriesRef, 
    lastBarSpacingRef: initLastBarSpacingRef 
  } = useChartInit({
    chartContainerRef,
    ticker,
    timeframe,
    onAtEndChange: useCallback((atEnd: boolean) => setIsAtEnd(atEnd), []),
  });

  const {
    shadingPluginRef,
    vpPluginRef,
    rayPluginRef,
    rectPluginRef,
    tradePluginRef,
    updateShadingConfig,
  } = useChartPlugins({
    priceSeriesRef: initPriceSeriesRef,
    timeframe,
    showEth,
    showVP,
    drawings,
    tradeBadgeRef,
  });

  const {
    syncViewport,
    checkAutoReveal,
    scrollToRealTime,
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

  const [isAtEnd, setIsAtEnd] = useState(true);
  const [chartUpdateTick, setChartUpdateTick] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  
  // The AUTO_REVEAL_THRESHOLD is now inside useChartViewport


  useEffect(() => {
    chartRef.current = initChartRef.current;
    priceSeriesRef.current = initPriceSeriesRef.current;
  }, [initChartRef.current, initPriceSeriesRef.current, chartRef, priceSeriesRef]);

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
    console.log(`[StabilityTrace] ScrollEffect: isHydrated=${isHydrated}, dataLength=${chartData.length}`);
    if (isHydrated && chartData.length > 0) {
      console.log(`[StabilityTrace] Triggering scrollToRealTime`);
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

  // 3. Update Chart Data
  useEffect(() => {
    if (initPriceSeriesRef.current && initVolumeSeriesRef.current && initChartRef.current && chartData.length > 0) {
      const startUpdate = performance.now();
      const formatted: any[] = chartData.map(d => {
        const isoString = d.time.replace(' ', 'T') + 'Z';
        return {
          time: Math.floor(new Date(isoString).getTime() / 1000) as Time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
        };
      });

      if (vpPluginRef.current) {
          vpPluginRef.current.setData(formatted);
      }

      const isSameContext = lastTickerRef.current === ticker && 
                            lastTfRef.current === timeframe && 
                            lastEthRef.current === showEth;
      
      // Use incremental update() when context is unchanged and bars are only added/appended.
      // This avoids the full setData() call that causes visible chart jitter/flicker.
      // Must NOT use incremental path for history prepends — update() can only append, not prepend.
      const hasPendingPrepend = pendingHistoryPrependRef.current !== null;
      const canIncrement = isSameContext && formatted.length >= lastDataCountRef.current && lastDataCountRef.current > 0 && !hasPendingPrepend;

      // Capture viewport range BEFORE any data mutation for accurate sync
      const capturedRange = initChartRef.current.timeScale().getVisibleLogicalRange();

      if (canIncrement) {
        const prevCount = lastDataCountRef.current;
        // Update the last existing bar (it may have been the partial edge bar last time)
        if (prevCount > 0) {
          const lastBar = formatted[prevCount - 1];
          initPriceSeriesRef.current.update({ time: lastBar.time, open: lastBar.open, high: lastBar.high, low: lastBar.low, close: lastBar.close });
          initVolumeSeriesRef.current.update({ time: lastBar.time, value: lastBar.volume, color: lastBar.close >= lastBar.open ? '#26a69a' : '#ef5350' });
        }
        // Append any new bars beyond what was previously shown
        for (let i = prevCount; i < formatted.length; i++) {
          const bar = formatted[i];
          initPriceSeriesRef.current.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
          initVolumeSeriesRef.current.update({ time: bar.time, value: bar.volume, color: bar.close >= bar.open ? '#26a69a' : '#ef5350' });
        }
      } else {
        // Full setData for context changes (ticker, timeframe, ETH toggle, or history prepend)
        initPriceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
          time, open, high, low, close
        })));
        initVolumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
          time, value: volume, color: close >= open ? '#26a69a' : '#ef5350'
        })));
      }

      initChartRef.current.priceScale('right').applyOptions({ autoScale: true });
      
      if (isSameContext && formatted.length > lastDataCountRef.current) {
        requestAnimationFrame(() => {
          syncViewport(isSameContext, capturedRange);
        });
      }

      lastTickerRef.current = ticker;
      lastTfRef.current = timeframe;
      lastEthRef.current = showEth;
      lastDataCountRef.current = formatted.length;

      if (!isHydrated) {
        requestAnimationFrame(() => {
          setIsHydrated(true);
        });
      }

      } else if (initPriceSeriesRef.current && initVolumeSeriesRef.current) {
        initPriceSeriesRef.current.setData([]);
        initVolumeSeriesRef.current.setData([]);
    }

  }, [chartData, isReplayMode, isLoadingHistory, syncViewport]);

  // 3b. Refresh shading plugin when ticker/timeframe/ETH changes
  useEffect(() => {
    const tz = getTzForTicker(ticker);
    const isET = tz === 'America/New_York';
    updateShadingConfig(isET);
  }, [ticker, timeframe, showEth, updateShadingConfig]);

  // 4. Auto-Reveal Logic during Replay
  useEffect(() => {
    if (!isReplayMode || !initChartRef.current || !initPriceSeriesRef.current) return;

    checkAutoReveal();
  }, [globalTime, isReplayMode, checkAutoReveal]);

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

  // 6. Live Price Line for 1D chart (Extended Hours)
  useEffect(() => {
    if (!initPriceSeriesRef.current) return;

    if (timeframe === '1D' && globalTime && localMasterData.length > 0) {
      let lastPrice = null;

      for (let i = localMasterData.length - 1; i >= 0; i--) {
        const barMs = new Date(localMasterData[i].time.replace(' ', 'T') + 'Z').getTime();
        if (barMs <= globalTime) {
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
    } else if (priceLineRef.current && initPriceSeriesRef.current) {
      initPriceSeriesRef.current.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    
    return () => {
      if (priceLineRef.current && initPriceSeriesRef.current) {
        try {
          initPriceSeriesRef.current.removePriceLine(priceLineRef.current);
          priceLineRef.current = null;
        } catch(_) {}
      }
    };
  }, [globalTime, timeframe, ticker, localMasterData]);

  return {
    volumeSeriesRef: initVolumeSeriesRef,
    tradePluginRef,
    isAtEnd,
    scrollToRealTime,
    isHydrated,
  };
}
