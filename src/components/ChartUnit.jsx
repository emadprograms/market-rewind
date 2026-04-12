import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart } from 'lightweight-charts';
import { resampleData } from '../lib/resampling';
import { Maximize2, Settings2, Share2 } from 'lucide-react';

export default function ChartUnit({ 
  id, 
  masterData, 
  globalTime, 
  isReplayMode, 
  tickers, 
  initialTicker, 
  initialTf 
}) {
  const chartContainerRef = useRef();
  const chartRef = useRef();
  const seriesRef = useRef();
  
  const [ticker, setTicker] = useState(initialTicker || tickers[0]);
  const [timeframe, setTimeframe] = useState(initialTf || '1min');
  const [showEth, setShowEth] = useState(false);

  // 1. Prepare data for this specific chart
  const chartData = useMemo(() => {
    if (!masterData) return [];
    
    // Filter by session if ETH is off
    const filteredRaw = showEth ? masterData : masterData.filter(d => d.session === 'REG');
    
    // Resample
    const resampled = resampleData(filteredRaw, timeframe);
    
    // Slice for Replay Mode
    if (isReplayMode && globalTime) {
      const gt = new Date(globalTime).getTime();
      return resampled.filter(d => new Date(d.time).getTime() <= gt);
    }
    
    return resampled;
  }, [masterData, timeframe, showEth, isReplayMode, globalTime]);

  // 2. Initialize Chart
  useEffect(() => {
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
      crosshair: {
        mode: 0,
      },
      priceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    seriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    const handleResize = () => {
      if (chartContainerRef.current) {
        chartRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight 
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chartRef.current.remove();
    };
  }, []);

  // 3. Update Chart Data
  useEffect(() => {
    if (seriesRef.current && chartData.length > 0) {
      // Lightweight charts expects time in 'YYYY-MM-DD' or Unix timestamp or ISO string (depending on scale)
      // We'll use ISO string format which it handles well for intraday
      const formatted = chartData.map(d => ({
        time: Math.floor(new Date(d.time).getTime() / 1000), // Unix timestamp
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));
      seriesRef.current.setData(formatted);
      
      if (isReplayMode) {
        chartRef.current.timeScale().scrollToPosition(0, false);
      }
    } else if (seriesRef.current) {
        seriesRef.current.setData([]);
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
      <div ref={chartContainerRef} style={{ flex: 1, position: 'relative' }} />
    </div>
  );
}
