import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import { resampleData } from '../lib/resampling';
import { Maximize2, Minimize2, Search, ChevronDown, Clock, ChevronRight } from 'lucide-react';
import { fetchMarketData } from '../lib/db';
import { getTzForTicker } from '../lib/timezones';
import { SessionShadingPlugin } from '../lib/SessionShading';
import { VolumeProfilePlugin } from '../lib/VolumeProfilePlugin';
import { HorizontalRayPlugin } from '../lib/HorizontalRayPlugin';
import { RectanglePlugin } from '../lib/RectanglePlugin';

export default function ChartUnit({ 
  id, 
  globalTime, 
  selectedDate,
  isReplayMode, 
  tickers, 
  initialTicker, 
  initialTf,
  initialEth,
  onToggleMaximize,
  isMaximized,
  allDrawings = {},
  onUpdateDrawings,
  onTimeframeChange
}) {
  const chartContainerRef = useRef();
  
  const chartRef = useRef();
  const priceSeriesRef = useRef();
  const volumeSeriesRef = useRef();
  const lastDataCountRef = useRef(0);
  const shadingPluginRef = useRef(null);
  const vpPluginRef = useRef(null);
  const rayPluginRef = useRef(null);
  const rectPluginRef = useRef(null);
  
  const [ticker, setTicker] = useState(initialTicker || tickers[0]);
  const [localMasterData, setLocalMasterData] = useState([]);
  const [timeframe, setTimeframe] = useState(initialTf || '1D');
  const [showEth, setShowEth] = useState(initialEth || false);
  const [showVP, setShowVP] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawType, setDrawType] = useState('ray'); // 'ray' | 'rect'
  const [rectAnchor, setRectAnchor] = useState(null); // {price, time}
  const [ghostPoint, setGhostPoint] = useState(null); // {price, time} for rect preview
  const [isAtEnd, setIsAtEnd] = useState(true);
  const lastBarSpacingRef = useRef(null);
  const priceLineRef = useRef(null);
  const lastTickerRef = useRef(ticker);
  const lastTfRef = useRef(timeframe);



  const drawings = allDrawings[ticker] || { rays: [], rects: [] };

  // Custom UI State
  const [isTickerOpen, setIsTickerOpen] = useState(false);
  const [isTfOpen, setIsTfOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState('');
  
  const tickerRef = useRef();
  const tfRef = useRef();
  const isDrawingModeRef = useRef(false);
  const currentTickerRef = useRef(ticker);

  useEffect(() => {
    currentTickerRef.current = ticker;
  }, [ticker]);

  // Click outside detection
  useEffect(() => {
    const handleClick = (e) => {
      if (tickerRef.current && !tickerRef.current.contains(e.target)) setIsTickerOpen(false);
      if (tfRef.current && !tfRef.current.contains(e.target)) setIsTfOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, []);

  // Report timeframe to parent for unified replay step calculation
  useEffect(() => {
    if (onTimeframeChange) onTimeframeChange(id, timeframe);
  }, [timeframe]);

  // 0. Fetch local master data
  useEffect(() => {
    async function load() {
      const data = await fetchMarketData(ticker, selectedDate);
      setLocalMasterData(data);
    }
    load();
  }, [ticker, selectedDate]);

  // 1. Prepare data — filter raw bars by globalTime FIRST, then resample.
  // This ensures higher-timeframe candles (1D, 1H) progressively build during replay.
  const chartData = useMemo(() => {
    if (!localMasterData || localMasterData.length === 0) return [];
    let filtered = (showEth && timeframe !== '1D') ? localMasterData : localMasterData.filter(d => d.session === 'REG');
    
    // In replay mode, trim raw 1-min bars to only those that have "happened"
    if (isReplayMode && globalTime) {
      const gt = new Date(globalTime).getTime();
      filtered = filtered.filter(d => new Date(d.time).getTime() <= gt);
    }
    
    return resampleData(filtered, timeframe);
  }, [localMasterData, timeframe, showEth, isReplayMode, globalTime]);

  // 2. Initialize Charts
  useEffect(() => {
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
        timeFormatter: (time) => {
          const date = new Date(time * 1000);
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
        tickMarkFormatter: (time, tickMarkType) => {
          const date = new Date(time * 1000);
          if (tickMarkType <= 2) return date.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
          return date.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
        }
      },
      handleScroll: true,
      handleScale: true,
    });

    // Subscribe to zoom/scroll to persist width
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(() => {
        if (!chartRef.current) return;
        const ts = chartRef.current.timeScale();
        lastBarSpacingRef.current = ts.options().barSpacing;

        // Determine if we are at the end (allow 1 bar margin)
        const logicalRange = ts.getVisibleLogicalRange();
        if (logicalRange) {
            const bars = priceSeriesRef.current?.data() || [];
            if (bars.length > 0) {
                const lastBarIndex = bars.length - 1;
                // logicalRange.to is the index of the right edge bar + 0.5 (usually)
                // If the right edge is near the last bar, we're at the end.
                setIsAtEnd(logicalRange.to >= lastBarIndex - 0.5);
            }
        }
    });

    const isET = tz === 'America/New_York';


    priceSeriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });

    // Attach Shading Plugin
    shadingPluginRef.current = new SessionShadingPlugin(timeframe, isET && showEth);
    priceSeriesRef.current.attachPrimitive(shadingPluginRef.current);

    // Attach Volume Profile Plugin
    vpPluginRef.current = new VolumeProfilePlugin();
    priceSeriesRef.current.attachPrimitive(vpPluginRef.current);

    // Attach Horizontal Ray Plugin
    rayPluginRef.current = new HorizontalRayPlugin();
    priceSeriesRef.current.attachPrimitive(rayPluginRef.current);
    
    // Attach Rectangle Plugin
    rectPluginRef.current = new RectanglePlugin();
    priceSeriesRef.current.attachPrimitive(rectPluginRef.current);
    
    // Initial sync
    rayPluginRef.current.setRays(drawings.rays);
    rectPluginRef.current.setRects(drawings.rects);
    
    // Ensure Candlesticks don't overlap the bottom volume
    chartRef.current.priceScale('right').applyOptions({
      scaleMargins: {
        top: 0.1,
        bottom: 0.25, // Leaves the bottom 25% empty
      },
    });

    volumeSeriesRef.current = chartRef.current.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '', // Overlay on the same chart, different axis
    });
    
    // Lock volume to the bottom 20% of the chart
    volumeSeriesRef.current.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // Start at 80% down
        bottom: 0,
      },
    });

    // Replace window resize with a localized ResizeObserver
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      chartRef.current.applyOptions({ width: newRect.width, height: newRect.height });
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      chartRef.current.remove();
    };
  }, []);

  // Keep ref in sync with state for event handlers
  useEffect(() => {
    isDrawingModeRef.current = isDrawingMode;
  }, [isDrawingMode]);

  // Horizontal Ray Drawing: Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only respond if this chart's container or its children are focused/hovered
      const container = chartContainerRef.current;
      if (!container) return;
      const isHovered = container.matches(':hover') || container.contains(document.activeElement);

      if (e.key === 'h' || e.key === 'H') {
        if (isHovered) {
          e.preventDefault();
          setDrawType('ray');
          setIsDrawingMode(prev => !prev || drawType !== 'ray');
          setRectAnchor(null);
        }
      }
      if (e.key === 'r' || e.key === 'R') {
        if (isHovered) {
          e.preventDefault();
          setDrawType('rect');
          setIsDrawingMode(prev => !prev || drawType !== 'rect');
          setRectAnchor(null);
        }
      }
      if (e.key === 'Escape') {
        setIsDrawingMode(false);
        setRectAnchor(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && isHovered) {
        // Clear all drawings on this ticker
        onUpdateDrawings(currentTickerRef.current, 'rays', []);
        onUpdateDrawings(currentTickerRef.current, 'rects', []);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Horizontal Ray Drawing: Click to place, double-click to delete
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !chartRef.current || !priceSeriesRef.current) return;

    const chart = chartRef.current;
    const series = priceSeriesRef.current;

    const handleClick = (param) => {
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

    const handleMouseMove = (param) => {
      if (!isDrawingModeRef.current || !rectAnchor || !param.point || !param.time) {
        if (ghostPoint) setGhostPoint(null);
        return;
      }
      const price = series.coordinateToPrice(param.point.y);
      if (price !== null) {
        setGhostPoint({ price, time: param.time });
      }
    };

    const handleDblClick = (param) => {
      if (!param.point || !param.time) return;
      const clickPrice = series.coordinateToPrice(param.point.y);
      if (clickPrice === null || clickPrice === undefined) return;

      // 1. Check Rays
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
        const rayX = chart.timeScale().timeToCoordinate(ray.time);
        if (rayY !== null && Math.abs(rayY - param.point.y) < 10 && (param.point.x >= (rayX || 0) - 5)) { 
          const newRays = [...drawings.rays];
          newRays.splice(nearestIdx, 1);
          onUpdateDrawings(currentTickerRef.current, 'rays', newRays);
          return; // Deleted ray, skip rect check
        }
      }

      // 2. Check Rects
      let rectToDelete = -1;
      (drawings.rects || []).forEach((rect, idx) => {
          const y1 = series.priceToCoordinate(rect.p1.price);
          const y2 = series.priceToCoordinate(rect.p2.price);
          const x1 = chart.timeScale().timeToCoordinate(rect.p1.time);
          const x2 = chart.timeScale().timeToCoordinate(rect.p2.time);
          
          if (y1 === null || y2 === null) return;
          
          const top = Math.min(y1, y2);
          const bottom = Math.max(y1, y2);
          const xStart = x1 === null ? -100 : x1;
          const xEnd = x2 === null ? chart.timeScale().width() + 100 : x2;
          const left = Math.min(xStart, xEnd);
          const right = Math.max(xStart, xEnd);

          if (param.point.y >= top - 5 && param.point.y <= bottom + 5 &&
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
        timeFormatter: (time) => {
          const date = new Date(time * 1000);
          if (timeframe === '1D') {
            return date.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
          }
          return date.toLocaleString('en-US', { timeZone: tz, hour12: false, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
      },
      timeScale: {
        timeVisible: timeframe !== '1D',
        tickMarkFormatter: (time, tickMarkType) => {
          const date = new Date(time * 1000);
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
    if (priceSeriesRef.current && volumeSeriesRef.current && chartData.length > 0) {
      const formatted = chartData.map(d => {
        const isoString = d.time.replace(' ', 'T') + 'Z';
        return {
          time: Math.floor(new Date(isoString).getTime() / 1000),
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

      // Incremental update if same ticker/timeframe AND (new bar added OR same bar updated)
      const isSameContext = lastTickerRef.current === ticker && lastTfRef.current === timeframe;
      const ts = chartRef.current.timeScale();
      const oldLogicalRange = ts.getVisibleLogicalRange();

      if (isSameContext && oldLogicalRange) {
        // Replay step: preserve the view
        priceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
          time, open, high, low, close
        })));
        volumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
          time, value: volume, color: close >= open ? '#26a69a' : '#ef5350'
        })));

        chartRef.current.priceScale('right').applyOptions({ autoScale: true });

        const wasAtEnd = oldLogicalRange.to >= lastDataCountRef.current - 0.5;

        if (wasAtEnd) {
          // If we were at the end, shift to keep the edge visible
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
          // If scrolled back, stay frozen on the same bars
          ts.setVisibleLogicalRange(oldLogicalRange);
        }

      } else {
        // Full reset (e.g. timeframe change or symbol change)
        const isUpdate = lastDataCountRef.current > 0;
        let targetTimeToRestore = null;

        
        if (isUpdate && chartRef.current && priceSeriesRef.current && oldLogicalRange) {
            const oldData = priceSeriesRef.current.data();
            if (oldData && oldData.length > 0) {
                const barsToRight = oldData.length - 1 - oldLogicalRange.to;
                // If the right edge was visible or very close, stick to the end

                    if (barsToRight < 2) {
                        targetTimeToRestore = oldData[oldData.length - 1].time;
                    } else {
                        const midIndex = Math.floor((oldLogicalRange.from + oldLogicalRange.to) / 2);
                        const safeIndex = Math.max(0, Math.min(oldData.length - 1, midIndex));
                        if (oldData[safeIndex]) {
                            targetTimeToRestore = oldData[safeIndex].time;
                        }
                    }
                }
            }
        }

        priceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
          time, open, high, low, close
        })));

        volumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
          time,
          value: volume,
          color: close >= open ? '#26a69a' : '#ef5350'
        })));

        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        
        const total = formatted.length;
        if (total > 0) {
          setTimeout(() => {
            if (!chartRef.current) return;
            
            const zoomMap = {
              '1min': 120,
              '5min': 78,
              '15min': 60,
              '30min': 50,
              '1H': 60,
              '1D': 50
            };

            if (lastBarSpacingRef.current === null) {

              lastBarSpacingRef.current = zoomMap[timeframe] 
                ? chartContainerRef.current.clientWidth / zoomMap[timeframe] 
                : 6;
            }

            const count = chartContainerRef.current.clientWidth / lastBarSpacingRef.current;
            
            if (targetTimeToRestore !== null) {
                let midIdx = formatted.findIndex(d => d.time >= targetTimeToRestore);
                if (midIdx === -1) midIdx = total - 1;
                
                let fromIndex = midIdx - Math.floor(count / 2);
                let toIndex = fromIndex + count;
                
                if (toIndex >= total) {
                    toIndex = total; // can go slightly past the edge for padding
                    fromIndex = Math.max(0, toIndex - count);
                } else if (fromIndex < 0) {
                    fromIndex = 0;
                    toIndex = Math.min(total, count);
                }

                chartRef.current.timeScale().setVisibleLogicalRange({
                    from: fromIndex,
                    to: toIndex
                });
            } else {
                chartRef.current.timeScale().setVisibleLogicalRange({
                  from: total - count,
                  to: total
                });
            }
          }, 80);

        }
      }

      lastDataCountRef.current = formatted.length;
      lastTickerRef.current = ticker;
      lastTfRef.current = timeframe;

    } else if (priceSeriesRef.current) {
        priceSeriesRef.current.setData([]);
        volumeSeriesRef.current.setData([]);
        lastDataCountRef.current = 0;
    }

  }, [chartData, isReplayMode]);

  // 3b. Refresh shading plugin when ticker/timeframe/ETH changes
  useEffect(() => {
    if (shadingPluginRef.current) {
        const tz = getTzForTicker(ticker);
        const isET = tz === 'America/New_York';
        shadingPluginRef.current._timeframe = timeframe;
        shadingPluginRef.current._isET = isET && showEth;
        shadingPluginRef.current.updateAllViews();
    }
  }, [ticker, timeframe, showEth]);

  // 4. Live Price Line for 1D chart (Extended Hours)
  useEffect(() => {
    if (!priceSeriesRef.current) return;

    if (timeframe === '1D' && globalTime && localMasterData.length > 0) {
      // Find the most recent price in master data at globalTime
      const gtMs = new Date(globalTime).getTime();
      let lastPrice = null;

      // Find the exact or nearest prior 1-min bar
      // Since localMasterData is sorted, we can search
      for (let i = localMasterData.length - 1; i >= 0; i--) {
        const barMs = new Date(localMasterData[i].time).getTime();
        if (barMs <= gtMs) {
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
            lineStyle: 2, // Dashed
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

  const filteredTickers = tickers.filter(t => t.toLowerCase().includes(tickerSearch.toLowerCase()));


  return (
    <div className={`chart-card ${isMaximized ? 'is-maximized' : ''}`}>
      <div className="chart-header">
        <div className="chart-controls">
          
          {/* CUSTOM TICKER SELECT */}
          <div className="custom-dropdown-container" ref={tickerRef}>
            <div 
              className={`custom-select ${isTickerOpen ? 'active' : ''}`} 
              onClick={(e) => {
                e.stopPropagation();
                setIsTickerOpen(!isTickerOpen);
              }}
            >
              <Search size={14} className="text-secondary" />
              <span style={{fontWeight: '700'}}>{ticker}</span>
              <ChevronDown size={14} className="text-secondary" />
            </div>
            
            {isTickerOpen && (
              <div className="dropdown-menu">
                <div className="dropdown-search">
                  <input 
                    autoFocus 
                    placeholder="Search symbols..." 
                    value={tickerSearch} 
                    onChange={(e) => setTickerSearch(e.target.value)}
                  />
                </div>
                <div className="dropdown-items">
                  {filteredTickers.map(t => (
                    <div 
                      key={t} 
                      className={`dropdown-item ${t === ticker ? 'selected' : ''}`}
                      onClick={() => {
                        setTicker(t);
                        setIsTickerOpen(false);
                        setTickerSearch('');
                      }}
                    >
                      {t}
                    </div>
                  ))}
                  {filteredTickers.length === 0 && <div className="dropdown-item" style={{opacity: 0.5}}>No results</div>}
                </div>
              </div>
            )}
          </div>

          {/* CUSTOM TIMEFRAME SELECT */}
          <div className="custom-dropdown-container" ref={tfRef}>
            <div 
              className={`custom-select ${isTfOpen ? 'active' : ''}`} 
              onClick={(e) => {
                e.stopPropagation();
                setIsTfOpen(!isTfOpen);
              }}
            >
              <Clock size={14} className="text-secondary" />
              <span>{timeframe.replace('min', 'm')}</span>
              <ChevronDown size={14} className="text-secondary" />
            </div>
            
            {isTfOpen && (
              <div className="dropdown-menu" style={{minWidth: '100px'}}>
                <div className="dropdown-items">
                  {['1min', '5min', '15min', '30min', '1H', '1D'].map(tf => (
                    <div 
                      key={tf} 
                      className={`dropdown-item ${tf === timeframe ? 'selected' : ''}`}
                      onClick={() => {
                        setTimeframe(tf);
                        setIsTfOpen(false);
                      }}
                    >
                      {tf.replace('min', 'm')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* PREMIUM ETH TOGGLE */}
          <div className="switch-container" onClick={() => setShowEth(!showEth)}>
            <div className={`switch-track ${showEth ? 'active' : ''}`}>
              <div className="switch-thumb" />
            </div>
            <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>ETH</span>
          </div>

          {/* VOLUME PROFILE TOGGLE */}
          <div className="switch-container" onClick={() => setShowVP(!showVP)}>
            <div className={`switch-track ${showVP ? 'active' : ''}`}>
              <div className="switch-thumb" />
            </div>
            <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>VP</span>
          </div>
        </div>
        
        <div className="chart-actions">
           <button className="btn-icon" onClick={onToggleMaximize} title={isMaximized ? "Minimize" : "Maximize"}>
             {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
           </button>
        </div>
      </div>
      <div className="chart-panes" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div ref={chartContainerRef} style={{ flex: 1, position: 'relative', minHeight: 0, minWidth: 0, overflow: 'hidden', cursor: isDrawingMode ? 'crosshair' : 'default' }}>
          
          {/* SCROLL TO END BUTTON */}
          {!isAtEnd && (
            <button 
              className="scroll-to-end-btn"
              onClick={() => chartRef.current?.timeScale().scrollToPosition(0, true)}
              title="Scroll to latest"
            >
              <ChevronRight size={18} />
            </button>
          )}

        </div>

        {isDrawingMode && (
          <div style={{
            position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(255, 152, 0, 0.9)', color: '#000', padding: '2px 12px',
            borderRadius: '4px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.05em',
            pointerEvents: 'none', zIndex: 10, display: 'flex', gap: '15px'
          }}>
            <span>MODE: {drawType.toUpperCase()}</span>
            <span>{drawType === 'ray' ? 'Click to place ray' : (rectAnchor ? 'Click to finish rectangle' : 'Click to start rectangle')}</span>
            <span>H: Ray · R: Rect · ESC/DEL</span>
          </div>
        )}
      </div>
    </div>
  );
}
