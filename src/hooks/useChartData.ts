import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { IChartApi, ISeriesApi, LogicalRange, CandlestickData } from 'lightweight-charts';
import type { ChartBar, GroupColor, RawBar, Timeframe, HistoryPrependState } from '../types';
import { TF_SECONDS } from '../types';
import { fetchMarketData, fetchHistoricalChunk } from '../lib/db';
import { resampleData } from '../lib/resampling';
import { streamingClient } from '../lib/streamingClient';
import { applyTickToCandles, getBucketTimestamp } from '../lib/candleSynthesizer';
import { buildCandleFromTickSlice } from '../lib/tickSynthesizer';
import { usePlaybackStore, isoToMs } from '../store/usePlaybackStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

interface UseChartDataParams {
  initialTicker: string;
  initialTf: Timeframe;
  initialEth: boolean;
  selectedDate: string;
  isReplayMode: boolean;
  groupColor: GroupColor;
  groupTicker?: string;
  tickers: string[];
  chartRef: React.MutableRefObject<IChartApi | null>;
  priceSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  onTimeframeChange?: (id: number, tf: Timeframe) => void;
  onTickerChange?: (ticker: string) => void;
  id: number;
}

export function useChartData({
  initialTicker,
  initialTf,
  initialEth,
  selectedDate,
  isReplayMode,
  groupColor,
  groupTicker,
  tickers,
  chartRef,
  priceSeriesRef,
  onTimeframeChange,
  id,
}: UseChartDataParams) {
  const chartId = id.toString();
  
  // Derive ticker atomically from Workspace Store
  const ticker = useWorkspaceStore((state) => {
    const group = state.groups[chartId] || 'none';
    if (group !== 'none' && state.groupTickers[group]) {
      return state.groupTickers[group];
    }
    return state.tickers[chartId] || initialTicker;
  });

  const setTicker = (newTicker: string) => {
    useWorkspaceStore.getState().setTicker(chartId, newTicker);
  };

  const [localMasterData, setLocalMasterData] = useState<RawBar[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTf || '1D');
  const [showEth, setShowEth] = useState<boolean>(initialEth || false);

  const globalTime = usePlaybackStore((state) => state.currentTime);
  const currentTick = usePlaybackStore((state) => state.currentTick);
  const bufferedTicks = usePlaybackStore((state) => state.bufferedTicks);
  const currentTickIndex = usePlaybackStore((state) => state.currentTickIndex);

  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const earliestLoadedDateRef = useRef<string | null>(null);
  const pendingHistoryPrependRef = useRef<HistoryPrependState | null>(null);

  const dataTimeframeRef = useRef(timeframe);
  const isFirstRender = useRef(true);

  // Report timeframe to parent
  useEffect(() => {
    if (onTimeframeChange) onTimeframeChange(id, timeframe);
  }, [timeframe, id, onTimeframeChange]);

  // Initial data fetch
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLocalMasterData([]);
      setIsLoadingHistory(true);
      
      let data: RawBar[] = [];
      const endBoundary = selectedDate ? `${selectedDate} 23:59:59` : undefined;
      try {
        data = await streamingClient.getCandles(ticker, { timeframe, endTime: endBoundary, limit: 5000 });
      } catch {
        // Fallback to local DB
      }

      if (cancelled) return;

      if (!data || data.length === 0) {
        let daysBack = 30;
        if (['1s', '5s', '15s', '30s', '1min'].includes(timeframe)) daysBack = 3;
        else if (timeframe === '5min') daysBack = 15;
        else if (timeframe === '15min') daysBack = 30;
        else if (timeframe === '30min') daysBack = 60;
        else if (timeframe === '1H') daysBack = 120;
        else if (timeframe === '1D') daysBack = 365 * 2;
        
        data = (await fetchMarketData(ticker, selectedDate, daysBack)) || [];
      }

      if (cancelled) return;
      
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[useChartData] Loaded ${data?.length || 0} bars for ${ticker} at ${timeframe}`);
      }
      if (data && data.length > 0) {
        earliestLoadedDateRef.current = data[0].time;
      }
      dataTimeframeRef.current = timeframe;
      setLocalMasterData(data as RawBar[]);
      setIsLoadingHistory(false);
    }
    load();
    return () => { cancelled = true; };
  }, [ticker, selectedDate, timeframe]);

  // Infinite Scroll Listener
  useEffect(() => {
    if (!chartRef.current || !localMasterData || localMasterData.length === 0) return;
    
    const timeScale = chartRef.current.timeScale();
    
    const onVisibleLogicalRangeChanged = async (newLogicalRange: LogicalRange | null) => {
      if (!newLogicalRange) return;
      
      if (newLogicalRange.from < 100 && !isLoadingHistory && earliestLoadedDateRef.current) {
        setIsLoadingHistory(true);
        try {
          const oldLogicalRange = timeScale.getVisibleLogicalRange();
          const currentChartBars = priceSeriesRef.current ? (priceSeriesRef.current.data() as CandlestickData[]) : [];
          
          const chunk = await fetchHistoricalChunk(ticker, earliestLoadedDateRef.current, 30);
          
          if (chunk && chunk.length > 0) {
            earliestLoadedDateRef.current = chunk[0].time;
            
            let newData = [...chunk, ...localMasterData];
            
            pendingHistoryPrependRef.current = {
                oldFirstTime: currentChartBars.length > 0 ? (currentChartBars[0].time as number) : null,
                oldLogicalRange: oldLogicalRange
            };
            
            setLocalMasterData(newData as RawBar[]);
          }
        } finally {
          setIsLoadingHistory(false);
        }
      }
    };
    
    timeScale.subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChanged);
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChanged);
  }, [localMasterData, isLoadingHistory, ticker, chartRef, priceSeriesRef]);

  // Filter data based on playback time first (strict temporal isolation)
  const filteredData = useMemo(() => {
    if (!localMasterData || localMasterData.length === 0) return [];
    
    let filtered = (timeframe === '1D' || showEth) 
      ? localMasterData 
      : localMasterData.filter(d => !d.session || d.session === 'REG' || d.session.includes('REG'));
    
    if (isReplayMode && globalTime) {
      if (timeframe === '1D') {
        const endOfReplayDay = new Date(new Date(globalTime).toISOString().slice(0, 10) + 'T23:59:59.999Z').getTime();
        filtered = filtered.filter(d => new Date(d.time.replace(' ', 'T') + 'Z').getTime() <= endOfReplayDay);
      } else {
        const durationSec = TF_SECONDS[timeframe] || 60;
        const currentBucketStartMs = Math.floor(globalTime / (durationSec * 1000)) * (durationSec * 1000);
        
        // When live ticks are active for this ticker, exclude any historical bar in or after the current bucket
        if (currentTick && currentTick.symbol === ticker) {
          filtered = filtered.filter(d => new Date(d.time.replace(' ', 'T') + 'Z').getTime() < currentBucketStartMs);
        } else {
          filtered = filtered.filter(d => new Date(d.time.replace(' ', 'T') + 'Z').getTime() <= globalTime);
        }
      }
    }
    
    return filtered;
  }, [localMasterData, timeframe, showEth, isReplayMode, globalTime, currentTick, ticker]);

  // Resample the filtered data to the target timeframe and synthesize live tick
  const chartData = useMemo(() => {
    let resampled = resampleData(filteredData, timeframe);

    if (isReplayMode && globalTime && currentTick && currentTick.symbol === ticker && bufferedTicks.length > 0) {
      const durationSec = TF_SECONDS[timeframe] || 60;
      const currentBucketStartMs = Math.floor(globalTime / (durationSec * 1000)) * (durationSec * 1000);
      const bucketTime = getBucketTimestamp(currentBucketStartMs, timeframe);

      // Find the first tick belonging to the current bucket
      let firstTickInBucket = -1;
      for (let i = currentTickIndex; i >= 0; i--) {
        const tMs = isoToMs(bufferedTicks[i].time);
        if (tMs < currentBucketStartMs) break;
        firstTickInBucket = i;
      }

      if (firstTickInBucket !== -1 && firstTickInBucket <= currentTickIndex) {
        const formingCandle = buildCandleFromTickSlice(
          bufferedTicks,
          firstTickInBucket,
          currentTickIndex,
          bucketTime,
          currentTick.session || 'REG'
        );
        if (formingCandle) {
          resampled = [...resampled, formingCandle];
        }
      }
    } else if (isReplayMode && currentTick && currentTick.symbol === ticker) {
      resampled = applyTickToCandles(resampled, currentTick, timeframe);
    }

    return resampled;
  }, [filteredData, timeframe, isReplayMode, globalTime, currentTick, currentTickIndex, bufferedTicks, ticker]);

  return {
    ticker,
    setTicker,
    timeframe,
    setTimeframe,
    showEth,
    setShowEth,
    localMasterData,
    chartData,
    isLoadingHistory,
    pendingHistoryPrependRef,
  };
}
