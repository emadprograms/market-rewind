import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Calendar as CalendarIcon, Activity, HardDrive, Database, UploadCloud, ExternalLink } from 'lucide-react';
import ChartUnit from './components/ChartUnit';
import { fetchTickers, fetchMarketData, loadDatabaseFromFile, initDB } from './lib/db';
import { getTzForTicker, getTzLabel } from './lib/timezones';
import type { Timeframe, RawBar, AllDrawings, GroupColor } from './types';

const TODAY = new Date().toISOString().split('T')[0];

export default function App() {
  // --- Global State ---
  const [tickers, setTickers] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => localStorage.getItem('lastUsedDate') || TODAY);
  const [masterData, setMasterData] = useState<RawBar[]>([]);
  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [layoutMode, setLayoutMode] = useState('2v');
  const [isLoading, setIsLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('Checking storage...');
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [isSessionStarted, setIsSessionStarted] = useState(false);
  const [entryTime, setEntryTime] = useState('09:20');
  const [sessionTicker, setSessionTicker] = useState<string>(() => localStorage.getItem('lastUsedTicker') || 'SPY');
  
  const [groupTickers, setGroupTickers] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('groupTickers');
    return saved ? JSON.parse(saved) : { red: 'SPY', blue: 'SPY', green: 'SPY', yellow: 'SPY' };
  });
  
  const [chartGroups, setChartGroups] = useState<Record<number, GroupColor>>(() => {
    const saved = localStorage.getItem('chartGroups');
    return saved ? JSON.parse(saved) : {};
  });
  
  const [maximizedId, setMaximizedId] = useState<number | null>(null);
  const [drawings, setDrawings] = useState<AllDrawings>({}); 
  const [chartTimeframes, setChartTimeframes] = useState<Record<number, Timeframe>>({}); 
  const [manualStepMinutes, setManualStepMinutes] = useState<number | null>(null);
  const [globalPnL, setGlobalPnL] = useState<Record<number, { r: number; u: number }>>({});

  const [panelSizes, setPanelSizes] = useState<Record<string, number[]>>({
    '2v': [50, 50],
    '2h': [50, 50],
    '3': [33.3, 33.3, 33.4],
    '4': [50, 50, 50, 50]
  });
  
  const totalRealized = Object.values(globalPnL).reduce((acc, curr) => acc + curr.r, 0);
  const totalUnrealized = Object.values(globalPnL).reduce((acc, curr) => acc + curr.u, 0);

  const handlePnLUpdate = useCallback((id: number, r: number, u: number) => {
    setGlobalPnL(prev => ({
      ...prev,
      [id]: { r, u }
    }));
  }, []);

  const [activeGutter, setActiveGutter] = useState<number | null>(null);
  const dragInfo = useRef<{ active: boolean; mode: 'v' | 'h' | null; index: number | null }>({ active: false, mode: null, index: null });
  const workspaceRef = useRef<HTMLElement>(null);
  const playbackRef = useRef<ReturnType<typeof setInterval> | undefined>();

  const TF_MINUTES: Record<string, number> = { '1min': 1, '5min': 5, '15min': 15, '30min': 30, '1H': 60, '1D': 1440 };

  const minStepMinutes = Object.values(chartTimeframes).length > 0
    ? Object.values(chartTimeframes).reduce((min, tf) => Math.min(min, TF_MINUTES[tf] || 1), 1440)
    : 1;

  const activeStepMinutes = manualStepMinutes || minStepMinutes;

  useEffect(() => {
    checkLocalDatabase();
  }, []);

  useEffect(() => {
    localStorage.setItem('lastUsedDate', selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    localStorage.setItem('lastUsedTicker', sessionTicker);
  }, [sessionTicker]);

  useEffect(() => {
    localStorage.setItem('chartGroups', JSON.stringify(chartGroups));
  }, [chartGroups]);

  useEffect(() => {
    localStorage.setItem('groupTickers', JSON.stringify(groupTickers));
  }, [groupTickers]);

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
        setSessionTicker(prev => {
          if (t.includes(prev)) return prev;
          return t.includes('SPY') ? 'SPY' : t[0];
        });
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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

  useEffect(() => {
    if (tickers.length > 0 && isDbLoaded && isSessionStarted) {
      loadMarketData();
    }
  }, [selectedDate, entryTime, tickers, isDbLoaded, isSessionStarted]);

  const getUtcTimeFromEt = (dateStr: string, etTimeStr: string) => {
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
    const data = await fetchMarketData(sessionTicker, selectedDate, 1); // added daysBack
    setMasterData(data as RawBar[]);
    
    if (data.length > 0) {
      const targetTimeStr = getUtcTimeFromEt(selectedDate, entryTime);
      const startBar = data.find((d: any) => d.time >= targetTimeStr) || data[data.length - 1];
      setCurrentTime(startBar ? (startBar as any).time : null);
    } else {
      setCurrentTime(null);
    }
    setIsLoading(false);
  }

  const advanceTime = (prev: string | null, stepMinutes: number) => {
    if (!prev || masterData.length === 0) return prev;
    const prevMs = new Date(prev.replace(' ', 'T') + 'Z').getTime();
    const targetMs = prevMs + stepMinutes * 60000;
    const targetStr = new Date(targetMs).toISOString().replace('T', ' ').slice(0, 19);
    const nextBar = masterData.find(d => d.time >= targetStr);
    if (nextBar && nextBar.time !== prev) return nextBar.time;
    return null;
  };

  const rewindTime = (prev: string | null, stepMinutes: number) => {
    if (!prev || masterData.length === 0) return prev;
    const prevMs = new Date(prev.replace(' ', 'T') + 'Z').getTime();
    const targetMs = prevMs - stepMinutes * 60000;
    const targetStr = new Date(targetMs).toISOString().replace('T', ' ').slice(0, 19);
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

  const formatDisplayTime = (isoStr: string | null) => {
    if (!isoStr) return '--:--:--';
    const tz = getTzForTicker(sessionTicker);
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
  
  const handleUpdateDrawings = (ticker: string, type: 'rays' | 'rects', items: any[]) => {
    setDrawings(prev => ({
      ...prev,
      [ticker]: {
        ...(prev[ticker] || { rays: [], rects: [] }),
        [type]: items
      }
    }));
  };

  const handlePointerDown = (mode: 'v' | 'h', index: number, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragInfo.current = { active: true, mode, index };
    setActiveGutter(index);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragInfo.current.active || !workspaceRef.current) return;
    
    const rect = workspaceRef.current.getBoundingClientRect();
    const { mode, index } = dragInfo.current;
    if (index === null) return;
    
    let percent;
    if (mode === 'v') {
      percent = ((e.clientX - rect.left) / rect.width) * 100;
    } else {
      percent = ((e.clientY - rect.top) / rect.height) * 100;
    }
    
    setPanelSizes(prev => {
      const currentSizes = [...(prev[layoutMode] || [])];
      if (currentSizes.length < index + 2) return prev;
      
      const combinedPercent = currentSizes[index] + currentSizes[index + 1];
      
      let relativeStart = 0;
      for (let i = 0; i < index; i++) relativeStart += currentSizes[i];
      
      let newSizeA = percent - relativeStart;
      let newSizeB = combinedPercent - newSizeA;
      
      if (newSizeA < 10) { newSizeA = 10; newSizeB = combinedPercent - 10; }
      if (newSizeB < 10) { newSizeB = 10; newSizeA = combinedPercent - 10; }
      
      currentSizes[index] = newSizeA;
      currentSizes[index + 1] = newSizeB;
      
      return { ...prev, [layoutMode]: currentSizes };
    });
  };

  const handlePointerEnd = () => {
    dragInfo.current.active = false;
    setActiveGutter(null);
  };

  const handleTimeframeChange = (chartId: number, tf: Timeframe) => {
    setChartTimeframes(prev => ({
      ...prev,
      [chartId]: tf
    }));
  };

  function handleTickerChange(chartId: number, newTicker: string) {
    const group = chartGroups[chartId] || 'none';
    if (group !== 'none') {
      setGroupTickers(prev => ({ ...prev, [group]: newTicker }));
    }
  }

  function handleGroupChange(chartId: number, newGroup: GroupColor) {
    setChartGroups(prev => ({ ...prev, [chartId]: newGroup }));
  }

  return (
    <div className="app-container">
      
      {/* --- SIDEBAR --- */}
      <aside className="sidebar">
        <div className="logo" title="Market Rewind">
          <Activity size={24} color="var(--accent-green)" />
        </div>

        <div className={`status-badge ${isDbLoaded ? 'status-online' : ''}`} title={dbStatus} style={{ padding: '6px', borderRadius: '50%' }}>
          <Database size={16} />
        </div>

        <label className="upload-zone" title="Load market_data.db" style={{ padding: '8px', cursor: 'pointer', border: 'none' }}>
          <UploadCloud size={20} className="file-icon" />
          <input type="file" accept=".db,.sqlite" onChange={handleFileUpload} style={{ display: 'none' }} />
        </label>

        <div style={{ position: 'relative', width: '24px', height: '24px', cursor: 'pointer' }} title="Target Date">
          <CalendarIcon size={20} style={{ position: 'absolute', top: 2, left: 2, color: 'var(--text-secondary)' }} />
          <input 
            type="date" 
            value={selectedDate} 
            onChange={(e) => setSelectedDate(e.target.value)} 
            disabled={!isSessionStarted} 
            style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} 
          />
        </div>

        {isSessionStarted && (
          <button className="btn-icon" onClick={() => setIsSessionStarted(false)} title="Reset Session">
            <RotateCcw size={18} color="var(--accent-red)" />
          </button>
        )}

        <div style={{ flex: 1 }}></div>

        <div className="layout-selector" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 4px', marginBottom: 'auto', alignItems: 'center' }}>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <a href="https://github.com/emadprograms/market-rewind/releases/tag/latest-data" target="_blank" rel="noopener noreferrer" title="Latest Market Data">
            <HardDrive size={16} color="var(--text-secondary)" />
          </a>
          <a href="https://github.com/emadprograms/market-rewind/releases/tag/latest-archive" target="_blank" rel="noopener noreferrer" title="Archive Historical Data">
            <Database size={16} color="var(--text-secondary)" />
          </a>
          <a href="https://github.com/emadprograms/market-rewind" target="_blank" rel="noopener noreferrer" title="Source Code">
            <ExternalLink size={16} color="var(--text-secondary)" />
          </a>
        </div>
      </aside>

      {/* --- MAIN CONTENT --- */}
      <div className="main-content" style={{ position: 'relative' }}>

        <main className={`workspace grid-${layoutMode}`} ref={workspaceRef}>
          {isLoading ? (
            <div style={{flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>
               <Activity className="animate-pulse" size={48} />
            </div>
          ) : !isDbLoaded ? (
            <div style={{flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>
               Please upload your database file on the left to begin.
            </div>
          ) : !isSessionStarted ? (
            <div style={{flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
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
                       Start Time ({getTzLabel(getTzForTicker(sessionTicker))})
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
              
              const charts = Array.from({ length: gridCount }).map((_, i) => {
                let initialTicker = sessionTicker;
                let initialTf: Timeframe = '5min';
                let initialEth = false;

                if (gridCount === 2) {
                  if (i === 0) { initialTf = '5min'; initialEth = true; }
                  else if (i === 1) { initialTf = '1D'; }
                } else if (gridCount === 3) {
                  if (i === 0) { initialTf = '5min'; }
                  else if (i === 1) { initialTf = '1H'; }
                  else if (i === 2) { initialTf = '1D'; }
                } else if (gridCount === 4) {
                  if (i === 0) { initialTf = '5min'; }
                  else if (i === 1) { initialTf = '1H'; }
                  else if (i === 2) { initialTf = '1D'; }
                  else if (i === 3) { 
                    initialTicker = tickers.includes('SPY') ? 'SPY' : sessionTicker;
                    initialTf = '5min';
                  }
                }

                const sizes = panelSizes[layoutMode] || [100 / gridCount];
                const style: React.CSSProperties = {};
                if (maximizedId === i) {
                  style.position = 'absolute';
                  style.top = '0';
                  style.left = '0';
                  style.width = '100%';
                  style.height = '100%';
                  style.zIndex = 9999;
                } else if (!maximizedId) {
                  const size = sizes[i] !== undefined ? sizes[i] : (100 / gridCount);
                  if (layoutMode.endsWith('v')) style.width = `${size}%`;
                  if (layoutMode.endsWith('h')) style.height = `${size}%`;
                } else {
                  style.display = 'none';
                }

                return (
                  <ChartUnit 
                    key={`${layoutMode}-${i}`} 
                    id={i} 
                    tickers={tickers} 
                    initialTicker={initialTicker}
                    initialTf={initialTf}
                    initialEth={initialEth}
                    selectedDate={selectedDate} 
                    isReplayMode={isSessionStarted}
                    globalTime={currentTime}
                    isMaximized={maximizedId === i}
                    onToggleMaximize={() => setMaximizedId(maximizedId === i ? null : i)}
                    allDrawings={drawings}
                    onUpdateDrawings={handleUpdateDrawings}
                    onTimeframeChange={handleTimeframeChange}
                    onPnLUpdate={handlePnLUpdate}
                    groupColor={chartGroups[i] || 'none'}
                    groupTicker={groupTickers[chartGroups[i]] as string}
                    onGroupChange={(newGroup) => handleGroupChange(i, newGroup)}
                    onTickerChange={(newTicker) => handleTickerChange(i, newTicker)}
                    style={style}
                  />
                );
              });

              const isResizable = ['2v', '2h', '3v', '3h'].includes(layoutMode);
              
              if (!maximizedId && isResizable) {
                const res: React.ReactNode[] = [];
                const gutterMode = layoutMode.endsWith('v') ? 'v' : 'h';
                charts.forEach((chart, idx) => {
                  res.push(chart);
                  if (idx < charts.length - 1) {
                    res.push(
                      <div 
                        key={`g-${idx}`}
                        className={`gutter gutter-${gutterMode} ${activeGutter === idx ? 'active' : ''}`}
                        onPointerDown={(e) => handlePointerDown(gutterMode, idx, e)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerEnd}
                        onLostPointerCapture={handlePointerEnd}
                      >
                        <div className="gutter-line" />
                      </div>
                    );
                  }
                });
                return res;
              }

              return charts;
            })()

          )}
        </main>

        <div className="playback-bar" style={{ paddingLeft: '16px' }}>
          
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px', 
            fontSize: '0.75rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
            marginRight: '20px', paddingRight: '20px', borderRight: '1px solid rgba(255,255,255,0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>R:</span>
              <span style={{ color: totalRealized >= 0 ? '#26a69a' : '#ef5350' }}>
                {totalRealized >= 0 ? '+' : ''}{totalRealized.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>U:</span>
              <span style={{ color: totalUnrealized >= 0 ? '#26a69a' : '#ef5350' }}>
                {totalUnrealized >= 0 ? '+' : ''}{totalUnrealized.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

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
