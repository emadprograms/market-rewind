import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Calendar as CalendarIcon, Activity, HardDrive, Database, UploadCloud, ExternalLink, Menu } from 'lucide-react';
import ChartUnit from './components/ChartUnit';
import { fetchTickers, fetchMarketData, loadDatabaseFromFile, isDBLoaded, initDB } from './lib/db';
import { getTzForTicker, getTzLabel } from './lib/timezones';

const TODAY = new Date().toISOString().split('T')[0];

export default function App() {
  // --- Global State ---
  const [tickers, setTickers] = useState([]);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [masterData, setMasterData] = useState([]);
  const [currentTime, setCurrentTime] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [layoutMode, setLayoutMode] = useState('2v');
  const [isLoading, setIsLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('Checking storage...');
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSessionStarted, setIsSessionStarted] = useState(false);
  const [entryTime, setEntryTime] = useState('09:20');
  const [sessionTicker, setSessionTicker] = useState('SPY');
  const [maximizedId, setMaximizedId] = useState(null);
  const [drawings, setDrawings] = useState({}); // { ticker: { rays: [], rects: [] } }
  const [chartTimeframes, setChartTimeframes] = useState({}); // { chartId: timeframe }
  const [manualStepMinutes, setManualStepMinutes] = useState(null);

  
  const playbackRef = useRef();

  // Timeframe → minutes mapping
  const TF_MINUTES = { '1min': 1, '5min': 5, '15min': 15, '30min': 30, '1H': 60, '1D': 1440 };

  // Compute the minimum step size from all active chart timeframes
  const minStepMinutes = Object.values(chartTimeframes).length > 0
    ? Object.values(chartTimeframes).reduce((min, tf) => Math.min(min, TF_MINUTES[tf] || 1), 1440)
    : 1; // default to 1 minute if no charts yet

  const activeStepMinutes = manualStepMinutes || minStepMinutes;


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
        // Default session ticker to SPY if available, else first ticker
        setSessionTicker(t.includes('SPY') ? 'SPY' : t[0]);
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

  // 3. Load market data when date or tickers change (only if session started)
  useEffect(() => {
    if (tickers.length > 0 && isDbLoaded && isSessionStarted) {
      loadMarketData();
    }
  }, [selectedDate, entryTime, tickers, isDbLoaded, isSessionStarted]);

  // Helper: Converts ET user input to UTC string to match masterData
  const getUtcTimeFromEt = (dateStr, etTimeStr) => {
    const probeDate = new Date(`${dateStr}T14:00:00Z`);
    const nyHour = new Intl.DateTimeFormat('en-US', { 
      timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' 
    }).format(probeDate);
    const offsetHours = 14 - parseInt(nyHour, 10);
    const [hh, mm] = etTimeStr.split(':');
    const localMs = new Date(`${dateStr}T${hh}:${mm}:00Z`).getTime();
    const targetUtcDate = new Date(localMs + (offsetHours * 3600000));
    return targetUtcDate.toISOString().replace('T', ' ').substring(0, 19);
  };

  async function loadMarketData() {
    setIsLoading(true);
    const data = await fetchMarketData(tickers[0], selectedDate);
    setMasterData(data);
    
    if (data.length > 0) {
      const targetTimeStr = getUtcTimeFromEt(selectedDate, entryTime);
      const startBar = data.find(d => d.time >= targetTimeStr) || data[data.length - 1];
      setCurrentTime(startBar ? startBar.time : null);
    } else {
      setCurrentTime(null);
    }
    setIsLoading(false);
  }

  // 4. Unified Replay Engine — step size driven by minimum timeframe across all charts
  const advanceTime = (prev, stepMinutes) => {
    if (!prev || masterData.length === 0) return prev;
    const prevMs = new Date(prev.replace(' ', 'T') + 'Z').getTime();
    const targetMs = prevMs + stepMinutes * 60000;
    // Find the nearest bar at or after the target time
    const targetStr = new Date(targetMs).toISOString().replace('T', ' ').slice(0, 19);
    const nextBar = masterData.find(d => d.time >= targetStr);
    if (nextBar && nextBar.time !== prev) return nextBar.time;
    // If no bar found ahead, we've reached the end
    return null;
  };

  const rewindTime = (prev, stepMinutes) => {
    if (!prev || masterData.length === 0) return prev;
    const prevMs = new Date(prev.replace(' ', 'T') + 'Z').getTime();
    const targetMs = prevMs - stepMinutes * 60000;
    const targetStr = new Date(targetMs).toISOString().replace('T', ' ').slice(0, 19);
    // Find the nearest bar at or before the target time
    let best = null;
    for (let i = masterData.length - 1; i >= 0; i--) {
      if (masterData[i].time <= targetStr) {
        best = masterData[i].time;
        break;
      }
    }
    return best || masterData[0].time;
  };

  useEffect(() => {
    if (isPlaying && masterData.length > 0) {
      playbackRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          const next = advanceTime(prev, activeStepMinutes);
          if (next === null) {
            setIsPlaying(false);
            return prev;
          }
          return next;
        });
      }, 1000 / playbackSpeed);
    } else {
      clearInterval(playbackRef.current);
    }
    return () => clearInterval(playbackRef.current);
  }, [isPlaying, playbackSpeed, masterData, activeStepMinutes]);


  // --- Handlers ---
  const togglePlay = () => setIsPlaying(!isPlaying);
  const resetToOpen = () => {
    const targetTimeStr = getUtcTimeFromEt(selectedDate, entryTime);
    const startBar = masterData.find(d => d.time >= targetTimeStr) || masterData[masterData.length - 1];
    if (startBar) setCurrentTime(startBar.time);
    setIsPlaying(false);
  };

   const stepForward = () => {
    const next = advanceTime(currentTime, activeStepMinutes);
    if (next) setCurrentTime(next);
  };
 
  const stepBackward = () => {
    const prev = rewindTime(currentTime, activeStepMinutes);
    if (prev) setCurrentTime(prev);
  };


  const formatDisplayTime = (isoStr) => {
    if (!isoStr) return '--:--:--';
    const tz = getTzForTicker(tickers[0]);
    const label = getTzLabel(tz);

    const date = new Date(isoStr.replace(' ', 'T') + 'Z');
    return date.toLocaleString('en-US', { 
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }) + ` ${label}`;
  };
  
  const handleUpdateDrawings = (ticker, type, items) => {
    setDrawings(prev => ({
      ...prev,
      [ticker]: {
        ...(prev[ticker] || { rays: [], rects: [] }),
        [type]: items
      }
    }));
  };

  const handleTimeframeChange = (chartId, tf) => {
    setChartTimeframes(prev => ({
      ...prev,
      [chartId]: tf
    }));
  };

  return (
    <div className="app-container">
      
      {/* --- SIDEBAR --- */}
      <aside className={`sidebar ${isSidebarOpen ? '' : 'closed'}`} style={{ flexShrink: 0 }}>
        <div className="logo" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Activity size={18} /> MARKET<span>REWIND</span>
          </div>
          <button className="btn-icon" onClick={() => setIsSidebarOpen(false)} title="Close Sidebar">
            <Menu size={16} />
          </button>
        </div>

        <div className={`status-badge ${isDbLoaded ? 'status-online' : ''}`} style={{ fontSize: '0.7rem', padding: '6px 10px' }}>
          <Database size={14} />
          <span>{dbStatus}</span>
        </div>

        <div className="sidebar-section">
          <h3>Load Data</h3>
          <label className="upload-zone" style={{ padding: '12px' }}>
            <UploadCloud size={20} className="file-icon" />
            <div style={{fontSize: '0.65rem', color: 'var(--text-secondary)'}}>
              <b>market_data.db</b>
            </div>
            <input type="file" accept=".db,.sqlite" onChange={handleFileUpload} />
          </label>
        </div>

        <div className="sidebar-section">
           <h3>Replay Settings</h3>
           <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
             <div>
               <label style={{fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px', display: 'block'}}>Date</label>
               <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} disabled={!isSessionStarted} style={{ fontSize: '0.85rem' }} />
             </div>
             <div>
                <label style={{fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em'}}>Layout Grid</label>
                <div className="layout-selector">
                  {[
                    { id: '1', class: 'l1' },
                    { id: '2v', class: 'l2v' },
                    { id: '2h', class: 'l2h' },
                    { id: '3', class: 'l3' },
                    { id: '3b', class: 'l3b' },
                    { id: '3l', class: 'l3l' },
                    { id: '3r', class: 'l3r' },
                    { id: '3h', class: 'l3h' },
                    { id: '3v', class: 'l3v' },
                    { id: '4', class: 'l4' }
                  ].map(l => (
                    <div 
                      key={l.id} 
                      className={`layout-icon ${l.class} ${layoutMode === l.id ? 'active' : ''}`}
                      onClick={() => setLayoutMode(l.id)}
                      title={`Layout ${l.id.toUpperCase()}`}
                    >
                      {l.id === '1' && <div />}
                      {l.id === '2v' && <><div/><div/></>}
                      {l.id === '2h' && <><div/><div/></>}
                      {l.id.startsWith('3') && <><div/><div/><div/></>}
                      {l.id === '4' && <><div/><div/><div/><div/></>}
                    </div>
                  ))}
                </div>
             </div>
             {isSessionStarted && (
               <button className="btn-outline" onClick={() => setIsSessionStarted(false)} style={{marginTop: '4px', fontSize: '0.75rem', padding: '6px'}}>
                 <RotateCcw size={12} /> Reset
               </button>
             )}
           </div>
        </div>

        <div className="sidebar-section" style={{ marginTop: 'auto' }}>
          <h3>Links</h3>
          <a 
            href="https://github.com/emadprograms/market-rewind/releases/tag/latest-data" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', color: 'var(--text-secondary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}
          >
            <ExternalLink size={12} /> Market Data (Latest)
          </a>
          <a 
            href="https://github.com/emadprograms/market-rewind/releases/tag/latest-archive" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', color: 'var(--text-secondary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}
          >
            <ExternalLink size={12} /> Archive Data (Historical)
          </a>
          <a 
            href="https://github.com/emadprograms/market-rewind" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', color: 'var(--text-secondary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <ExternalLink size={12} /> Source Code
          </a>
        </div>
      </aside>

      {/* --- MAIN CONTENT --- */}
      <div className="main-content" style={{ position: 'relative' }}>

        <main className={`workspace grid-${layoutMode}`}>
          {isLoading ? (
            <div style={{gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>
               <Activity className="animate-pulse" size={48} />
            </div>
          ) : !isDbLoaded ? (
            <div style={{gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>
               Please upload your database file on the left to begin.
            </div>
          ) : !isSessionStarted ? (
            <div style={{gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
               <div className="session-card">
                 <div style={{marginBottom: '24px', textAlign: 'center'}}>
                   <h2 style={{color: 'var(--accent-green)', marginBottom: '8px'}}>Configure Session</h2>
                   <p style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Set your starting parameters to prevent look-ahead bias.</p>
                 </div>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                    <div>
                      <label style={{fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px'}}>Trade Ticker</label>
                      <select value={sessionTicker} onChange={(e) => setSessionTicker(e.target.value)} style={{fontSize: '1rem', padding: '10px'}}>
                        {tickers.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px'}}>Target Date</label>
                      <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{fontSize: '1rem', padding: '10px'}} />
                    </div>
                   <div>
                     <label style={{fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px'}}>
                       Start Time ({getTzLabel(getTzForTicker(tickers[0]))})
                     </label>
                     <input type="time" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} style={{fontSize: '1rem', padding: '10px'}} />
                   </div>
                   <button className="btn-primary" onClick={() => setIsSessionStarted(true)} style={{padding: '12px', fontSize: '1rem', marginTop: '8px', justifyContent: 'center'}}>
                     <Play size={20} fill="currentColor" /> Initialize Market Simulator
                   </button>
                  </div>
               </div>
            </div>
          ) : (
            // Active Replay Charts
            (() => {
              const gridCount = layoutMode === '1' ? 1 : (layoutMode.startsWith('2') ? 2 : (layoutMode.startsWith('3') ? 3 : 4));
              
              return (maximizedId !== null ? [maximizedId] : Array.from({ length: gridCount }).map((_, i) => i)).map((i) => {
                const hasSPY = tickers.includes('SPY');
                const defaultTicker = i === 1 ? (hasSPY ? 'SPY' : sessionTicker) : sessionTicker;

                return (
                  <ChartUnit 
                    key={i} 
                    id={i} 
                    tickers={tickers} 
                    initialTicker={defaultTicker}
                    initialTf={i === 1 ? '1D' : '5min'}
                    initialEth={i !== 1}
                    selectedDate={selectedDate} 
                    isReplayMode={isSessionStarted}
                    globalTime={currentTime}
                    isMaximized={maximizedId === i}
                    onToggleMaximize={() => setMaximizedId(maximizedId === i ? null : i)}
                    gridCount={gridCount}
                    allDrawings={drawings}
                    onUpdateDrawings={handleUpdateDrawings}
                    onTimeframeChange={handleTimeframeChange}
                  />
                );
              });
            })()

          )}
        </main>

        <div className="playback-bar">
          <button className="btn-icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)} title="Toggle Sidebar" style={{ position: 'absolute', left: '16px' }}>
            <Menu size={20} />
          </button>
          
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

           <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <span style={{fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.05em'}}>STEP</span>
            <select 
              value={manualStepMinutes === null ? 'auto' : manualStepMinutes.toString()} 
              onChange={(e) => setManualStepMinutes(e.target.value === 'auto' ? null : parseInt(e.target.value))}
              style={{width: 'auto', padding: '2px 4px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-green)', background: 'rgba(0,0,0,0.2)'}}
            >
              <option value="auto">Auto ({minStepMinutes >= 1440 ? '1D' : minStepMinutes >= 60 ? `${minStepMinutes / 60}H` : `${minStepMinutes}m`})</option>
              <option value="1">1m</option>
              <option value="5">5m</option>
              <option value="15">15m</option>
              <option value="30">30m</option>
              <option value="60">1 H</option>
              <option value="1440">1 D</option>
            </select>
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
