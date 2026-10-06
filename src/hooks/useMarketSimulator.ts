import { useEffect, useCallback, useRef } from 'react';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { streamingClient } from '../lib/streamingClient';
import type { RawBar } from '../types';

export function useMarketSimulator(
  isSessionStarted: boolean,
  sessionTicker: string,
  selectedDate: string,
  entryTime: string,
  getUtcTimeFromEt: (date: string, time: string) => string
) {
  const setMasterData = usePlaybackStore((state) => state.setMasterData);
  const setCurrentTime = usePlaybackStore((state) => state.setCurrentTime);
  const setPaused = usePlaybackStore((state) => state.setPaused);
  const seekTickTime = usePlaybackStore((state) => state.seekTickTime);
  const masterData = usePlaybackStore((state) => state.masterData);
  const sessionGenRef = useRef(0);
  // Refs to avoid stale closure in reset flow (date picked then Initialize before re-render)
  const selectedDateRef = useRef(selectedDate);
  const entryTimeRef = useRef(entryTime);
  selectedDateRef.current = selectedDate;
  entryTimeRef.current = entryTime;

  const loadMarketData = useCallback(async () => {
    const curDate = selectedDateRef.current;
    const curEntry = entryTimeRef.current;
    const currentGen = ++sessionGenRef.current;
    // Synchronously anchor replay cursor to target time before awaiting candles
    const targetTimeStr = getUtcTimeFromEt(curDate, curEntry);
    const targetMs = new Date(targetTimeStr.replace(' ', 'T') + 'Z').getTime();
    setCurrentTime(targetMs);
    seekTickTime(targetMs);
    setPaused(true);

    let data: RawBar[] = [];
    const endBoundary = `${curDate} 23:59:59`;
    try {
      data = await streamingClient.getCandles(sessionTicker, {
        timeframe: '1min',
        endTime: endBoundary,
        limit: 5000,
      });
    } catch {
      // Fallback
    }

    if (currentGen !== sessionGenRef.current) {
      return;
    }

    setMasterData(data || []);
    setCurrentTime(targetMs);
    seekTickTime(targetMs);
    setPaused(true);
  }, [sessionTicker, selectedDate, entryTime, getUtcTimeFromEt, setMasterData, setCurrentTime, seekTickTime, setPaused]);

  useEffect(() => {
    if (isSessionStarted) {
      loadMarketData();
    }
  }, [isSessionStarted, loadMarketData]);

  const handleResetToOpen = useCallback(() => {
    const curDate = selectedDateRef.current;
    const curEntry = entryTimeRef.current;
    const targetTimeStr = getUtcTimeFromEt(curDate, curEntry);
    const targetMs = new Date(targetTimeStr.replace(' ', 'T') + 'Z').getTime();
    setCurrentTime(targetMs);
    seekTickTime(targetMs);
    setPaused(true);
  }, [getUtcTimeFromEt, setCurrentTime, seekTickTime, setPaused]);

  return { handleResetToOpen };
}
