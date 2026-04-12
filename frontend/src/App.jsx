import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, LayoutGrid, Calendar as CalendarIcon, Activity, RefreshCw, HardDrive } from 'lucide-react';
import ChartUnit from './components/ChartUnit';
import { fetchTickers, fetchMarketData, syncWithRemote } from './lib/db';

export default function App() {
  // --- Global State ---
  const [tickers, setTickers] = useState([]);
  const [selectedDate, setSelectedDate] = useState('2024-04-10'); // Fallback default
  const [masterData, setMasterData] = useState([]);
  const [currentTime, setCurrentTime] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [gridSize, setGridSize] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  const playbackRef = useRef();

  // 1. Load data from LOCAL whenever Date or Tickers change
  // Note: We don't fetch tickers on mount anymore, we let the user Sync first
  // OR we try to fetch from local on mount.
  useEffect(() => {
    loadMetaData();
  }, []);

  async function loadMetaData() {
    const t = await fetchTickers();
    if (t.length > 0) {
      setTickers(t);
    }
  }

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
    } else {
        setCurrentTime(null);
    }
    setIsLoading(false);
  }

  // 2. Manual Sync Handler
  const handleSync = async () => {
    try {
      setIsSyncing(true);
      await syncWithRemote();
      setLastSync(new Date().toLocaleTimeString());
      await loadMetaData(); // Reload tickers from local
      await loadMarketData(); // Reload current view from local
    } catch (error) {
      alert("Sync failed: " + error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  // 3. Replay Engine Loop (unchanged logic)
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
           <button 
             className={`btn-sync ${isSyncing ? 'syncing' : ''}`} 
             onClick={handleSync}
             disabled={isSyncing}
             style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: isSyncing ? 'rgba(255,255,255,0.05)' : 'rgba(38, 166, 154, 0.1)',
                color: 'var(--accent-green)',
                border: '1px solid var(--accent-green)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.3s'
             }}
           >
             <RefreshCw size={16} className={isSyncing ? 'spin' : ''} />
             {isSyncing ? 'Syncing...' : 'Sync with Turso'}
           </button>

           <div className="status-badge status-online" style={{background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)'}}>
             <HardDrive size={14} />
             {lastSync ? `Last Sync: ${lastSync}` : 'Local Mode (No Sync)'}
           </div>
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
            Loading market data...
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
