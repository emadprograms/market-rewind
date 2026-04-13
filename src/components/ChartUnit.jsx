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
  
  const chartRef = useRef();
  const priceSeriesRef = useRef();
  const volumeSeriesRef = useRef();
  const lastDataCountRef = useRef(0);
  const crosshairRef = useRef({ time: null, price: null });
  const raysRef = useRef([]);
  const chartDataRef = useRef([]);
  
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

  // 2. Initialize Charts
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
      crosshair: { mode: 0 },
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
      handleScroll: true,
      handleScale: true,
    });

    priceSeriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    
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

    chartRef.current.subscribeCrosshairMove((param) => {
      if (param.time) crosshairRef.current.time = param.time;
      if (param.point && priceSeriesRef.current) {
        const price = priceSeriesRef.current.coordinateToPrice(param.point.y);
        crosshairRef.current.price = price;
      }
    });

    const handleKeyDown = (e) => {
      if (e.altKey && e.key.toLowerCase() === 'r') {
        const { time, price } = crosshairRef.current;
        const currentData = chartDataRef.current;
        if (!time || price === null || currentData.length === 0) return;

        const startIndex = currentData.findIndex(d => d.time === time);
        if (startIndex !== -1) {
          const raySeries = chartRef.current.addLineSeries({
            color: '#eab308', // gold/yellow
            lineWidth: 2,
            lineStyle: 0, // Solid
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          });

          const rayData = [];
          for (let i = startIndex; i < currentData.length; i++) {
            rayData.push({ time: currentData[i].time, value: price });
          }
          raySeries.setData(rayData);
          
          raysRef.current.push({ series: raySeries, price });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const handleResize = () => {
      if (chartContainerRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      chartRef.current.remove();
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

      chartDataRef.current = formatted;

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
        
        // Extend all existing rays to the new bar
        raysRef.current.forEach(ray => {
          ray.series.update({ time: lastBar.time, value: ray.price });
        });
        
      } else {
        // Full reset (e.g. timeframe change or symbol change)
        
        // Clear old custom rays
        raysRef.current.forEach(ray => chartRef.current.removeSeries(ray.series));
        raysRef.current = [];

        priceSeriesRef.current.setData(formatted.map(({ time, open, high, low, close }) => ({
          time, open, high, low, close
        })));

        volumeSeriesRef.current.setData(formatted.map(({ time, volume, open, close }) => ({
          time,
          value: volume,
          color: close >= open ? '#26a69a' : '#ef5350'
        })));

        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
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
      <div className="chart-panes" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div ref={chartContainerRef} style={{ flex: 1, position: 'relative' }} />
      </div>
    </div>
  );
}
