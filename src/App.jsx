import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Calendar as CalendarIcon, Activity, RefreshCw } from 'lucide-react';
import ChartUnit from './components/ChartUnit';
import { fetchTickers, fetchMarketData, forceRefresh } from './lib/db';

// Today's date in YYYY-MM-DD format
const TODAY = new Date().toISOString().split('T')[0];

export default function App() {
  // --- Global State ---
  const [tickers, setTickers] = useState([]);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [masterData, setMasterData] = useState([]);
  const [currentTime, setCurrentTime] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [gridSize, setGridSize] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Connecting to database...');

  const playbackRef = useRef();

  // 1. Auto-load on startup
  useEffect(() => {
    bootApp();
  }, []);

  async function bootApp() {
    try {
      setIsLoading(true);
      setStatusMessage('Loading database...');
      
      const t = await fetchTickers();
      if (t.length > 0) {
        setTickers(t);
        setStatusMessage(`${t.length} tickers loaded`);
      } else {
        setStatusMessage('Database loaded but no tickers found');
      }
    } catch (e) {
      console.error("Boot failed:", e);
      setStatusMessage('Failed to load database. Run the GitHub Action first.');
    } finally {
      setIsLoading(false);
    }
  }

  // 2. Load market data when date or tickers change
  useEffect(() => {
    if (tickers.length > 0) {
      loadMarketData();
    }
  }, [selectedDate, tickers]);

  async function loadMarketData() {
    setIsLoading(true);
    const data = await fetchMarketData(tickers[0], selectedDate);
    setMasterData(data);
    
    if (data.length > 0) {
      const firstBar = data.find(d => d.session === 'REG') || data[0];
      setCurrentTime(firstBar.time);
      setStatusMessage(`${data.length} bars loaded for ${selectedDate}`);
    } else {
      setCurrentTime(null);
      setStatusMessage(`No data available for ${selectedDate}`);
    }
    setIsLoading(false);
  }

  // 3. Manual refresh (small icon button, not prominent)
  const handleRefresh = async () => {
    try {
      setStatusMessage('Refreshing from GitHub...');
      await forceRefresh();
      await bootApp();
    } catch (error) {
      setStatusMessage('Refresh failed. Is the GitHub Release available?');
    }
  };

  // 4. Replay Engine Loop
  useEffect(() => {
    if (isPlaying && masterData.length > 0) {
      playbackRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          const currentIndex = masterData.findIndex(d => d.time === prev);
          if (currentIndex !== -1 && currentIndex < masterData.length - 1) {
            return masterData[currentIndex + 1].time;
          }
          setIsPlaying(false);
          return prev;
        });
      }, 1000 / playbackSpeed);
    } else {
      clearInterval(playbackRef.current);
    }
    return () => clearInterval(playbackRef.current);
  }, [isPlaying, playbackSpeed, masterData]);

  // --- Handlers ---
  const togglePlay = () => setIsPlaying(!isPlaying);
  const resetToOpen = () => {
    const firstBar = masterData.find(d => d.session === 'REG') || masterData[0];
    if (firstBar) setCurrentTime(firstBar.time);
    setIsPlaying(false);
  };

  const stepForward = () => {
    const currentIndex = masterData.findIndex(d => d.time === currentTime);
    if (currentIndex < masterData.length - 1) setCurrentTime(masterData[currentIndex + 1].time);
  };

  const stepBackward = () => {
    const currentIndex = masterData.findIndex(d => d.time === currentTime);
    if (currentIndex > 0) setCurrentTime(masterData[currentIndex - 1].time);
  };

  const formatDisplayTime = (isoStr) => {
    if (!isoStr) return '--:--:--';
    const date = new Date(isoStr);
    return date.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }) + ' EST';
  };

  return (
    <div className="app-container">
      <header>
        <div className="logo">
          <Activity size={24} />
          MARKET<span>REWIND</span>
        </div>
        
        <div style={{display: 'flex', gap: '16px', alignItems: 'center'}}>
           <span style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>{statusMessage}</span>
           <button 
             onClick={handleRefresh}
             title="Force refresh database from GitHub"
             style={{
                display: 'flex',
                alignItems: 'center',
                background: 'none',
                color: 'var(--text-secondary)',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                opacity: 0.6,
                transition: 'opacity 0.2s'
             }}
             onMouseEnter={(e) => e.target.style.opacity = 1}
             onMouseLeave={(e) => e.target.style.opacity = 0.6}
           >
             <RefreshCw size={14} />
           </button>
        </div>

        <div style={{display: 'flex', gap: '12px'}}>
           <div style={{display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem'}}>
             <CalendarIcon size={14} />
             <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
           </div>
           <select value={gridSize} onChange={(e) => setGridSize(parseInt(e.target.value))}>
             <option value={1}>1 Chart</option>
             <option value={2}>2 Charts</option>
             <option value={3}>3 Charts</option>
             <option value={4}>4 Charts</option>
           </select>
        </div>
      </header>

      <main className={`workspace grid-${gridSize}`}>
        {isLoading ? (
          <div style={{gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>
            {statusMessage}
          </div>
        ) : (
          Array.from({ length: gridSize }).map((_, i) => (
            <ChartUnit 
              key={i} 
              id={i} 
              masterData={masterData} 
              globalTime={currentTime} 
              isReplayMode={true} 
              tickers={tickers}
              initialTicker={i === 3 ? 'SPY' : tickers[0]}
              initialTf={i === 1 ? '5min' : i === 2 ? '1H' : '1min'}
            />
          ))
        )}
      </main>

      <div className="playback-bar">
        <div className="time-display">
          {formatDisplayTime(currentTime)}
        </div>

        <div className="playback-controls">
          <button className="btn-icon" onClick={stepBackward}><SkipBack size={20} /></button>
          <button className="btn-primary" onClick={togglePlay}>
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            {isPlaying ? 'PAUSE' : 'PLAY'}
          </button>
          <button className="btn-icon" onClick={stepForward}><SkipForward size={20} /></button>
          <button className="btn-icon" onClick={resetToOpen} title="Reset to Market Open"><RotateCcw size={20} /></button>
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
          <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>SPEED</span>
          <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1.0x</option>
            <option value={2}>2.0x</option>
            <option value={5}>5.0x</option>
            <option value={10}>10.0x</option>
          </select>
        </div>
      </div>
    </div>
  );
}
