import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart } from 'lightweight-charts';
import { resampleData } from '../lib/resampling';
import { Maximize2, Minimize2, Search, ChevronDown, Clock } from 'lucide-react';
import { fetchMarketData } from '../lib/db';
import { getTzForTicker } from '../lib/timezones';
import { SessionShadingPlugin } from '../lib/SessionShading';

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
  isMaximized
}) {
  const chartContainerRef = useRef();
  
  const chartRef = useRef();
  const priceSeriesRef = useRef();
  const volumeSeriesRef = useRef();
  const lastDataCountRef = useRef(0);
  const shadingPluginRef = useRef(null);
  
  const [ticker, setTicker] = useState(initialTicker || tickers[0]);
  const [localMasterData, setLocalMasterData] = useState([]);
  const [timeframe, setTimeframe] = useState(initialTf || '1D');
  const [showEth, setShowEth] = useState(initialEth || false);

  // Custom UI State
  const [isTickerOpen, setIsTickerOpen] = useState(false);
  const [isTfOpen, setIsTfOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState('');
  
  const tickerRef = useRef();
  const tfRef = useRef();

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

        priceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
          time, open, high, low, close
        })));

        volumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
          time,
          value: volume,
          color: close >= open ? '#26a69a' : '#ef5350'
        })));

        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        
        // Perception-aware initial zoom
        const total = formatted.length;
        if (total > 0) {
          const zoomMap = {
            '1min': 120,   // ~2 hours
            '5min': 78,    // 1 full RTH session
            '15min': 60,   // ~2 days
            '30min': 50,   // ~4 days
            '1H': 60,      // ~2 weeks
            '1D': 50       // ~2.5 months (Very thick candles)
          };
          const count = zoomMap[timeframe] || 100;
          
          // Small delay to ensure coordinate system is ready after setData
          setTimeout(() => {
            if (chartRef.current) {
              chartRef.current.timeScale().setVisibleLogicalRange({
                from: total - count,
                to: total
              });
            }
          }, 80); // Increased slightly for robustness
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
        </div>
        
        <div className="chart-actions">
           <button className="btn-icon" onClick={onToggleMaximize} title={isMaximized ? "Minimize" : "Maximize"}>
             {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
           </button>
        </div>
      </div>
      <div className="chart-panes" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div ref={chartContainerRef} style={{ flex: 1, position: 'relative' }} />
      </div>
    </div>
  );
}
