import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Calendar as CalendarIcon, Activity, HardDrive, Database, UploadCloud, ExternalLink } from 'lucide-react';
import ChartUnit from './components/ChartUnit';
import { fetchTickers, fetchMarketData, loadDatabaseFromFile, isDBLoaded, initDB } from './lib/db';

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
  const [dbStatus, setDbStatus] = useState('Checking storage...');
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  
  const playbackRef = useRef();

  // 1. Check OPFS on load
  useEffect(() => {
    checkLocalDatabase();
  }, []);

  async function checkLocalDatabase() {
    setIsLoading(true);
    setDbStatus('Checking local storage...');
    try {
      const db = await initDB();
      if (db) {
        await loadMetaData();
      } else {
        setDbStatus('No data. Please upload market_data.db');
        setIsDbLoaded(false);
      }
    } catch(e) {
      setDbStatus('No data. Please upload market_data.db');
      setIsDbLoaded(false);
    }
    setIsLoading(false);
  }

  async function loadMetaData() {
    try {
      const t = await fetchTickers();
      if (t.length > 0) {
        setTickers(t);
        setIsDbLoaded(true);
        setDbStatus(`${t.length} Tickers active`);
      } else {
        setDbStatus('Database is empty (0 tickers found).');
        setIsDbLoaded(false);
      }
    } catch (e) {
      setDbStatus('Database error. Requires a valid file.');
      setIsDbLoaded(false);
    }
  }

  // 2. Handle File Upload
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      setIsLoading(true);
      setDbStatus('Loading file into memory...');
      await loadDatabaseFromFile(file);
      await loadMetaData();
    } catch(err) {
      setDbStatus('Upload failed. Must be a valid SQLite file.');
      setIsDbLoaded(false);
    } finally {
      setIsLoading(false);
    }
  }

  // 3. Load market data when date or tickers change
  useEffect(() => {
    if (tickers.length > 0 && isDbLoaded) {
      loadMarketData();
    }
  }, [selectedDate, tickers, isDbLoaded]);

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
      
      {/* --- SIDEBAR --- */}
      <aside className="sidebar">
        <div className="logo">
          <Activity size={24} /> MARKET<span>REWIND</span>
        </div>

        <div className={`status-badge ${isDbLoaded ? 'status-online' : ''}`}>
          <Database size={16} />
          <span>{dbStatus}</span>
        </div>

        <div className="sidebar-section">
          <h3>Release Data</h3>
          <a 
            href="https://github.com/emadprograms/market-rewind/releases/tag/latest-data" 
            target="_blank" 
            rel="noopener noreferrer"
            className="upload-zone"
            style={{ textDecoration: 'none', color: 'inherit', borderStyle: 'solid', borderColor: 'rgba(38, 166, 154, 0.3)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-green)', fontWeight: '600', fontSize: '0.85rem' }}>
              <ExternalLink size={16} /> Open GitHub 
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              Download <b>market_data.db</b>
            </div>
          </a>
        </div>

        <div className="sidebar-section">
          <h3>Load Data</h3>
          <label className="upload-zone">
            <UploadCloud size={24} className="file-icon" />
            <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>
              Click to select <b>market_data.db</b>
            </div>
            <input type="file" accept=".db,.sqlite" onChange={handleFileUpload} />
          </label>
        </div>

        <div className="sidebar-section" style={{marginTop: '16px'}}>
           <h3>Replay Settings</h3>
           <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
             <div>
               <label style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>Date</label>
               <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
             </div>
             <div>
               <label style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>Layout Grid</label>
               <select value={gridSize} onChange={(e) => setGridSize(parseInt(e.target.value))}>
                 <option value={1}>1 Chart</option>
                 <option value={2}>2 Charts</option>
                 <option value={3}>3 Charts</option>
                 <option value={4}>4 Charts</option>
               </select>
             </div>
           </div>
        </div>
      </aside>

      {/* --- MAIN CONTENT --- */}
      <div className="main-content">
        <main className={`workspace grid-${gridSize}`}>
          {isLoading ? (
            <div style={{gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>
              Processing...
            </div>
          ) : !isDbLoaded ? (
            <div style={{gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>
               Please upload your database file on the left to begin.
            </div>
          ) : masterData.length === 0 ? (
            <div style={{gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>
              No trading data found for {selectedDate}.
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
            <button className="btn-primary" onClick={togglePlay} disabled={!isDbLoaded || masterData.length === 0}>
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </button>
            <button className="btn-icon" onClick={stepForward}><SkipForward size={20} /></button>
            <button className="btn-icon" onClick={resetToOpen} title="Reset to Market Open"><RotateCcw size={20} /></button>
          </div>

          <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
            <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>SPEED</span>
            <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))} style={{width: 'auto'}}>
              <option value={0.5}>0.5x</option>
              <option value={1}>1.0x</option>
              <option value={2}>2.0x</option>
              <option value={5}>5.0x</option>
              <option value={10}>10.0x</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
