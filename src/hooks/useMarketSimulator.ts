import { useEffect, useCallback } from 'react';
import { usePlaybackStore } from '../store/usePlaybackStore';
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
    const data = await fetchMarketData(sessionTicker, selectedDate, 1);
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
