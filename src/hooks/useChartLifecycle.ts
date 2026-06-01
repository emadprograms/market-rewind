import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, MouseEventParams, Time, TickMarkType, IPriceLine, CandlestickData } from 'lightweight-charts';
import type { ActiveTrade, ChartBar, DrawType, RawBar, RayDrawing, RectDrawing, RectPoint, TickerDrawings, Timeframe, HistoryPrependState } from '../types';
import { getTzForTicker } from '../lib/timezones';
import { SessionShadingPlugin } from '../lib/SessionShading';
import { VolumeProfilePlugin, VPDataBar } from '../lib/VolumeProfilePlugin';
import { HorizontalRayPlugin } from '../lib/HorizontalRayPlugin';
import { RectanglePlugin } from '../lib/RectanglePlugin';
import { TradePlugin } from '../lib/TradePlugin';
import { usePlaybackStore } from '../store/usePlaybackStore';

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
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const tradePluginRef = useRef<TradePlugin | null>(null);

  const shadingPluginRef = useRef<SessionShadingPlugin | null>(null);
  const vpPluginRef = useRef<VolumeProfilePlugin | null>(null);
  const rayPluginRef = useRef<HorizontalRayPlugin | null>(null);
  const rectPluginRef = useRef<RectanglePlugin | null>(null);

  const [isAtEnd, setIsAtEnd] = useState(true);
  const [chartUpdateTick, setChartUpdateTick] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  
  const lastDataCountRef = useRef(0);
  const lastBarSpacingRef = useRef<number | null>(null);
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

  const scrollToRealTime = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().scrollToRealTime();
    }
  }, [chartRef]);

  // 2. Initialize Charts
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const tz = getTzForTicker(ticker);

    chartRef.current = createChart(chartContainerRef.current, {
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

    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(() => {
        if (!chartRef.current) return;
        const ts = chartRef.current.timeScale();
        lastBarSpacingRef.current = ts.options().barSpacing;

        const logicalRange = ts.getVisibleLogicalRange();
        if (logicalRange) {
            const bars = priceSeriesRef.current?.data() || [];
            if (bars.length > 0) {
                const lastBarIndex = bars.length - 1;
                const newAtEnd = logicalRange.to >= lastBarIndex - 0.5;
                setIsAtEnd(prev => {
                    if (prev !== newAtEnd) return newAtEnd;
                    return prev;
                });
            }
        }
    });

    const isET = tz === 'America/New_York';

    priceSeriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });

    shadingPluginRef.current = new SessionShadingPlugin(timeframe, isET && showEth);
    priceSeriesRef.current.attachPrimitive(shadingPluginRef.current);

    vpPluginRef.current = new VolumeProfilePlugin();
    priceSeriesRef.current.attachPrimitive(vpPluginRef.current);

    rayPluginRef.current = new HorizontalRayPlugin();
    priceSeriesRef.current.attachPrimitive(rayPluginRef.current);
    
    rectPluginRef.current = new RectanglePlugin();
    priceSeriesRef.current.attachPrimitive(rectPluginRef.current);
    
    tradePluginRef.current = new TradePlugin();
    tradePluginRef.current.setBadgeRef(tradeBadgeRef);
    priceSeriesRef.current.attachPrimitive(tradePluginRef.current);
    
    rayPluginRef.current.setRays(drawings.rays || []);
    rectPluginRef.current.setRects(drawings.rects || []);
    
    chartRef.current.priceScale('right').applyOptions({
      scaleMargins: {
        top: 0.1,
        bottom: 0.25,
      },
    });

    volumeSeriesRef.current = chartRef.current.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    
    volumeSeriesRef.current.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      if (!chartRef.current) return;
      const newRect = entries[0].contentRect;
      chartRef.current.applyOptions({ width: newRect.width, height: newRect.height });
      setChartUpdateTick(t => t + 1);
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Drawing Click/DblClick/MouseMove Handlers
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !chartRef.current || !priceSeriesRef.current) return;

    const chart = chartRef.current;
    const series = priceSeriesRef.current;

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
    if (!chartRef.current) return;
    const tz = getTzForTicker(ticker);
    chartRef.current.applyOptions({
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

  // Update Ray/Rect Plugins when synced drawings change
  useEffect(() => {
    if (rayPluginRef.current && rectPluginRef.current) {
        rayPluginRef.current.setRays(drawings.rays || []);
        rectPluginRef.current.setRects(drawings.rects || []);
    }
  }, [drawings]);

  // Update effect for ghost rectangle
  useEffect(() => {
    if (rectPluginRef.current && rectAnchor && ghostPoint) {
      rectPluginRef.current.setRects([...(drawings.rects || []), { p1: rectAnchor, p2: ghostPoint }]);
    } else if (rectPluginRef.current) {
        rectPluginRef.current.setRects(drawings.rects || []);
    }
  }, [rectAnchor, ghostPoint, drawings.rects]);

  // Update VP Enabled State
  useEffect(() => {
      if (vpPluginRef.current) {
          vpPluginRef.current.setEnabled(showVP);
      }
  }, [showVP]);

  // 3. Update Chart Data
  useEffect(() => {
    if (priceSeriesRef.current && volumeSeriesRef.current && chartRef.current && chartData.length > 0) {
      const formatted: VPDataBar[] = chartData.map(d => {
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
      const ts = chartRef.current.timeScale();
      const oldLogicalRange = ts.getVisibleLogicalRange();

      if (isSameContext && oldLogicalRange) {
        priceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
          time, open, high, low, close
        })));
        volumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
          time, value: volume, color: close >= open ? '#26a69a' : '#ef5350'
        })));

        chartRef.current.priceScale('right').applyOptions({ autoScale: true });

        const wasAtEnd = oldLogicalRange.to >= lastDataCountRef.current - 0.5;

        if (wasAtEnd) {
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
        priceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
          time, open, high, low, close
        })));

        volumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
          time,
          value: volume,
          color: close >= open ? '#26a69a' : '#ef5350'
        })));

        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        
        requestAnimationFrame(() => {
          setIsHydrated(true);
        });

        const total = formatted.length;
        if (total > 0) {
          if (pendingHistoryPrependRef.current) {
              const { oldFirstTime, oldLogicalRange } = pendingHistoryPrependRef.current;
              const newFirstIndex = formatted.findIndex(d => d.time === oldFirstTime);
              
              if (newFirstIndex > 0 && oldLogicalRange) {
                  chartRef.current.timeScale().setVisibleLogicalRange({
                      from: oldLogicalRange.from + newFirstIndex,
                      to: oldLogicalRange.to + newFirstIndex
                  });
              }
              pendingHistoryPrependRef.current = null;
          } else {
              setTimeout(() => {
                if (!chartRef.current) return;
                chartRef.current.timeScale().scrollToRealTime();
              }, 80);
          }
        }
      }

      lastDataCountRef.current = formatted.length;
      lastTickerRef.current = ticker;
      lastTfRef.current = timeframe;
      lastEthRef.current = showEth;

    } else if (priceSeriesRef.current && volumeSeriesRef.current) {
        priceSeriesRef.current.setData([]);
        volumeSeriesRef.current.setData([]);
        lastDataCountRef.current = 0;
    }

  }, [chartData, isReplayMode, isLoadingHistory]);

  // 3b. Refresh shading plugin when ticker/timeframe/ETH changes
  useEffect(() => {
    if (shadingPluginRef.current) {
        const tz = getTzForTicker(ticker);
        const isET = tz === 'America/New_York';
        shadingPluginRef.current.setConfig(timeframe, isET && showEth);
    }
  }, [ticker, timeframe, showEth]);

  // 4. Live Price Line for 1D chart (Extended Hours)
  useEffect(() => {
    if (!priceSeriesRef.current) return;

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
          priceLineRef.current = priceSeriesRef.current.createPriceLine({
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
    } else if (priceLineRef.current && priceSeriesRef.current) {
      priceSeriesRef.current.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    
    return () => {
      if (priceLineRef.current && priceSeriesRef.current) {
        try {
          priceSeriesRef.current.removePriceLine(priceLineRef.current);
          priceLineRef.current = null;
        } catch(_) {}
      }
    };
  }, [globalTime, timeframe, ticker, localMasterData]);

  return {
    volumeSeriesRef,
    tradePluginRef,
    isAtEnd,
    scrollToRealTime,
    isHydrated,
  };
}
