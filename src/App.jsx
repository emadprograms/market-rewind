import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, LayoutGrid, Calendar as CalendarIcon, Activity, Download, HardDrive } from 'lucide-react';
import ChartUnit from './components/ChartUnit';
import { fetchTickers, fetchMarketData, refreshMasterData } from './lib/db';

export default function App() {
  // --- Global State ---
  const [tickers, setTickers] = useState([]);
  const [selectedDate, setSelectedDate] = useState('2024-04-10'); 
  const [masterData, setMasterData] = useState([]);
  const [currentTime, setCurrentTime] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [gridSize, setGridSize] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  const playbackRef = useRef();

  // 1. Initial Load: Try fetching from local (already downloaded)
  useEffect(() => {
    loadMetaData();
  }, []);

  async function loadMetaData() {
    try {
      const t = await fetchTickers();
      if (t.length > 0) {
        setTickers(t);
      }
    } catch (e) {
      console.log("No local data found. Please Refresh from GitHub.");
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

  // 2. Manual Refresh from GitHub
  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await refreshMasterData();
      setLastUpdate(new Date().toLocaleTimeString());
      await loadMetaData(); 
      await loadMarketData();
    } catch (error) {
      alert("Refresh failed. Ensure the GitHub 'data-storage' branch exists.");
    } finally {
      setIsRefreshing(false);
    }
  };

  // 3. Replay Engine Loop
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
             className={`btn-sync ${isRefreshing ? 'syncing' : ''}`} 
             onClick={handleRefresh}
             disabled={isRefreshing}
             style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: isRefreshing ? 'rgba(255,255,255,0.05)' : 'rgba(38, 166, 154, 0.1)',
                color: 'var(--accent-green)',
                border: '1px solid var(--accent-green)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.3s'
             }}
           >
             <Download size={16} className={isRefreshing ? 'spin' : ''} />
             {isRefreshing ? 'Updating Master File...' : 'Fetch latest from GitHub'}
           </button>

           <div className="status-badge" style={{background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)'}}>
             <HardDrive size={14} />
             {lastUpdate ? `Last Fetch: ${lastUpdate}` : 'No Local Storage'}
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
