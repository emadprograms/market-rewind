import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { IChartApi, ISeriesApi, LogicalRange, CandlestickData } from 'lightweight-charts';
import type { ChartBar, GroupColor, RawBar, Timeframe, HistoryPrependState } from '../types';
import { TF_SECONDS } from '../types';
import { resampleData } from '../lib/resampling';
import { streamingClient } from '../lib/streamingClient';
import { applyTickToCandles, getBucketTimestamp } from '../lib/candleSynthesizer';
import { buildCandleFromTickSlice } from '../lib/tickSynthesizer';
import { usePlaybackStore, isoToMs } from '../store/usePlaybackStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { getUtcTimeFromEt } from '../lib/timezones';
import type { MarketTick } from '../types';

const EMPTY_TICKS: MarketTick[] = [];

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
  const latestTick = usePlaybackStore((state) => 
    state.latestTickBySymbol?.[ticker.toUpperCase()] || 
    (state.currentTick?.symbol?.toUpperCase() === ticker.toUpperCase() ? state.currentTick : null)
  );
  const symbolTicks = usePlaybackStore((state) => 
    state.ticksBySymbol?.[ticker.toUpperCase()] || EMPTY_TICKS
  );

  // Dynamic Ticker Playback Synchronization (SYNC-04)
  useEffect(() => {
    if (!isReplayMode || !selectedDate || !ticker) return;
    const sym = ticker.toUpperCase();
    const existingTicks = usePlaybackStore.getState().ticksBySymbol?.[sym];
    if (existingTicks && existingTicks.length > 0) return;

    let cancelled = false;
    async function loadTicksForNewSymbol() {
      try {
        const startTime = getUtcTimeFromEt(selectedDate, '09:20');
        const endTime = `${selectedDate} 23:59:59`;
        const newTicks = await streamingClient.getTicks(sym, {
          startTime,
          endTime,
          limit: 100000,
          direction: 'asc',
        });
        if (!cancelled && newTicks && newTicks.length > 0) {
          usePlaybackStore.getState().addSymbolTicks(sym, newTicks);
        }
      } catch {
        // Symbol ticks not available
      }
    }
    loadTicksForNewSymbol();
    return () => { cancelled = true; };
  }, [ticker, isReplayMode, selectedDate]);

  const localMasterDataRef = useRef(localMasterData);
  useEffect(() => {
    localMasterDataRef.current = localMasterData;
  }, [localMasterData]);

  // Pre-cache bar timestamps (once per localMasterData change, NOT per frame)
  const barTimestampsMs = useMemo(() => {
    if (!localMasterData || localMasterData.length === 0) return [];
    return localMasterData.map(d =>
      new Date(d.time.replace(' ', 'T') + (d.time.includes('Z') ? '' : 'Z')).getTime()
    );
  }, [localMasterData]);

  // Pre-cache tick timestamps (once per symbolTicks change, NOT per frame)
  const tickTimestampsMs = useMemo(() => {
    if (!symbolTicks || symbolTicks.length === 0) return [];
    return symbolTicks.map(t => isoToMs(t.time));
  }, [symbolTicks]);

  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const earliestLoadedDateRef = useRef<string | null>(null);
  const lastFetchedEndTimeRef = useRef<string | null>(null);
  const hasMoreHistoryRef = useRef(true);
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
      lastFetchedEndTimeRef.current = null;
      hasMoreHistoryRef.current = true;
      
      let data: RawBar[] = [];
      const endBoundary = selectedDate ? `${selectedDate} 23:59:59` : undefined;
      try {
        data = await streamingClient.getCandles(ticker, { timeframe, endTime: endBoundary, limit: 10000 });
      } catch {
        // Fallback to local DB
      }

      if (cancelled) return;

      console.log(`[useChartData] ${ticker} (${timeframe}) loaded ${data?.length || 0} bars: ${data?.[0]?.time} -> ${data?.[data?.length - 1]?.time}`);
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
    let isSubscribed = false;
    let timeScale: any = null;

    const onVisibleLogicalRangeChanged = async (newLogicalRange: LogicalRange | null) => {
      if (!newLogicalRange) return;
      
      const currentEarliest = earliestLoadedDateRef.current;
      // When scrolled near the left edge of loaded bars, fetch previous chunk
      if (
        newLogicalRange.from < 50 &&
        !isLoadingHistory &&
        currentEarliest &&
        hasMoreHistoryRef.current &&
        lastFetchedEndTimeRef.current !== currentEarliest
      ) {
        lastFetchedEndTimeRef.current = currentEarliest;
        setIsLoadingHistory(true);
        try {
          const oldLogicalRange = timeScale ? timeScale.getVisibleLogicalRange() : null;
          const currentChartBars = priceSeriesRef.current ? (priceSeriesRef.current.data() as CandlestickData[]) : [];
          
          const chunk = await streamingClient.getCandles(ticker, {
            timeframe,
            endTime: currentEarliest,
            limit: 5000,
          });
          
          // Deduplicate: only take chunk candles strictly before the earliest loaded candle
          const cleanChunk = (chunk || []).filter(c => c.time < currentEarliest);

          if (cleanChunk.length > 0) {
            earliestLoadedDateRef.current = cleanChunk[0].time;
            
            let newData = [...cleanChunk, ...localMasterDataRef.current];
            
            pendingHistoryPrependRef.current = {
                oldFirstTime: currentChartBars.length > 0 ? (currentChartBars[0].time as number) : null,
                oldLogicalRange: oldLogicalRange
            };
            
            setLocalMasterData(newData as RawBar[]);
          } else {
            hasMoreHistoryRef.current = false;
          }
        } finally {
          setIsLoadingHistory(false);
        }
      }
    };

    const attachListener = () => {
      if (!chartRef.current || isSubscribed) return false;
      timeScale = chartRef.current.timeScale();
      timeScale.subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChanged);
      isSubscribed = true;
      return true;
    };

    if (!attachListener()) {
      const interval = setInterval(() => {
        if (attachListener()) {
          clearInterval(interval);
        }
      }, 50);
      const timer = setTimeout(() => clearInterval(interval), 3000);
      return () => {
        clearInterval(interval);
        clearTimeout(timer);
        if (isSubscribed && timeScale) {
          timeScale.unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChanged);
        }
      };
    }

    return () => {
      if (isSubscribed && timeScale) {
        timeScale.unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChanged);
      }
    };
  }, [ticker, timeframe, chartRef, priceSeriesRef]);

  // Filter data based on playback time first (strict temporal isolation)
  const filteredData = useMemo(() => {
    if (!localMasterData || localMasterData.length === 0) return [];
    
    let filtered = (timeframe === '1D' || showEth) 
      ? localMasterData 
      : localMasterData.filter((d, i) => !d.session || d.session === 'REG' || d.session.includes('REG'));
    
    // Build index map: if we filtered by session, we need to map filtered indices to original barTimestampsMs indices
    let filteredTimestamps: number[];
    if (filtered === localMasterData) {
      filteredTimestamps = barTimestampsMs;
    } else {
      // Re-derive only for session-filtered bars (session filter is rare and stable)
      filteredTimestamps = filtered.map(d =>
        new Date(d.time.replace(' ', 'T') + (d.time.includes('Z') ? '' : 'Z')).getTime()
      );
    }

    if (isReplayMode && globalTime) {
      if (timeframe === '1D') {
        const startOfTodayMs = Math.floor(globalTime / (86400 * 1000)) * (86400 * 1000);
        if (latestTick) {
          filtered = filtered.filter((_, i) => filteredTimestamps[i] < startOfTodayMs);
        } else {
          const endOfReplayDay = new Date(new Date(globalTime).toISOString().slice(0, 10) + 'T23:59:59.999Z').getTime();
          filtered = filtered.filter((_, i) => filteredTimestamps[i] <= endOfReplayDay);
        }
      } else {
        const durationSec = TF_SECONDS[timeframe] || 60;
        const currentBucketStartMs = Math.floor(globalTime / (durationSec * 1000)) * (durationSec * 1000);
        
        // When live ticks are active for this ticker, exclude any historical bar in or after the current bucket
        if (latestTick) {
          filtered = filtered.filter((_, i) => filteredTimestamps[i] < currentBucketStartMs);
        } else {
          filtered = filtered.filter((_, i) => filteredTimestamps[i] <= globalTime);
        }
      }
    }
    
    return filtered;
  }, [localMasterData, barTimestampsMs, timeframe, showEth, isReplayMode, globalTime, latestTick]);

  // Resample the filtered data to the target timeframe and synthesize live tick
  const chartData = useMemo(() => {
    let resampled = resampleData(filteredData, timeframe);

    if (isReplayMode && globalTime && latestTick && symbolTicks && symbolTicks.length > 0 && tickTimestampsMs.length > 0) {
      const durationSec = TF_SECONDS[timeframe] || 60;
      const currentBucketStartMs = Math.floor(globalTime / (durationSec * 1000)) * (durationSec * 1000);
      const bucketTime = getBucketTimestamp(currentBucketStartMs, timeframe);

      // Binary search for the first tick >= currentBucketStartMs using pre-cached timestamps
      let lo = 0, hi = tickTimestampsMs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tickTimestampsMs[mid] < currentBucketStartMs) lo = mid + 1;
        else hi = mid;
      }

      // Collect bucket ticks from binary search start to globalTime
      const bucketTicks: MarketTick[] = [];
      for (let i = lo; i < symbolTicks.length; i++) {
        if (tickTimestampsMs[i] > globalTime) break;
        if (tickTimestampsMs[i] >= currentBucketStartMs) {
          bucketTicks.push(symbolTicks[i]);
        }
      }

      if (bucketTicks.length > 0) {
        const formingCandle = buildCandleFromTickSlice(
          bucketTicks,
          0,
          bucketTicks.length - 1,
          bucketTime,
          latestTick.session || 'REG'
        );
        if (formingCandle) {
          if (resampled.length > 0 && resampled[resampled.length - 1].time === bucketTime) {
            const last = resampled[resampled.length - 1];
            resampled = [
              ...resampled.slice(0, -1),
              {
                ...last,
                high: Math.max(last.high, formingCandle.high),
                low: Math.min(last.low, formingCandle.low),
                close: formingCandle.close,
                volume: (last.volume || 0) + formingCandle.volume,
              }
            ];
          } else {
            resampled = [...resampled, formingCandle];
          }
        }
      }
    } else if (isReplayMode && latestTick) {
      resampled = applyTickToCandles(resampled, latestTick, timeframe);
    }

    console.log(`[useChartData chartData] ${ticker} (${timeframe}) count=${resampled.length}: ${resampled[0]?.time} -> ${resampled[resampled.length - 1]?.time}`);
    return resampled;
  }, [filteredData, timeframe, isReplayMode, globalTime, latestTick, symbolTicks, tickTimestampsMs]);

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
