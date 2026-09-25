import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { IChartApi, ISeriesApi, LogicalRange, CandlestickData } from 'lightweight-charts';
import type { ChartBar, GroupColor, RawBar, Timeframe, HistoryPrependState } from '../types';
import { fetchMarketData, fetchHistoricalChunk } from '../lib/db';
import { resampleData } from '../lib/resampling';
import { streamingClient } from '../lib/streamingClient';
import { applyTickToCandles } from '../lib/candleSynthesizer';
import { usePlaybackStore } from '../store/usePlaybackStore';
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
      try {
        data = await streamingClient.getCandles(ticker, { timeframe, limit: 5000 });
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
      
      console.log(`[useChartData] Loaded ${data?.length || 0} bars for ${ticker} at ${timeframe}`);
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

  // Filter data based on playback time first
  const filteredData = useMemo(() => {
    if (!localMasterData || localMasterData.length === 0) return [];
    
    let filtered = (showEth && timeframe !== '1D') ? localMasterData : localMasterData.filter(d => d.session === 'REG');
    
    if (isReplayMode && globalTime) {
      filtered = filtered.filter(d => new Date(d.time.replace(' ', 'T') + 'Z').getTime() <= globalTime);
      
    }
    
    return filtered;
  }, [localMasterData, timeframe, showEth, isReplayMode, globalTime]);

  // Resample the filtered data to the target timeframe and synthesize live tick
  const chartData = useMemo(() => {
    let resampled = resampleData(filteredData, timeframe);
    if (isReplayMode && currentTick && currentTick.symbol === ticker) {
      resampled = applyTickToCandles(resampled, currentTick, timeframe);
    }
    return resampled;
  }, [filteredData, timeframe, isReplayMode, currentTick, ticker]);

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
