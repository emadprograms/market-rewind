import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import { resampleData } from '../lib/resampling';
import { Maximize2, Minimize2, Search, ChevronDown, Clock } from 'lucide-react';
import { fetchMarketData } from '../lib/db';
import { getTzForTicker } from '../lib/timezones';
import { SessionShadingPlugin } from '../lib/SessionShading';
import { VolumeProfilePlugin } from '../lib/VolumeProfilePlugin';
import { HorizontalRayPlugin } from '../lib/HorizontalRayPlugin';

export default function ChartUnit({ 
  id, 
  globalTime, 
  selectedDate,
  isReplayMode, 
  tickers, 
  initialTicker, 
  initialTf,
  onToggleMaximize,
  isMaximized,
  drawings = [],
  onUpdateRays
}) {
  const chartContainerRef = useRef();
  
  const chartRef = useRef();
  const priceSeriesRef = useRef();
  const volumeSeriesRef = useRef();
  const lastDataCountRef = useRef(0);
  const shadingPluginRef = useRef(null);
  const vpPluginRef = useRef(null);
  const rayPluginRef = useRef(null);
  
  const [ticker, setTicker] = useState(initialTicker || tickers[0]);
  const [localMasterData, setLocalMasterData] = useState([]);
  const [timeframe, setTimeframe] = useState(initialTf || '1D');
  const [showEth, setShowEth] = useState(initialEth || false);
  const [showVP, setShowVP] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);

  // Custom UI State
  const [isTickerOpen, setIsTickerOpen] = useState(false);
  const [isTfOpen, setIsTfOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState('');
  
  const tickerRef = useRef();
  const tfRef = useRef();
  const isDrawingModeRef = useRef(false);

  // Click outside detection
  useEffect(() => {
    const handleClick = (e) => {
      if (tickerRef.current && !tickerRef.current.contains(e.target)) setIsTickerOpen(false);
      if (tfRef.current && !tfRef.current.contains(e.target)) setIsTfOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, []);

  // 0. Fetch local master data
  useEffect(() => {
    async function load() {
      const data = await fetchMarketData(ticker, selectedDate);
      setLocalMasterData(data);
    }
    load();
  }, [ticker, selectedDate]);

  // 1. Prepare data
  const chartData = useMemo(() => {
    if (!localMasterData || localMasterData.length === 0) return [];
    const filteredRaw = (showEth && timeframe !== '1D') ? localMasterData : localMasterData.filter(d => d.session === 'REG');
    const resampled = resampleData(filteredRaw, timeframe);
    if (isReplayMode && globalTime) {
      const gt = new Date(globalTime).getTime();
      return resampled.filter(d => new Date(d.time).getTime() <= gt);
    }
    return resampled;
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
          return date.toLocaleString('en-US', { timeZone: tz, hour12: false, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
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

    rayPluginRef.current = new HorizontalRayPlugin();
    priceSeriesRef.current.attachPrimitive(rayPluginRef.current);
    
    // Initial sync
    rayPluginRef.current.setRays(drawings);
    
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
          setIsDrawingMode(prev => !prev);
        }
      }
      if (e.key === 'Escape') {
        setIsDrawingMode(false);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && isHovered) {
        // Clear all rays on this chart
        if (drawings.length > 0) {
          onUpdateRays([]);
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

      onUpdateRays([...drawings, { price, time: param.time }]);
    };

    const handleDblClick = (param) => {
      if (!param.point || !param.time) return;
      const clickPrice = series.coordinateToPrice(param.point.y);
      if (clickPrice === null || clickPrice === undefined) return;

      // Find nearest ray within a tolerance
      let nearestIdx = -1;
      let nearestDist = Infinity;
      drawings.forEach((entry, idx) => {
        const dist = Math.abs(entry.price - clickPrice);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = idx;
        }
      });

      if (nearestIdx !== -1) {
        const ray = drawings[nearestIdx];
        const rayY = series.priceToCoordinate(ray.price);
        const rayX = chart.timeScale().timeToCoordinate(ray.time);
        
        // Deletion criteria: 
        // 1. Within 10 pixels vertically
        // 2. To the right of the anchor point (X coord)
        if (rayY !== null && Math.abs(rayY - param.point.y) < 10 && (param.point.x >= (rayX || 0) - 5)) { 
          const newRays = [...drawings];
          newRays.splice(nearestIdx, 1);
          onUpdateRays(newRays);
        }
      }
    };

    chart.subscribeClick(handleClick);
    chart.subscribeDblClick(handleDblClick);

    return () => {
      try {
        chart.unsubscribeClick(handleClick);
        chart.unsubscribeDblClick(handleDblClick);
      } catch(_) {}
    };
  }, []);

  // Update chart timezone options when ticker changes
  useEffect(() => {
    if (!chartRef.current) return;
    const tz = getTzForTicker(ticker);
    chartRef.current.applyOptions({
      localization: {
        timeFormatter: (time) => {
          const date = new Date(time * 1000);
          return date.toLocaleString('en-US', { timeZone: tz, hour12: false, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
      },
      timeScale: {
        tickMarkFormatter: (time, tickMarkType) => {
          const date = new Date(time * 1000);
          if (tickMarkType <= 2) return date.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
          return date.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
        }
      }
    });
  }, [ticker]);

  // Update Ray Plugin when synced drawings change
  useEffect(() => {
    if (rayPluginRef.current) {
        rayPluginRef.current.setRays(drawings);
    }
  }, [drawings]);

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

      // If we are just adding one bar, use .update()
      if (formatted.length === lastDataCountRef.current + 1) {
        const lastBar = formatted[formatted.length - 1];
        priceSeriesRef.current.update({
          time: lastBar.time,
          open: lastBar.open,
          high: lastBar.high,
          low: lastBar.low,
          close: lastBar.close,
        });
        volumeSeriesRef.current.update({
          time: lastBar.time,
          value: lastBar.volume,
          color: lastBar.close >= lastBar.open ? '#26a69a' : '#ef5350'
        });
      } else {
        // Full reset (e.g. timeframe change or symbol change)
        const isUpdate = lastDataCountRef.current > 0;
        let targetTimeToRestore = null;
        
        if (isUpdate && chartRef.current && priceSeriesRef.current) {
            const oldLogicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (oldLogicalRange && oldLogicalRange.from !== null && oldLogicalRange.to !== null) {
                const oldData = priceSeriesRef.current.data();
                if (oldData && oldData.length > 0) {
                    const midIndex = Math.floor((oldLogicalRange.from + oldLogicalRange.to) / 2);
                    // clamp safely
                    const safeIndex = Math.max(0, Math.min(oldData.length - 1, midIndex));
                    if (oldData[safeIndex]) {
                        targetTimeToRestore = oldData[safeIndex].time;
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
            const count = zoomMap[timeframe] || 100;
            
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
    } else if (priceSeriesRef.current) {
        priceSeriesRef.current.setData([]);
        volumeSeriesRef.current.setData([]);
        lastDataCountRef.current = 0;
    }

    // Refresh shading plugin settings
    if (shadingPluginRef.current) {
        const tz = getTzForTicker(ticker);
        const isET = tz === 'America/New_York';
        shadingPluginRef.current._timeframe = timeframe;
        shadingPluginRef.current._isET = isET && showEth;
        shadingPluginRef.current.updateAllViews();
    }
  }, [chartData, isReplayMode, ticker, timeframe, showEth]);

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
        <div ref={chartContainerRef} style={{ flex: 1, position: 'relative', minHeight: 0, minWidth: 0, overflow: 'hidden', cursor: isDrawingMode ? 'crosshair' : 'default' }} />
        {isDrawingMode && (
          <div style={{
            position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(255, 152, 0, 0.9)', color: '#000', padding: '2px 10px',
            borderRadius: '4px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em',
            pointerEvents: 'none', zIndex: 10
          }}>
            DRAW MODE — Click to place · Dbl-click to delete · ESC to exit
          </div>
        )}
      </div>
    </div>
  );
}
