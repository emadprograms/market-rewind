import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Activity } from 'lucide-react';

// Hooks
import { useDatabase } from './hooks/useDatabase';
import { useSession } from './hooks/useSession';
import { useWorkspace } from './hooks/useWorkspace';
import { usePortfolio } from './hooks/usePortfolio';
import { useDrawings } from './hooks/useDrawings';
import { useMarketSimulator } from './hooks/useMarketSimulator';
import { usePlaybackStore, isoToMs } from './store/usePlaybackStore';
import { useWorkspaceStore } from './store/useWorkspaceStore';
import { streamingClient } from './lib/streamingClient';

// Components
import { Sidebar } from './components/Sidebar';
import { SessionConfig } from './components/SessionConfig';
import { ChartWorkspace } from './components/ChartWorkspace';
import { PlaybackBar } from './components/PlaybackBar';
import { PlaybackManager } from './components/PlaybackManager';
import { TimeAndSales } from './components/TimeAndSales';
import { ConnectionSetupCard } from './components/ConnectionSetupCard';

export default function App() {
  const { 
    tickers, 
    isLoading, 
    dbStatus, 
    isDbLoaded, 
    isStreamingConnected,
    serviceUrl,
    changeServiceUrl,
    resetServiceUrl
  } = useDatabase();

  const {
    selectedDate,
    setSelectedDate,
    sessionTicker,
    setSessionTicker,
    entryTime,
    setEntryTime,
    isSessionStarted,
    startSession,
    endSession,
    getUtcTimeFromEt
  } = useSession(tickers);

  const {
    layoutMode,
    setLayoutMode,
    maximizedId,
    toggleMaximize,
    panelSizes,
    activeGutter,
    groupTickers,
    chartGroups,
    workspaceRef,
    minStepMinutes,
    activeStepMinutes,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    handleTickerChange,
    handleGroupChange,
    handleTimeframeChange,
    handleSelectChart,
    selectedChartId
  } = useWorkspace();

  const activeChartTicker = useWorkspaceStore((state) => {
    const activeId = selectedChartId !== null && selectedChartId !== undefined ? String(selectedChartId) : (state.selectedId || '0');
    const group = state.groups[activeId] || 'none';
    if (group !== 'none' && state.groupTickers[group]) {
      return state.groupTickers[group];
    }
    return state.tickers[activeId] || sessionTicker;
  });

  const {
    totalRealized,
    totalUnrealized,
    handlePnLUpdate
  } = usePortfolio();

  const {
    drawings,
    handleUpdateDrawings
  } = useDrawings();

  const { handleResetToOpen } = useMarketSimulator(
    isSessionStarted,
    sessionTicker,
    selectedDate,
    entryTime,
    getUtcTimeFromEt
  );

  const setStepMinutes = usePlaybackStore((state) => state.setStepMinutes);
  const setBufferedTicks = usePlaybackStore((state) => state.setBufferedTicks);

  const [isTapeOpen, setIsTapeOpen] = useState(false);

  useEffect(() => {
    setStepMinutes(activeStepMinutes);
  }, [activeStepMinutes, setStepMinutes]);

  const sessionGenRef = useRef(0);
  // Keep latest selectedDate/entryTime in refs to avoid stale closure when
  // startSession triggers load before App re-renders with new date (reset flow)
  const selectedDateRef = useRef(selectedDate);
  const entryTimeRef = useRef(entryTime);
  selectedDateRef.current = selectedDate;
  entryTimeRef.current = entryTime;

  // Buffer live ticks when session begins or date/ticker changes
  const loadStreamingTicks = useCallback(async () => {
    if (!sessionTicker) return;
    // Use refs to get latest date/time even if closure is stale (reset→pick date→Initialize race)
    const curDate = selectedDateRef.current;
    const curEntry = entryTimeRef.current;
    const currentGen = ++sessionGenRef.current;
    const { setIsLoadingTicks, setBufferedTicks } = usePlaybackStore.getState();
    setIsLoadingTicks(true);
    try {
      const queryStartEt = curEntry && curEntry < '09:20' ? curEntry : '09:20';
      const startTime = getUtcTimeFromEt(curDate, queryStartEt);
      const endTime = `${curDate} 23:59:59`;
      const targetTimeStr = getUtcTimeFromEt(curDate, curEntry || '09:20');
      const targetMs = new Date(targetTimeStr.replace(' ', 'T') + 'Z').getTime();
      usePlaybackStore.getState().setCurrentTime(targetMs);
      usePlaybackStore.getState().seekTickTime(targetMs);
      usePlaybackStore.getState().setPaused(true);

      // Collect all active tickers across workspace (charts, groups, session)
      const ws = useWorkspaceStore.getState();
      const activeSymbols = Array.from(new Set([
        sessionTicker,
        ...Object.values(ws.tickers || {}),
        ...Object.values(ws.groupTickers || {}),
      ].filter(Boolean)));

      const results = await Promise.all(
        activeSymbols.map(sym =>
          streamingClient.getTicks(sym, {
            startTime,
            endTime,
            limit: 100000,
            direction: 'asc',
          }).catch(() => [])
        )
      );

      // REV-FORM-03: Stale response guard
      if (currentGen !== sessionGenRef.current) {
        return;
      }

      const allTicks = results.flat().sort(
        (a, b) => isoToMs(a.time) - isoToMs(b.time)
      );

      if (allTicks && allTicks.length > 0) {
        setBufferedTicks(allTicks);
        usePlaybackStore.getState().seekTickTime(targetMs);
        usePlaybackStore.getState().setCurrentTime(targetMs);
        usePlaybackStore.getState().setPaused(true);
      } else {
        // Market closed / No ticks recorded for this date (e.g. holiday or weekend)
        setBufferedTicks([]);
        usePlaybackStore.getState().setCurrentTime(targetMs);
        usePlaybackStore.getState().setPaused(true);
      }
    } catch (e) {
      if (currentGen !== sessionGenRef.current) return;
      console.warn('Could not load streaming ticks into replay buffer:', e);
      setBufferedTicks([]);
    } finally {
      if (currentGen === sessionGenRef.current) {
        setIsLoadingTicks(false);
      }
    }
  }, [sessionTicker, selectedDate, entryTime, getUtcTimeFromEt]);

  useEffect(() => {
    if (isSessionStarted) {
      loadStreamingTicks();
    }
  }, [isSessionStarted, sessionTicker, selectedDate, loadStreamingTicks]);

  return (
    <div className="app-container">
      <Sidebar 
        dbStatus={dbStatus}
        isDbLoaded={isDbLoaded}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        isSessionStarted={isSessionStarted}
        onEndSession={endSession}
        layoutMode={layoutMode}
        setLayoutMode={setLayoutMode}
        serviceUrl={serviceUrl}
        onUpdateServiceUrl={changeServiceUrl}
        onResetServiceUrl={resetServiceUrl}
      />

      <div className="main-content" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
            {isLoading ? (
              <main className="workspace" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                 <Activity className="animate-pulse" size={48} />
              </main>
            ) : !isDbLoaded ? (
              <main className="workspace" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 <ConnectionSetupCard
                   currentUrl={serviceUrl}
                   dbStatus={dbStatus}
                   onConnect={changeServiceUrl}
                 />
              </main>
            ) : (
              <>
                <ChartWorkspace 
                  layoutMode={layoutMode}
                  maximizedId={maximizedId}
                  panelSizes={panelSizes}
                  activeGutter={activeGutter}
                  tickers={tickers}
                  sessionTicker={sessionTicker}
                  selectedDate={selectedDate}
                  isSessionStarted={isSessionStarted}
                  drawings={drawings}
                  chartGroups={chartGroups}
                  groupTickers={groupTickers}
                  workspaceRef={workspaceRef}
                  selectedChartId={selectedChartId}
                  onSelectChart={handleSelectChart}
                  onToggleMaximize={toggleMaximize}
                  onUpdateDrawings={handleUpdateDrawings}
                  onPnLUpdate={handlePnLUpdate}
                  onTickerChange={handleTickerChange}
                  onTimeframeChange={handleTimeframeChange}
                  onGroupChange={handleGroupChange}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerEnd={handlePointerEnd}
                />
                {!isSessionStarted && (
                  <div 
                    className="session-config-overlay"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(10, 14, 23, 0.75)',
                      backdropFilter: 'blur(3px)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 5000,
                    }}
                  >
                    <SessionConfig 
                      tickers={tickers}
                      sessionTicker={sessionTicker}
                      setSessionTicker={setSessionTicker}
                      selectedDate={selectedDate}
                      setSelectedDate={setSelectedDate}
                      entryTime={entryTime}
                      setEntryTime={setEntryTime}
                      onStartSession={startSession}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Time & Sales Order Flow Drawer */}
          {isTapeOpen && (
            <TimeAndSales
              isOpen={isTapeOpen}
              onClose={() => setIsTapeOpen(false)}
              symbol={activeChartTicker || sessionTicker}
            />
          )}
        </div>

        <PlaybackBar
          totalRealized={totalRealized}
          totalUnrealized={totalUnrealized}
          isDbLoaded={isDbLoaded}
          sessionTicker={sessionTicker}
          onResetToOpen={handleResetToOpen}
          minStepMinutes={minStepMinutes}
          isTapeOpen={isTapeOpen}
          onToggleTape={() => setIsTapeOpen(!isTapeOpen)}
        />
        <PlaybackManager />
      </div>
    </div>
  );
}
