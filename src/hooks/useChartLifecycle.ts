import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IChartApi, ISeriesApi, MouseEventParams, Time, TickMarkType, IPriceLine } from 'lightweight-charts';
import type { ActiveTrade, ChartBar, DrawType, RawBar, RayDrawing, RectDrawing, RectPoint, TickerDrawings, Timeframe, HistoryPrependState } from '../types';
import { getTzForTicker } from '../lib/timezones';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { useChartInit } from './chart/useChartInit';
import { useChartPlugins } from './chart/useChartPlugins';

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
    onAtEndChange: (atEnd) => setIsAtEnd(atEnd),
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

  const [isAtEnd, setIsAtEnd] = useState(true);
  const [chartUpdateTick, setChartUpdateTick] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  
  const AUTO_REVEAL_THRESHOLD = 10;

  useEffect(() => {
    chartRef.current = initChartRef.current;
    priceSeriesRef.current = initPriceSeriesRef.current;
  }, [initChartRef.current, initPriceSeriesRef.current, chartRef, priceSeriesRef]);

  const scrollToRealTime = useCallback(() => {
    if (initChartRef.current) {
      initChartRef.current.timeScale().scrollToRealTime();
    }
  }, []);

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

  // Drawing Click/DblClick/MouseMove Handlers
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !initChartRef.current || !initPriceSeriesRef.current) return;

    const chart = initChartRef.current;
    const series = initPriceSeriesRef.current;

    const handleClick = (param: MouseEventParams<Time>) => {
      if (!isDrawingModeRef.current || !param.point || !param.time) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price === null || price === undefined) return;

      if (drawType === 'ray') {
        onUpdateDrawings(currentTickerRef.current, 'rays', [...(drawings.rays || []), { price, time: param.time }]);
      } else if (drawType === 'rect') {
        if (!rectAnchor) {
          setRectAnchor({ price, time: param.time });
        } else {
          onUpdateDrawings(currentTickerRef.current, 'rects', [...(drawings.rects || []), { p1: rectAnchor, p2: { price, time: param.time } }]);
          setRectAnchor(null);
        }
      }
    };

    const handleMouseMove = (param: MouseEventParams<Time>) => {
      if (!isDrawingModeRef.current || !rectAnchor || !param.point || !param.time) {
        if (ghostPoint) setGhostPoint(null);
        return;
      }
      const price = series.coordinateToPrice(param.point.y);
      if (price !== null) {
        setGhostPoint({ price, time: param.time });
      }
    };

    const handleDblClick = (param: MouseEventParams<Time>) => {
      if (!param.point || !param.time) return;
      const clickPrice = series.coordinateToPrice(param.point.y);
      if (clickPrice === null || clickPrice === undefined) return;

      let nearestIdx = -1;
      let nearestDist = Infinity;
      (drawings.rays || []).forEach((entry, idx) => {
        const dist = Math.abs(entry.price - clickPrice);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = idx;
        }
      });

      if (nearestIdx !== -1) {
        const ray = drawings.rays[nearestIdx];
        const rayY = series.priceToCoordinate(ray.price);
        const rayX = chart.timeScale().timeToCoordinate(ray.time as Time);
        if (rayY !== null && Math.abs(rayY - param.point.y) < 10 && (param.point.x >= (rayX || 0) - 5)) { 
          const newRays = [...drawings.rays];
          newRays.splice(nearestIdx, 1);
          onUpdateDrawings(currentTickerRef.current, 'rays', newRays);
          return;
        }
      }

      let rectToDelete = -1;
      (drawings.rects || []).forEach((rect, idx) => {
          const y1 = series.priceToCoordinate(rect.p1.price);
          const y2 = series.priceToCoordinate(rect.p2.price);
          const x1 = chart.timeScale().timeToCoordinate(rect.p1.time as Time);
          const x2 = chart.timeScale().timeToCoordinate(rect.p2.time as Time);
          
          if (y1 === null || y2 === null) return;
          
          const top = Math.min(y1, y2);
          const bottom = Math.max(y1, y2);
          const xStart = x1 === null ? -100 : x1;
          const xEnd = x2 === null ? chart.timeScale().width() + 100 : x2;
          const left = Math.min(xStart, xEnd);
          const right = Math.max(xStart, xEnd);

          if (param.point && param.point.y >= top - 5 && param.point.y <= bottom + 5 &&
              param.point.x >= left - 5 && param.point.x <= right + 5) {
              rectToDelete = idx;
          }
      });

      if (rectToDelete !== -1) {
          const newRects = [...drawings.rects];
          newRects.splice(rectToDelete, 1);
          onUpdateDrawings(currentTickerRef.current, 'rects', newRects);
      }
    };

    chart.subscribeClick(handleClick);
    chart.subscribeCrosshairMove(handleMouseMove);
    chart.subscribeDblClick(handleDblClick);

    return () => {
      try {
        chart.unsubscribeClick(handleClick);
        chart.unsubscribeCrosshairMove(handleMouseMove);
        chart.unsubscribeDblClick(handleDblClick);
      } catch(_) {}
    };
  }, [drawings, drawType, rectAnchor]);

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
      console.log(`[StabilityTrace] isSameContext: ${isSameContext}, dataLength: ${formatted.length}`);
      const ts = initChartRef.current.timeScale();
      const oldLogicalRange = ts.getVisibleLogicalRange();

      if (isSameContext && oldLogicalRange) {
        initPriceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
          time, open, high, low, close
        })));
        initVolumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
          time, value: volume, color: close >= open ? '#26a69a' : '#ef5350'
        })));

        initChartRef.current.priceScale('right').applyOptions({ autoScale: true });

        const wasAtEnd = oldLogicalRange.to >= lastDataCountRef.current - 0.5;

        if (pendingHistoryPrependRef.current) {
          // Prepend takes precedence over end-of-chart shift
          const { oldFirstTime, oldLogicalRange: prependRange } = pendingHistoryPrependRef.current;
          
          if (oldFirstTime === null) {
            pendingHistoryPrependRef.current = null;
            ts.setVisibleLogicalRange(oldLogicalRange);
            return;
          }

          const newFirstIndex = formatted.findIndex(d => d.time === oldFirstTime);
          console.log(`[StabilityTrace] Prepend detected. oldFirstTime: ${oldFirstTime}, newFirstIndex: ${newFirstIndex}`);
          
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
          const shift = formatted.length - lastDataCountRef.current;
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

      } else {
        initPriceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
          time, open, high, low, close
        })));

        initVolumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
          time,
          value: volume,
          color: close >= open ? '#26a69a' : '#ef5350'
        })));

        initChartRef.current.priceScale('right').applyOptions({ autoScale: true });
        
        if (pendingHistoryPrependRef.current) {
            const { oldFirstTime, oldLogicalRange: prependRange } = pendingHistoryPrependRef.current;
            const newFirstIndex = formatted.findIndex(d => d.time === oldFirstTime);
            
            if (newFirstIndex > 0 && prependRange) {
                ts.setVisibleLogicalRange({
                    from: prependRange.from + newFirstIndex,
                    to: prependRange.to + newFirstIndex
                });
            }
            pendingHistoryPrependRef.current = null;
        }
      }

      lastDataCountRef.current = formatted.length;
      lastTickerRef.current = ticker;
      lastTfRef.current = timeframe;
      lastEthRef.current = showEth;

      if (!isHydrated) {
        console.log(`[StabilityTrace] Triggering Hydration`);
        requestAnimationFrame(() => {
          console.log(`[StabilityTrace] Hydration state updating to true`);
          setIsHydrated(true);
        });
      }

      } else if (initPriceSeriesRef.current && initVolumeSeriesRef.current) {
        initPriceSeriesRef.current.setData([]);
        initVolumeSeriesRef.current.setData([]);
        lastDataCountRef.current = 0;
    }

  }, [chartData, isReplayMode, isLoadingHistory]);

  // 3b. Refresh shading plugin when ticker/timeframe/ETH changes
  useEffect(() => {
    const tz = getTzForTicker(ticker);
    const isET = tz === 'America/New_York';
    updateShadingConfig(isET);
  }, [ticker, timeframe, showEth, updateShadingConfig]);

  // 4. Auto-Reveal Logic during Replay
  useEffect(() => {
    if (!isReplayMode || !initChartRef.current || !initPriceSeriesRef.current) return;

    const ts = initChartRef.current.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;

    const data = initPriceSeriesRef.current.data();
    const dataEnd = data.length - 1;
    
    // If viewport right edge is within threshold of data end, reveal new bars
    if (range.to >= dataEnd - AUTO_REVEAL_THRESHOLD) {
      scrollToRealTime();
    }
  }, [globalTime, isReplayMode, scrollToRealTime]);

  // 5. Live Price Line for 1D chart (Extended Hours)
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
