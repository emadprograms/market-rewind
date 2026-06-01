import React, { useEffect } from 'react';
import { Activity } from 'lucide-react';

// Hooks
import { useDatabase } from './hooks/useDatabase';
import { useSession } from './hooks/useSession';
import { useWorkspace } from './hooks/useWorkspace';
import { usePortfolio } from './hooks/usePortfolio';
import { useDrawings } from './hooks/useDrawings';
import { useMarketSimulator } from './hooks/useMarketSimulator';
import { usePlaybackStore } from './store/usePlaybackStore';

// Components
import { Sidebar } from './components/Sidebar';
import { SessionConfig } from './components/SessionConfig';
import { ChartWorkspace } from './components/ChartWorkspace';
import { PlaybackBar } from './components/PlaybackBar';
import { PlaybackManager } from './components/PlaybackManager';

export default function App() {
  const { 
    tickers, 
    isLoading, 
    dbStatus, 
    isDbLoaded, 
    handleFileUpload 
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

  useEffect(() => {
    setStepMinutes(activeStepMinutes);
  }, [activeStepMinutes, setStepMinutes]);

  return (
    <div className="app-container">
      <Sidebar 
        dbStatus={dbStatus}
        isDbLoaded={isDbLoaded}
        handleFileUpload={handleFileUpload}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        isSessionStarted={isSessionStarted}
        onEndSession={endSession}
        layoutMode={layoutMode}
        setLayoutMode={setLayoutMode}
      />

      <div className="main-content" style={{ position: 'relative' }}>
        {isLoading ? (
          <main className="workspace" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
             <Activity className="animate-pulse" size={48} />
          </main>
        ) : !isDbLoaded ? (
          <main className="workspace" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
             Please upload your database file on the left to begin.
          </main>
        ) : !isSessionStarted ? (
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
        ) : (
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
        )}

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
