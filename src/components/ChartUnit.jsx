import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart } from 'lightweight-charts';
import { resampleData } from '../lib/resampling';
import { Maximize2, Settings2, Share2 } from 'lucide-react';
import { fetchMarketData } from '../lib/db';

export default function ChartUnit({ 
  id, 
  globalTime, 
  selectedDate,
  isReplayMode, 
  tickers, 
  initialTicker, 
  initialTf 
}) {
  const chartContainerRef = useRef();
  const volumeContainerRef = useRef();
  
  const priceChartRef = useRef();
  const volumeChartRef = useRef();
  const priceSeriesRef = useRef();
  const volumeSeriesRef = useRef();
  const lastDataCountRef = useRef(0);
  
  const [ticker, setTicker] = useState(initialTicker || tickers[0]);
  const [localMasterData, setLocalMasterData] = useState([]);
  const [timeframe, setTimeframe] = useState(initialTf || '1min');
  const [showEth, setShowEth] = useState(false);

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
    const filteredRaw = showEth ? localMasterData : localMasterData.filter(d => d.session === 'REG');
    const resampled = resampleData(filteredRaw, timeframe);
    if (isReplayMode && globalTime) {
      const gt = new Date(globalTime).getTime();
      return resampled.filter(d => new Date(d.time).getTime() <= gt);
    }
    return resampled;
  }, [localMasterData, timeframe, showEth, isReplayMode, globalTime]);

  const chartOptions = {
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
    handleScroll: true,
    handleScale: true,
  };

  // 2. Initialize Charts
  useEffect(() => {
    // --- Price Chart ---
    priceChartRef.current = createChart(chartContainerRef.current, {
      ...chartOptions,
      localization: {
        timeFormatter: (time) => {
          const date = new Date(time * 1000);
          return date.toLocaleString('en-US', { timeZone: 'UTC', hour12: false, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
          if (tickMarkType <= 2) return date.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
          return date.toLocaleString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false });
        }
      },
    });

    priceSeriesRef.current = priceChartRef.current.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });

    // --- Volume Chart ---
    volumeChartRef.current = createChart(volumeContainerRef.current, {
      ...chartOptions,
      timeScale: {
        visible: true, // Show it but it will be synced
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
    });

    volumeSeriesRef.current = volumeChartRef.current.addHistogramSeries({
      priceFormat: { type: 'volume' },
    });

    // --- Synchronization ---
    const priceTimeScale = priceChartRef.current.timeScale();
    const volumeTimeScale = volumeChartRef.current.timeScale();

    let isSyncing = false;
    priceTimeScale.subscribeVisibleTimeRangeChange(range => {
       if (isSyncing || !range) return;
       isSyncing = true;
       volumeTimeScale.setVisibleRange(range);
       isSyncing = false;
    });

    volumeTimeScale.subscribeVisibleTimeRangeChange(range => {
       if (isSyncing || !range) return;
       isSyncing = true;
       priceTimeScale.setVisibleRange(range);
       isSyncing = false;
    });

    const handleResize = () => {
      if (chartContainerRef.current && volumeContainerRef.current) {
        priceChartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
        volumeChartRef.current.applyOptions({ width: volumeContainerRef.current.clientWidth, height: volumeContainerRef.current.clientHeight });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      priceChartRef.current.remove();
      volumeChartRef.current.remove();
    };
  }, []);

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

        // FIX: Force price scale to reset to auto-range when a new symbol is loaded
        priceChartRef.current.priceScale('right').applyOptions({ autoScale: true });
      }

      lastDataCountRef.current = formatted.length;
    } else if (priceSeriesRef.current) {
        priceSeriesRef.current.setData([]);
        volumeSeriesRef.current.setData([]);
        lastDataCountRef.current = 0;
    }
  }, [chartData, isReplayMode]);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <div className="chart-controls">
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}>
            {tickers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            <option value="1min">1m</option>
            <option value="5min">5m</option>
            <option value="15min">15m</option>
            <option value="30min">30m</option>
            <option value="1H">1h</option>
            <option value="1D">1d</option>
          </select>
          <div style={{display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--text-secondary)'}}>
            <input type="checkbox" checked={showEth} onChange={(e) => setShowEth(e.target.checked)} id={`eth-${id}`} />
            <label htmlFor={`eth-${id}`}>ETH</label>
          </div>
        </div>
        <div className="chart-actions">
           <button className="btn-icon"><Maximize2 size={14} /></button>
           <button className="btn-icon"><Settings2 size={14} /></button>
        </div>
      </div>
      <div className="chart-panes">
        <div ref={chartContainerRef} className="pane-price" />
        <div className="pane-separator" />
        <div ref={volumeContainerRef} className="pane-volume" />
      </div>
    </div>
  );
}
