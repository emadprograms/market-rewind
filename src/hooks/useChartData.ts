import { useState, useEffect, useRef, useMemo } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { ChartBar, GroupColor, RawBar, Timeframe } from '../types';
import { fetchMarketData, fetchHistoricalChunk } from '../lib/db';
import { resampleData } from '../lib/resampling';

interface UseChartDataParams {
  initialTicker: string;
  initialTf: Timeframe;
  initialEth: boolean;
  selectedDate: string;
  isReplayMode: boolean;
  globalTime: string | null;
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
  globalTime,
  groupColor,
  groupTicker,
  tickers,
  chartRef,
  priceSeriesRef,
  onTimeframeChange,
  id,
}: UseChartDataParams) {
  const [ticker, setTicker] = useState<string>(initialTicker || tickers[0]);
  const [localMasterData, setLocalMasterData] = useState<RawBar[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTf || '1D');
  const [showEth, setShowEth] = useState<boolean>(initialEth || false);

  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const earliestLoadedDateRef = useRef<string | null>(null);
  const pendingHistoryPrependRef = useRef<{ oldFirstTime: number | null; oldLogicalRange: any } | null>(null);

  const dataTimeframeRef = useRef(timeframe);

  // Group-to-Ticker Sync
  useEffect(() => {
    if (groupColor !== 'none' && groupTicker && groupTicker !== ticker) {
      setTicker(groupTicker);
    }
  }, [groupColor, groupTicker]);

  // Report timeframe to parent
  useEffect(() => {
    if (onTimeframeChange) onTimeframeChange(id, timeframe);
  }, [timeframe, id, onTimeframeChange]);

  // Initial data fetch
  useEffect(() => {
    let cancelled = false;
    async function load() {
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

  // Infinite Scroll Listener
  useEffect(() => {
    if (!chartRef.current || !localMasterData || localMasterData.length === 0) return;
    
    const timeScale = chartRef.current.timeScale();
    
    const onVisibleLogicalRangeChanged = async (newLogicalRange: any) => {
      if (!newLogicalRange) return;
      
      if (newLogicalRange.from < 100 && !isLoadingHistory && earliestLoadedDateRef.current) {
        setIsLoadingHistory(true);
        try {
          const oldLogicalRange = timeScale.getVisibleLogicalRange();
          const currentChartBars = priceSeriesRef.current ? priceSeriesRef.current.data() : [];
          
          const chunk = await fetchHistoricalChunk(ticker, earliestLoadedDateRef.current, 30);
          
          if (chunk && chunk.length > 0) {
            earliestLoadedDateRef.current = chunk[0].time;
            
            let newData = [...chunk, ...localMasterData];
            
            pendingHistoryPrependRef.current = {
                oldFirstTime: currentChartBars.length > 0 ? (currentChartBars[0] as any).time : null,
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

  // Memoized Chart Data
  const chartData = useMemo(() => {
    if (!localMasterData || localMasterData.length === 0) return [];
    if (timeframe !== dataTimeframeRef.current) return [];
    
    let filtered = (showEth && timeframe !== '1D') ? localMasterData : localMasterData.filter(d => d.session === 'REG');
    
    if (isReplayMode && globalTime) {
      const gt = new Date(globalTime).getTime();
      filtered = filtered.filter(d => new Date(d.time).getTime() <= gt);
    }
    
    return resampleData(filtered, timeframe);
  }, [localMasterData, timeframe, showEth, isReplayMode, globalTime]);

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
