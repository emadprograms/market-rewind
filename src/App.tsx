import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Activity, HardDrive, Database, UploadCloud, ExternalLink } from 'lucide-react';
import ChartUnit from './components/ChartUnit';
import ErrorBoundary from './components/ErrorBoundary';
import { PlaybackBar } from './components/PlaybackBar';
import { PlaybackManager } from './components/PlaybackManager';
import { usePlaybackStore } from './store/usePlaybackStore';
import { fetchTickers, fetchMarketData, loadDatabaseFromFile, initDB } from './lib/db';
import { getTzForTicker, getTzLabel } from './lib/timezones';
import type { Timeframe, RawBar, AllDrawings, GroupColor } from './types';

const TODAY = new Date().toISOString().split('T')[0];

export default function App() {
  // --- Global State ---
  const [tickers, setTickers] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => localStorage.getItem('lastUsedDate') || TODAY);
  const [layoutMode, setLayoutMode] = useState('2v');
  const [isLoading, setIsLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('Checking storage...');
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [isSessionStarted, setIsSessionStarted] = useState(false);
  const [entryTime, setEntryTime] = useState('09:20');
  const [sessionTicker, setSessionTicker] = useState<string>(() => localStorage.getItem('lastUsedTicker') || 'SPY');

  // --- Playback Store ---
  const masterData = usePlaybackStore((state) => state.masterData);
  const setMasterData = usePlaybackStore((state) => state.setMasterData);
  const setCurrentTime = usePlaybackStore((state) => state.setCurrentTime);
  const setPaused = usePlaybackStore((state) => state.setPaused);
  const setStepMinutes = usePlaybackStore((state) => state.setStepMinutes);
  
  const [groupTickers, setGroupTickers] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('groupTickers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {
      console.error('Failed to parse groupTickers from localStorage', e);
    }
    return { red: 'SPY', blue: 'SPY', green: 'SPY', yellow: 'SPY' };
  });
  
  const [chartGroups, setChartGroups] = useState<Record<number, GroupColor>>(() => {
    try {
      const saved = localStorage.getItem('chartGroups');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {
      console.error('Failed to parse chartGroups from localStorage', e);
    }
    return {};
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
      if (startBar) {
        setCurrentTime(new Date(startBar.time.replace(' ', 'T') + 'Z').getTime());
      }
    } else {
      setCurrentTime(null);
    }
    setIsLoading(false);
  }

  const handleResetToOpen = () => {
    const targetTimeStr = getUtcTimeFromEt(selectedDate, entryTime);
    const startBar = masterData.find(d => d.time >= targetTimeStr) || masterData[masterData.length - 1];
    if (startBar) {
      setCurrentTime(new Date(startBar.time.replace(' ', 'T') + 'Z').getTime());
    }
    setPaused(true);
  };

  useEffect(() => {
    setStepMinutes(activeStepMinutes);
  }, [activeStepMinutes, setStepMinutes]);

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
                  <ErrorBoundary key={`${layoutMode}-${i}`}>
                    <ChartUnit 
                      id={i} 
                      tickers={tickers} 
                      initialTicker={initialTicker}
                      initialTf={initialTf}
                      initialEth={initialEth}
                      selectedDate={selectedDate} 
                      isReplayMode={isSessionStarted}
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
                  </ErrorBoundary>
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

        <PlaybackBar
          totalRealized={totalRealized}
          totalUnrealized={totalUnrealized}
          isDbLoaded={isDbLoaded}
          sessionTicker={sessionTicker}
          onResetToOpen={handleResetToOpen}
          minStepMinutes={minStepMinutes}
        />
        <PlaybackManager />
      </div>
    </div>
  );
}
