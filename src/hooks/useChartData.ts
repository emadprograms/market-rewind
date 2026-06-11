import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { IChartApi, ISeriesApi, LogicalRange, CandlestickData } from 'lightweight-charts';
import type { ChartBar, GroupColor, RawBar, Timeframe, HistoryPrependState } from '../types';
import { fetchMarketData, fetchHistoricalChunk } from '../lib/db';
import { resampleData } from '../lib/resampling';
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

  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const earliestLoadedDateRef = useRef<string | null>(null);
  const pendingHistoryPrependRef = useRef<HistoryPrependState | null>(null);

  const dataTimeframeRef = useRef(timeframe);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (onTimeframeChange) onTimeframeChange(id, timeframe);
  }, [timeframe, id, onTimeframeChange]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLocalMasterData([]);
      setIsLoadingHistory(true);
      
      let daysBack = 30;
      if (timeframe === '1min') daysBack = 3;
      else if (timeframe === '5min') daysBack = 15;
      else if (timeframe === '15min') daysBack = 30;
      else if (timeframe === '30min') daysBack = 60;
      else if (timeframe === '1H') daysBack = 120;
      else if (timeframe === '1D') daysBack = 365 * 2;
      
      const data = await fetchMarketData(ticker, selectedDate, daysBack);
      if (cancelled) return;
      
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

  const filteredData = useMemo(() => {
    if (!localMasterData || localMasterData.length === 0) return [];
    let filtered = (showEth && timeframe !== '1D') ? localMasterData : localMasterData.filter(d => d.session === 'REG');
    if (isReplayMode && globalTime) {
      filtered = filtered.filter(d => new Date(d.time.replace(' ', 'T') + 'Z').getTime() <= globalTime);
    }
    return filtered;
  }, [localMasterData, timeframe, showEth, isReplayMode, globalTime]);

  // --- HYBRID CACHE IMPLEMENTATION ---
  const cachedCandlesRef = useRef<RawBar[]>([]);
  const lastCacheUpdateRef = useRef<number>(0);
  const tickerRef = useRef(ticker);
  
  const chartData = useMemo(() => {
    if (!filteredData || filteredData.length === 0) {
      cachedCandlesRef.current = [];
      lastCacheUpdateRef.current = 0;
      return [];
    }

    const tfMap: Record<Timeframe, number> = {
      '1min': 1, '5min': 5, '15min': 15, '30min': 30, '1H': 60, '1D': 1440
    };
    const durationMin = tfMap[timeframe] || 1;
    const durationMs = durationMin * 60000;

    // Reset cache if timeframe or ticker changes
    if (dataTimeframeRef.current !== timeframe || tickerRef.current !== ticker) {
      cachedCandlesRef.current = [];
      lastCacheUpdateRef.current = 0;
      dataTimeframeRef.current = timeframe;
      tickerRef.current = ticker;
    }

    // Filter data from the last point we cached
    const tailData = filteredData.filter(bar => {
      const timestamp = new Date(bar.time.replace(' ', 'T') + 'Z').getTime();
      return timestamp >= lastCacheUpdateRef.current;
    });

    const tailStart = performance.now();
    const resampledTail = resampleData(tailData, timeframe);
    const tailEnd = performance.now();
    if (tailData.length > 0) {
      console.log(`[Performance] Tail resampling (${tailData.length} bars) took ${(tailEnd - tailStart).toFixed(2)}ms`);
    }

    // If we have more than 1 resampled candle, it means some are now closed
    if (resampledTail.length > 1) {
      const closedFromTail = resampledTail.slice(0, -1);
      const newCache = [...cachedCandlesRef.current, ...closedFromTail];
      // Deduplicate by time string
      cachedCandlesRef.current = Array.from(new Map(newCache.map(c => [c.time, c])).values());
      
      // Update our pointer to the start of the last (still open) candle
      const lastCandle = resampledTail[resampledTail.length - 1];
      lastCacheUpdateRef.current = new Date(lastCandle.time.replace(' ', 'T') + 'Z').getTime();
    }

    const result = [...cachedCandlesRef.current, ...resampledTail];
    const deduplicated = Array.from(new Map(result.map(c => [c.time, c])).values());
    
    return deduplicated;
  }, [filteredData, timeframe, ticker]);

  return {
    ticker,
    setTicker,
    setTimeframe,
    showEth,
    setShowEth,
    localMasterData,
    chartData,
    isLoadingHistory,
    pendingHistoryPrependRef,
  };
}
