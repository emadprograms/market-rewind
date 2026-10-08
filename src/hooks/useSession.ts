import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { getYesterdayDate } from '../lib/timezones';

export function useSession(tickers: string[]) {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    // Purge legacy hardcoded default date from localStorage if present
    const saved = localStorage.getItem('lastUsedDate');
    if (saved === '2026-09-25') {
      localStorage.removeItem('lastUsedDate');
    }
    return getYesterdayDate();
  });
  const [sessionTicker, setSessionTicker] = useState<string>(() => localStorage.getItem('lastUsedTicker') || 'AAPL');
  const [entryTime, setEntryTime] = useState('09:10');
  const [isSessionStarted, setIsSessionStarted] = useState(false);

  // Refs to avoid stale closure when startSession is called immediately after date/time change
  // (e.g., user picks date then clicks Initialize before React re-renders)
  const selectedDateRef = useRef(selectedDate);
  const entryTimeRef = useRef(entryTime);
  // Keep refs in sync on every render (synchronous, not via effect)
  selectedDateRef.current = selectedDate;
  entryTimeRef.current = entryTime;

  // Sync sessionTicker with available tickers
  useEffect(() => {
    if (tickers.length > 0) {
      setSessionTicker(prev => {
        if (tickers.includes(prev)) return prev;
        return tickers.includes('AAPL') ? 'AAPL' : tickers[0];
      });
    }
  }, [tickers]);

  // Persistence
  useEffect(() => {
    localStorage.setItem('lastUsedTicker', sessionTicker);
  }, [sessionTicker]);

  const getUtcTimeFromEt = useCallback((dateStr: string, etTimeStr: string) => {
    const probeDate = new Date(`${dateStr}T14:00:00Z`);
    const nyHour = new Intl.DateTimeFormat('en-US', { 
      timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' 
    }).format(probeDate);
    const offsetHours = 14 - parseInt(nyHour, 10);
    const [hh, mm] = etTimeStr.split(':');
    const localMs = new Date(`${dateStr}T${hh}:${mm}:00Z`).getTime();
    const targetUtcDate = new Date(localMs + (offsetHours * 3600000));
    return targetUtcDate.toISOString().replace('T', ' ').substring(0, 19);
  }, []);

  const syncStoreTime = useCallback((dateStr: string, timeStr: string) => {
    const targetTimeStr = getUtcTimeFromEt(dateStr, timeStr);
    const targetMs = new Date(targetTimeStr.replace(' ', 'T') + 'Z').getTime();
    usePlaybackStore.getState().setCurrentTime(targetMs);
    usePlaybackStore.getState().seekTickTime(targetMs);
    usePlaybackStore.getState().setPaused(true);
  }, [getUtcTimeFromEt]);

  // Synchronously seed initial currentTime on mount if not already populated
  useEffect(() => {
    if (usePlaybackStore.getState().currentTime === null) {
      syncStoreTime(selectedDate, entryTime);
    }
  }, [selectedDate, entryTime, syncStoreTime]);

  const handleSetSelectedDate = useCallback((newDate: string) => {
    // Update ref synchronously so subsequent startSession sees latest value even before re-render
    selectedDateRef.current = newDate;
    setSelectedDate(newDate);
    syncStoreTime(newDate, entryTimeRef.current);
  }, [syncStoreTime]);

  const handleSetEntryTime = useCallback((newTime: string) => {
    entryTimeRef.current = newTime;
    setEntryTime(newTime);
    syncStoreTime(selectedDateRef.current, newTime);
  }, [syncStoreTime]);

  const startSession = useCallback(() => {
    // Read from refs to guarantee we use the latest date/time even if closure is stale
    const date = selectedDateRef.current;
    const time = entryTimeRef.current;
    syncStoreTime(date, time);
    setIsSessionStarted(true);
  }, [syncStoreTime]);

  const endSession = useCallback(() => {
    setIsSessionStarted(false);
    usePlaybackStore.getState().setPaused(true);
  }, []);

  return {
    selectedDate,
    setSelectedDate: handleSetSelectedDate,
    sessionTicker,
    setSessionTicker,
    entryTime,
    setEntryTime: handleSetEntryTime,
    isSessionStarted,
    startSession,
    endSession,
    getUtcTimeFromEt
  };
}
