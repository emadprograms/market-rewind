import { useEffect, useCallback } from 'react';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { streamingClient } from '../lib/streamingClient';
import { fetchMarketData } from '../lib/db';
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

  const loadMarketData = useCallback(async () => {
    let data: RawBar[] = [];
    const endBoundary = `${selectedDate} 23:59:59`;
    try {
      data = await streamingClient.getCandles(sessionTicker, {
        timeframe: '1min',
        endTime: endBoundary,
        limit: 5000,
      });
    } catch {
      // Fallback
    }

    if (!data || data.length === 0) {
      try {
        data = (await fetchMarketData(sessionTicker, selectedDate, 1)) || [];
      } catch {
        data = [];
      }
    }

    setMasterData(data);
    
    // Always anchor replay cursor to exactly 9:20 AM ET of selectedDate
    const targetTimeStr = getUtcTimeFromEt(selectedDate, entryTime);
    const targetMs = new Date(targetTimeStr.replace(' ', 'T') + 'Z').getTime();
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
    const targetTimeStr = getUtcTimeFromEt(selectedDate, entryTime);
    const targetMs = new Date(targetTimeStr.replace(' ', 'T') + 'Z').getTime();
    setCurrentTime(targetMs);
    seekTickTime(targetMs);
    setPaused(true);
  }, [selectedDate, entryTime, getUtcTimeFromEt, setCurrentTime, seekTickTime, setPaused]);

  return { handleResetToOpen };
}
