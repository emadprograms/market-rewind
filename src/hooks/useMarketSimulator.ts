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
  const masterData = usePlaybackStore((state) => state.masterData);

  const loadMarketData = useCallback(async () => {
    let data: RawBar[] = [];
    try {
      data = await streamingClient.getCandles(sessionTicker, {
        timeframe: '1min',
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
    
    if (data.length > 0) {
      const targetTimeStr = getUtcTimeFromEt(selectedDate, entryTime);
      const startBar = data.find((d: any) => d.time >= targetTimeStr) || data[0];
      if (startBar) {
        setCurrentTime(new Date(startBar.time.replace(' ', 'T') + 'Z').getTime());
      }
    } else {
      setCurrentTime(null);
    }
  }, [sessionTicker, selectedDate, entryTime, getUtcTimeFromEt, setMasterData, setCurrentTime]);

  useEffect(() => {
    if (isSessionStarted) {
      loadMarketData();
    }
  }, [isSessionStarted, loadMarketData]);

  const handleResetToOpen = useCallback(() => {
    const targetTimeStr = getUtcTimeFromEt(selectedDate, entryTime);
    const startBar = masterData.find(d => d.time >= targetTimeStr) || masterData[masterData.length - 1];
    if (startBar) {
      setCurrentTime(new Date(startBar.time.replace(' ', 'T') + 'Z').getTime());
    }
    setPaused(true);
  }, [masterData, selectedDate, entryTime, getUtcTimeFromEt, setCurrentTime, setPaused]);

  return { handleResetToOpen };
}
