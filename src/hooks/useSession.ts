import { useState, useEffect, useCallback } from 'react';

const TODAY = new Date().toISOString().split('T')[0];

export function useSession(tickers: string[]) {
  const [selectedDate, setSelectedDate] = useState<string>(() => localStorage.getItem('lastUsedDate') || TODAY);
  const [sessionTicker, setSessionTicker] = useState<string>(() => localStorage.getItem('lastUsedTicker') || 'SPY');
  const [entryTime, setEntryTime] = useState('09:20');
  const [isSessionStarted, setIsSessionStarted] = useState(false);

  // Sync sessionTicker with available tickers
  useEffect(() => {
    if (tickers.length > 0) {
      setSessionTicker(prev => {
        if (tickers.includes(prev)) return prev;
        return tickers.includes('SPY') ? 'SPY' : tickers[0];
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

  const startSession = useCallback(() => setIsSessionStarted(true), []);
  const endSession = useCallback(() => setIsSessionStarted(false), []);

  return {
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
  };
}
