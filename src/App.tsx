import React, { useEffect, useState, useCallback } from 'react';
import { Activity } from 'lucide-react';

// Hooks
import { useDatabase } from './hooks/useDatabase';
import { useSession } from './hooks/useSession';
import { useWorkspace } from './hooks/useWorkspace';
import { usePortfolio } from './hooks/usePortfolio';
import { useDrawings } from './hooks/useDrawings';
import { useMarketSimulator } from './hooks/useMarketSimulator';
import { usePlaybackStore, isoToMs } from './store/usePlaybackStore';
import { streamingClient } from './lib/streamingClient';
import { synthesizeTicksFromBars } from './lib/tickSynthesizer';

// Components
import { Sidebar } from './components/Sidebar';
import { SessionConfig } from './components/SessionConfig';
import { ChartWorkspace } from './components/ChartWorkspace';
import { PlaybackBar } from './components/PlaybackBar';
import { PlaybackManager } from './components/PlaybackManager';
import { TimeAndSales } from './components/TimeAndSales';

export default function App() {
  const { 
    tickers, 
    isLoading, 
    dbStatus, 
    isDbLoaded, 
    isStreamingConnected 
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
  const setBufferedTicks = usePlaybackStore((state) => state.setBufferedTicks);

  const [isTapeOpen, setIsTapeOpen] = useState(false);

  useEffect(() => {
    setStepMinutes(activeStepMinutes);
  }, [activeStepMinutes, setStepMinutes]);

  // Buffer live ticks when session begins or date/ticker changes
  const loadStreamingTicks = useCallback(async () => {
    if (!sessionTicker) return;
    try {
      const startTime = getUtcTimeFromEt(selectedDate, '09:20');
      const endTime = `${selectedDate} 23:59:59`;
      const targetMs = new Date(startTime.replace(' ', 'T') + 'Z').getTime();

      let ticks = await streamingClient.getTicks(sessionTicker, {
        startTime,
        endTime,
        limit: 100000,
        direction: 'asc',
      });

      // If raw ticks exist but first tick starts after 9:20 AM ET (e.g. 13:28):
      // Fetch 1m candles for 13:20 to first tick time, synthesize micro-ticks, and prepend them
      if (ticks && ticks.length > 0) {
        const firstTickMs = isoToMs(ticks[0].time);
        if (firstTickMs > targetMs + 30000) {
          try {
            const gapCandles = await streamingClient.getCandles(sessionTicker, {
              timeframe: '1min',
              startTime,
              endTime: ticks[0].time.slice(0, 19),
              limit: 100,
            });
            if (gapCandles && gapCandles.length > 0) {
              const gapTicks = synthesizeTicksFromBars(gapCandles, sessionTicker);
              ticks = [...gapTicks, ...ticks];
            }
          } catch {
            // ignore gap fetch error
          }
        }
      }

      // If no raw ticks exist for this date at all, synthesize from 1-minute historical candles
      if (!ticks || ticks.length === 0) {
        try {
          const dayCandles = await streamingClient.getCandles(sessionTicker, {
            timeframe: '1min',
            startTime,
            endTime,
            limit: 5000,
          });
          if (dayCandles && dayCandles.length > 0) {
            ticks = synthesizeTicksFromBars(dayCandles, sessionTicker);
          }
        } catch {
          // ignore
        }
      }

      if (ticks && ticks.length > 0) {
        setBufferedTicks(ticks);
        usePlaybackStore.getState().seekTickTime(targetMs);
        usePlaybackStore.getState().setCurrentTime(targetMs);
        usePlaybackStore.getState().setPaused(true);
      }
    } catch (e) {
      console.warn('Could not load streaming ticks into replay buffer:', e);
    }
  }, [sessionTicker, selectedDate, getUtcTimeFromEt, setBufferedTicks]);

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
      />

      <div className="main-content" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
            {isLoading ? (
              <main className="workspace" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                 <Activity className="animate-pulse" size={48} />
              </main>
            ) : !isDbLoaded ? (
              <main className="workspace" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                 Please ensure DuckDB streaming service is running at localhost:8000.
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
          </div>

          {/* Time & Sales Order Flow Drawer */}
          {isTapeOpen && (
            <TimeAndSales
              isOpen={isTapeOpen}
              onClose={() => setIsTapeOpen(false)}
              symbol={sessionTicker}
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
