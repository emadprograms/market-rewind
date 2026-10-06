import { useState, useEffect, useCallback } from 'react';
import { getUtcTimeFromEt } from '../lib/timezones';
import { usePlaybackStore } from '../store/usePlaybackStore';

const DEFAULT_DATE = '2026-09-25';

export function useSession(tickers: string[]) {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const saved = localStorage.getItem('lastUsedDate');
    if (!saved || saved > DEFAULT_DATE) return DEFAULT_DATE;
    return saved;
  });
  const [sessionTicker, setSessionTicker] = useState<string>(() => localStorage.getItem('lastUsedTicker') || 'AAPL');
  const [entryTime, setEntryTime] = useState('09:20');
  const [isSessionStarted, setIsSessionStarted] = useState(false);

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
    localStorage.setItem('lastUsedDate', selectedDate);
  }, [selectedDate]);

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
    setSelectedDate(newDate);
    syncStoreTime(newDate, entryTime);
  }, [entryTime, syncStoreTime]);

  const handleSetEntryTime = useCallback((newTime: string) => {
    setEntryTime(newTime);
    syncStoreTime(selectedDate, newTime);
  }, [selectedDate, syncStoreTime]);

  const startSession = useCallback(() => {
    syncStoreTime(selectedDate, entryTime);
    setIsSessionStarted(true);
  }, [selectedDate, entryTime, syncStoreTime]);

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
