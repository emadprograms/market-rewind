import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import { resampleData } from '../lib/resampling';
import { Maximize2, Minimize2, Search, ChevronDown, Clock, ChevronRight, Minus, Square, Trash2 } from 'lucide-react';
import { fetchMarketData, fetchHistoricalChunk } from '../lib/db';
import { getTzForTicker } from '../lib/timezones';
import { SessionShadingPlugin } from '../lib/SessionShading';
import { VolumeProfilePlugin } from '../lib/VolumeProfilePlugin';
import { HorizontalRayPlugin } from '../lib/HorizontalRayPlugin';
import { RectanglePlugin } from '../lib/RectanglePlugin';

const borderColors = {
  red: '#ef5350',
  blue: '#42a5f5',
  green: '#26a69a',
  yellow: '#ffca28',
};

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
  onTimeframeChange,
  groupColor = 'none',
  groupTicker,
  onGroupChange,
  onTickerChange,
  style = {}
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

  // Group-to-Ticker Sync: When group ticker changes, update local ticker
  useEffect(() => {
    if (groupColor !== 'none' && groupTicker && groupTicker !== ticker) {
      setTicker(groupTicker);
    }
  }, [groupColor, groupTicker]);

  // Group Transition: When chart is assigned to a group, adopt the group's ticker
  useEffect(() => {
    if (groupColor !== 'none' && groupTicker) {
      setTicker(groupTicker);
    }
  }, [groupColor]);
  const [rectAnchor, setRectAnchor] = useState(null); // {price, time}
  const [ghostPoint, setGhostPoint] = useState(null); // {price, time} for rect preview
  const [isAtEnd, setIsAtEnd] = useState(true);
  const lastBarSpacingRef = useRef(null);
  const priceLineRef = useRef(null);
  const lastTickerRef = useRef(ticker);
  const lastTfRef = useRef(timeframe);
  const lastEthRef = useRef(showEth);



  const drawings = allDrawings[ticker] || { rays: [], rects: [] };

  // Custom UI State
  const [isTickerOpen, setIsTickerOpen] = useState(false);
  const [isTfOpen, setIsTfOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState('');
  
  const tickerRef = useRef();
  const tfRef = useRef();
  const isDrawingModeRef = useRef(false);
  const currentTickerRef = useRef(ticker);
  
  // Infinite Scroll State
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const earliestLoadedDateRef = useRef(null);
  const pendingHistoryPrependRef = useRef(null);

  const keyboardInputRef = useRef(null);
  const keyboardActionRef = useRef({ active: false, type: null, value: '' });
  const [keyboardAction, setKeyboardAction] = useState({ active: false, type: null, value: '' });

  const updateKeyboardAction = useCallback((newState) => {
    const merged = { ...keyboardActionRef.current, ...newState };
    keyboardActionRef.current = merged;
    setKeyboardAction(merged);
  }, []);

  useEffect(() => {
    if (keyboardAction.active && keyboardInputRef.current) {
      keyboardInputRef.current.focus();
    }
  }, [keyboardAction.active]);

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

  // 0. Fetch initial local master data
  const dataTimeframeRef = useRef(timeframe);
  
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoadingHistory(true);
      
      let daysBack = 30;
      if (timeframe === '1min') daysBack = 3;
      else if (timeframe === '5min') daysBack = 15;
      else if (timeframe === '15min') daysBack = 30;
      else if (timeframe === '30min') daysBack = 60;
      else if (timeframe === '1H') daysBack = 120;
      else if (timeframe === '1D') daysBack = 365 * 2; // 2 years for daily charts
      
      const data = await fetchMarketData(ticker, selectedDate, daysBack);
      if (cancelled) return; // stale fetch from a previous render
      
      if (data && data.length > 0) {
        earliestLoadedDateRef.current = data[0].time;
      }
      dataTimeframeRef.current = timeframe;
      setLocalMasterData(data);
      setIsLoadingHistory(false);
    }
    load();
    return () => { cancelled = true; };
  }, [ticker, selectedDate, timeframe]);

  // Infinite Scroll Listener
  useEffect(() => {
    if (!chartRef.current || !localMasterData || localMasterData.length === 0) return;
    
    const timeScale = chartRef.current.timeScale();
    
    const onVisibleLogicalRangeChanged = async (newLogicalRange) => {
      if (!newLogicalRange) return;
      
      // Trigger fetch if scrolled within 100 bars of the left edge
      if (newLogicalRange.from < 100 && !isLoadingHistory && earliestLoadedDateRef.current) {
        setIsLoadingHistory(true);
        try {
          const oldLogicalRange = timeScale.getVisibleLogicalRange();
          const currentChartBars = priceSeriesRef.current ? priceSeriesRef.current.data() : [];
          
          const chunk = await fetchHistoricalChunk(ticker, earliestLoadedDateRef.current, 30);
          
          if (chunk && chunk.length > 0) {
            earliestLoadedDateRef.current = chunk[0].time;
            
            let newData = [...chunk, ...localMasterData];
            
            // Mark that a prepend occurred so the main render effect can shift the viewport
            pendingHistoryPrependRef.current = {
                oldFirstTime: currentChartBars.length > 0 ? currentChartBars[0].time : null,
                oldLogicalRange: oldLogicalRange
            };
            
            setLocalMasterData(newData);
          }
        } finally {
          setIsLoadingHistory(false);
        }
      }
      
      // Garbage Collection: If user scrolls back to the present, drop old historical data to save RAM
      if (newLogicalRange.from > 5000 && localMasterData.length > 35000 && !isLoadingHistory) {
         // This removes the oldest data from the left side of the array.
         // We do not do this right now because calculating the exact viewport left-shift 
         // while dragging is highly volatile and causes chart jumping.
         // 35k - 70k rows is completely stable in memory.
      }
    };
    
    timeScale.subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChanged);
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChanged);
  }, [localMasterData, isLoadingHistory, ticker]);

  // 1. Prepare data — filter raw bars by globalTime FIRST, then resample.
  // This ensures higher-timeframe candles (1D, 1H) progressively build during replay.
  const chartData = useMemo(() => {
    if (!localMasterData || localMasterData.length === 0) return [];
    if (timeframe !== dataTimeframeRef.current) return []; // PREVENT STALE RENDER DURING ASYNC FETCH
    
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
      // Ignore if user is already typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      // Only respond if this chart's container or its children are focused/hovered
      const container = chartContainerRef.current;
      if (!container) return;
      const isHovered = container.matches(':hover') || container.contains(document.activeElement);
      if (!isHovered) return;

      // --- 1. Modifier Shortcuts (Alt/Ctrl / Shift) ---
      if (e.altKey || e.ctrlKey) {
        const keyLower = e.key.toLowerCase();
        const isKeyJ = e.code === 'KeyJ' || e.keyCode === 74 || keyLower === 'j' || keyLower === '∆';
        const isKeyE = e.code === 'KeyE' || e.keyCode === 69 || keyLower === 'e' || keyLower === '´';
        const isKeyR = e.code === 'KeyR' || e.keyCode === 82 || keyLower === 'r' || keyLower === '‰';

        if (isKeyJ && !e.shiftKey) {
          e.preventDefault();
          setDrawType('ray');
          setIsDrawingMode(prev => !prev || drawType !== 'ray');
          setRectAnchor(null);
        }
        if (isKeyE && e.shiftKey) {
          e.preventDefault();
          setShowEth(prev => !prev);
        }
        if (isKeyR && e.shiftKey) {
          e.preventDefault();
          setDrawType('rect');
          setIsDrawingMode(prev => !prev || drawType !== 'rect');
          setRectAnchor(null);
        }
        return; // Don't process standalone letters if modifiers are pressed
      }

      // --- 2. System Keys ---
      if (e.key === 'Escape') {
        if (keyboardActionRef.current.active) {
          updateKeyboardAction({ active: false, type: null, value: '' });
          return;
        }
        setIsDrawingMode(false);
        setRectAnchor(null);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (keyboardActionRef.current.active) return; // Let input handle backspace
        onUpdateDrawings(currentTickerRef.current, 'rays', []);
        onUpdateDrawings(currentTickerRef.current, 'rects', []);
      }

      // --- 3. Standalone Typing (Timeframe / Ticker) ---
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !keyboardActionRef.current.active) {
        const isNum = /^[0-9]$/.test(e.key);
        const isLetter = /^[a-zA-Z]$/.test(e.key);

        if (isNum) {
          e.preventDefault();
          updateKeyboardAction({ active: true, type: 'timeframe', value: e.key });
        } else if (isLetter) {
          e.preventDefault();
          updateKeyboardAction({ active: true, type: 'ticker', value: e.key });
        }
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
      const isSameContext = lastTickerRef.current === ticker && 
                            lastTfRef.current === timeframe && 
                            lastEthRef.current === showEth;
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
          // If we were at the end, shift to keep the edge visible only when moving FORWARD
          const shift = formatted.length - lastDataCountRef.current;
          if (shift > 0) {
            ts.setVisibleLogicalRange({
              from: oldLogicalRange.from + shift,
              to: oldLogicalRange.to + shift
            });
          } else {
            // BACKWARDS replay: Explicitly restore the exact previous logical range.
            // Since older indices (index 0) remain unchanged, restoring the exact range 
            // keeps all remaining candles firmly locked in their identical physical pixels.
            // This prevents `lightweight-charts` from defaulting its internal auto-scale on `setData`, 
            // which was causing the severe squishing issue against the Y-axis.
            ts.setVisibleLogicalRange(oldLogicalRange);
          }
        } else {
          // If the user has explicitly scrolled back in time, preserve their exact view
          ts.setVisibleLogicalRange(oldLogicalRange);
        }

      } else {
        // Full reset (e.g. timeframe change, symbol change, or ETH toggle)
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
          // --- Handle Infinite Scroll Prepend Shift ---
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
              // Normal load: always scroll to the latest data with proper right-margin padding.
              // We intentionally do NOT try to anchor to the old viewport's timestamp because
              // cross-timeframe switches have completely different data windows (e.g., 1D loads
              // 2 years, 1m loads 3 days), making old timestamps unreliable anchors.
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

    } else if (priceSeriesRef.current) {
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


    const hasExplicitSize = style.width || style.height;
    const mergedStyle = { ...style, position: 'relative', ...(hasExplicitSize ? { flex: 'none' } : {}) };
    return (
    <div className={`chart-card ${isMaximized ? 'is-maximized' : ''}`} style={{
      ...mergedStyle,
      borderTop: groupColor !== 'none' && borderColors[groupColor] ? `3px solid ${borderColors[groupColor]}` : undefined,
    }}>
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
                        if (onTickerChange) {
                          onTickerChange(t);
                        }
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

          {/* GROUP PICKER */}
          <div className="group-picker" title="Assign to Group">
            {['red', 'blue', 'green', 'yellow', 'none'].map(color => (
              <div
                key={color}
                className={`group-dot ${color === groupColor ? 'active' : ''}`}
                style={{ backgroundColor: color === 'none' ? '#555' : borderColors[color] }}
                onClick={() => onGroupChange && onGroupChange(color)}
              />
            ))}
          </div>

          {/* PREMIUM ETH TOGGLE */}
          <div className="switch-container" onClick={() => setShowEth(!showEth)}>
            <div className={`switch-track ${showEth ? 'active' : ''}`}>
              <div className="switch-thumb" />
            </div>
            <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>ETH</span>
          </div>

          {/* VOLUME PROFILE TOGGLE */}
          <div className="switch-container" onClick={() => setShowVP(!showVP)} title="Volume Profile">
            <div className={`switch-track ${showVP ? 'active' : ''}`}>
              <div className="switch-thumb" />
            </div>
            <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>VP</span>
          </div>

          {/* HORIZONTAL RAY DRAWING */}
          <div 
            className="switch-container" 
            onClick={() => {
              if (isDrawingMode && drawType === 'ray') {
                setIsDrawingMode(false);
              } else {
                setIsDrawingMode(true);
                setDrawType('ray');
              }
            }}
            title="Horizontal Ray (Alt+J)"
          >
            <div className={`switch-track ${isDrawingMode && drawType === 'ray' ? 'active' : ''}`} style={{ width: '28px' }}>
              <Minus size={14} style={{ margin: 'auto' }} />
            </div>
            <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>RAY</span>
          </div>

          {/* RECTANGLE DRAWING */}
          <div 
            className="switch-container" 
            onClick={() => {
              if (isDrawingMode && drawType === 'rect') {
                setIsDrawingMode(false);
              } else {
                setIsDrawingMode(true);
                setDrawType('rect');
              }
            }}
            title="Rectangle (Alt+Shift+R)"
          >
            <div className={`switch-track ${isDrawingMode && drawType === 'rect' ? 'active' : ''}`} style={{ width: '28px' }}>
              <Square size={12} style={{ margin: 'auto' }} />
            </div>
            <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>RECT</span>
          </div>

          {/* CLEAR DRAWINGS */}
          <div 
            className="switch-container" 
            onClick={() => {
              if (window.confirm('Clear all drawings for ' + ticker + '?')) {
                onUpdateDrawings(ticker, 'rays', []);
                onUpdateDrawings(ticker, 'rects', []);
              }
            }}
            title="Clear All Drawings"
          >
            <div className="switch-track" style={{ width: '28px', background: 'rgba(239, 83, 80, 0.1)' }}>
              <Trash2 size={14} color="var(--accent-red)" style={{ margin: 'auto' }} />
            </div>
            <span style={{fontWeight: '600', letterSpacing: '0.05em', color: 'var(--accent-red)'}}>CLEAR</span>
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
              onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
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
            <span>Alt/Ctrl+J: Ray · Alt/Ctrl+Shift+R: Rect · ESC/DEL</span>
          </div>
        )}

        {/* KEYBOARD ACTION MODAL */}
        {keyboardAction.active && (
          <div className="keyboard-action-modal">
            <div className="modal-header">
              {keyboardAction.type === 'timeframe' ? 'Change Interval' : 'Change Symbol'}
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const val = keyboardAction.value.trim().toLowerCase();
              if (!val) {
                updateKeyboardAction({ active: false });
                return;
              }

              if (keyboardAction.type === 'timeframe') {
                let newTf = null;
                if (/^\d+$/.test(val)) {
                  const num = parseInt(val);
                  if (num === 1) newTf = '1min';
                  else if (num === 5) newTf = '5min';
                  else if (num === 15) newTf = '15min';
                  else if (num === 30) newTf = '30min';
                  else if (num === 60) newTf = '1H';
                } else if (val === '1h') newTf = '1H';
                else if (val === '1d') newTf = '1D';

                if (newTf) {
                  setTimeframe(newTf);
                }
              } else if (keyboardAction.type === 'ticker') {
                setTicker(val.toUpperCase());
              }

              updateKeyboardAction({ active: false, value: '' });
            }}>
              <input
                ref={keyboardInputRef}
                type="text"
                value={keyboardAction.value}
                onChange={(e) => updateKeyboardAction({ value: e.target.value.toUpperCase() })}
                onBlur={() => updateKeyboardAction({ active: false })}
              />
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
