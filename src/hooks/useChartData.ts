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
import { getUtcTimeFromEt, isRthBar, isRthTick } from '../lib/timezones';
import type { MarketTick } from '../types';

const EMPTY_TICKS: MarketTick[] = [];
const inFlightTickFetches = new Set<string>();
const INITIAL_CANDLE_LIMIT = 1500;

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
  const [timeframe, setTimeframeLocal] = useState<Timeframe>(initialTf || '1D');
  const setStoreTimeframe = useWorkspaceStore((state) => state.setTimeframe);
  const setTimeframe = (tf: Timeframe) => {
    setTimeframeLocal(tf);
    setStoreTimeframe(chartId, tf);
  };
  const [showEth, setShowEth] = useState<boolean>(initialEth || false);

  // PERF-01: Decouple high-frequency playback store state from React re-renders.
  // During active playback (isPaused === false), ticks update the canvas directly in useChartLifecycle.
  // React state (globalTime, latestTick, symbolTicks) only updates when PAUSED (seeking, stepping, initial load)
  // or on playback pause transitions to commit the final state.
  const [globalTime, setGlobalTime] = useState<number | null>(() => usePlaybackStore.getState().currentTime);
  const [latestTick, setLatestTick] = useState<MarketTick | null>(() => {
    const s = usePlaybackStore.getState();
    const sym = ticker.toUpperCase();
    return s.latestTickBySymbol?.[sym] || (s.currentTick?.symbol?.toUpperCase() === sym ? s.currentTick : null);
  });
  const [symbolTicks, setSymbolTicks] = useState<MarketTick[]>(() => {
    return usePlaybackStore.getState().ticksBySymbol?.[ticker.toUpperCase()] || EMPTY_TICKS;
  });
  const masterData = usePlaybackStore((state) => state.masterData);

  useEffect(() => {
    const sym = ticker.toUpperCase();
    const updateStaticState = (s: any) => {
      setGlobalTime(s.currentTime);
      setLatestTick(
        s.latestTickBySymbol?.[sym] || 
        (s.currentTick?.symbol?.toUpperCase() === sym ? s.currentTick : null)
      );
      setSymbolTicks(s.ticksBySymbol?.[sym] || EMPTY_TICKS);
    };

    updateStaticState(usePlaybackStore.getState());

    let prevTicks = usePlaybackStore.getState().ticksBySymbol?.[sym];
    const unsub = usePlaybackStore.subscribe((state) => {
      const currentTicks = state.ticksBySymbol?.[sym];
      const ticksChanged = currentTicks !== prevTicks;
      if (ticksChanged) {
        prevTicks = currentTicks;
      }
      if (state.isPaused || ticksChanged) {
        updateStaticState(state);
      }
    });

    return unsub;
  }, [ticker]);

  const defaultCutoff = useMemo(() => {
    if (!selectedDate) return 0;
    const targetStr = getUtcTimeFromEt(selectedDate, '09:30');
    return new Date(targetStr.replace(' ', 'T') + 'Z').getTime();
  }, [selectedDate]);

  const effectiveCutoff = (() => {
    if (isReplayMode && globalTime) return globalTime;
    if (globalTime) return globalTime;
    // When no globalTime is set yet, use Infinity to show ALL loaded data
    // rather than defaultCutoff which clips to 09:30 and can cause single-candle display
    if (!isReplayMode) return Infinity;
    return defaultCutoff;
  })();

  // Dynamic Ticker Playback Synchronization (SYNC-04)
  useEffect(() => {
    if (!isReplayMode || !selectedDate || !ticker) return;
    const sym = ticker.toUpperCase();
    const existingTicks = usePlaybackStore.getState().ticksBySymbol?.[sym];
    if (existingTicks && existingTicks.length > 0) return;
    if (inFlightTickFetches.has(sym)) return;

    inFlightTickFetches.add(sym);
    let cancelled = false;
    const abortCtrl = new AbortController();

    async function loadTicksForNewSymbol() {
      try {
        const startTime = getUtcTimeFromEt(selectedDate, '09:10');
        const endTime = `${selectedDate} 23:59:59`;
        const newTicks = await streamingClient.getTicks(sym, {
          startTime,
          endTime,
          limit: 100000,
          direction: 'asc',
          signal: abortCtrl.signal,
        });
        if (!cancelled && newTicks && newTicks.length > 0) {
          usePlaybackStore.getState().addSymbolTicks(sym, newTicks);
        }
      } catch {
        // Symbol ticks not available
      } finally {
        inFlightTickFetches.delete(sym);
      }
    }
    loadTicksForNewSymbol();
    return () => {
      cancelled = true;
      abortCtrl.abort();
      inFlightTickFetches.delete(sym);
    };
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
  const loadedTickerRef = useRef<string>(ticker);
  const isFirstRender = useRef(true);

  // Report timeframe to parent
  useEffect(() => {
    if (onTimeframeChange) onTimeframeChange(id, timeframe);
  }, [timeframe, id, onTimeframeChange]);

  useEffect(() => {
    let cancelled = false;
    const abortCtrl = new AbortController();

    async function load() {
      console.log(`[useChartData ${id}] load() START: ${ticker} (${timeframe}) date=${selectedDate}`);

      // LIVE-CONTEXT-01: Treat symbol, date, and timeframe changes as explicit render-context changes
      // Clear data immediately so we don't render old history on a new symbol while pending
      if (loadedTickerRef.current !== ticker || dataTimeframeRef.current !== timeframe) {
        setLocalMasterData([]);
        localMasterDataRef.current = [];
        loadedTickerRef.current = ticker;
        dataTimeframeRef.current = timeframe;
      }

      setIsLoadingHistory(true);
      lastFetchedEndTimeRef.current = null;
      hasMoreHistoryRef.current = true;
      
      let data: RawBar[] = [];
      const endBoundary = selectedDate ? `${selectedDate} 23:59:59` : undefined;
      try {
        data = await streamingClient.getCandles(ticker, {
          timeframe,
          endTime: endBoundary,
          limit: INITIAL_CANDLE_LIMIT,
          signal: abortCtrl.signal,
        });
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn(`[useChartData ${id}] getCandles ERROR:`, err);
        }
      }

      if (cancelled || abortCtrl.signal.aborted) {
        console.log(`[useChartData ${id}] load() CANCELLED before setLocalMasterData: ${ticker} (${timeframe})`);
        return;
      }

      console.log(`[useChartData ${id}] ${ticker} (${timeframe}) loaded ${data?.length || 0} bars: ${data?.[0]?.time} -> ${data?.[data?.length - 1]?.time}`);
      

      if (data && data.length === 1 && timeframe !== '1D') {
        // Preserve selectedDate boundary on retry - previously this retried with open
        // end boundary (no selectedDate), which ignored the chosen date and loaded all
        // history till end. Keep the same endBoundary and limit.
        console.warn(`[useChartData ${id}] Suspicious single bar received for ${ticker} (${timeframe}) date=${selectedDate}. Retrying with same bounded window...`);
        try {
          const retryData = await streamingClient.getCandles(ticker, {
            timeframe,
            endTime: endBoundary,
            limit: INITIAL_CANDLE_LIMIT,
            signal: abortCtrl.signal,
          });
          if (!cancelled && !abortCtrl.signal.aborted && retryData && retryData.length > 1) {
            console.log(`[useChartData ${id}] Retry succeeded: received ${retryData.length} bars`);
            data = retryData;
          }
        } catch (retryErr: any) {
          if (retryErr?.name !== 'AbortError') {
            console.warn(`[useChartData ${id}] Retry failed:`, retryErr);
          }
        }
      }

      if (data && data.length > 0) {
        earliestLoadedDateRef.current = data[0].time;
      }
      dataTimeframeRef.current = timeframe;
      const tickerChanged = loadedTickerRef.current !== ticker;
      loadedTickerRef.current = ticker;
      setLocalMasterData((prev: RawBar[]) => {
        if (!tickerChanged && prev === data) return prev;
        if (
          !tickerChanged &&
          prev.length === data?.length &&
          prev[prev.length - 1]?.time === data[data.length - 1]?.time &&
          prev[0]?.time === data[0]?.time &&
          prev[0]?.open === data[0]?.open &&
          prev[prev.length - 1]?.close === data[data.length - 1]?.close
        ) {
          return prev;
        }
        return (data || []) as RawBar[];
      });
      setIsLoadingHistory(false);
    }
    load();
    return () => { 
      cancelled = true; 
      abortCtrl.abort();
      console.log(`[useChartData ${id}] load() CLEANUP: ${ticker} (${timeframe}) date=${selectedDate}`);
    };
  }, [ticker, selectedDate, timeframe, id]);

  // Infinite Scroll Listener
  useEffect(() => {
    let isSubscribed = false;
    let timeScale: any = null;

    const onVisibleLogicalRangeChanged = async (newLogicalRange: LogicalRange | null) => {
      if (!newLogicalRange) return;
      
      const currentEarliest = earliestLoadedDateRef.current;
      // When scrolled near the left edge of loaded bars, fetch previous chunk
      if (
        localMasterDataRef.current.length >= 100 &&
        newLogicalRange.from < 25 &&
        !isLoadingHistory &&
        currentEarliest &&
        hasMoreHistoryRef.current &&
        lastFetchedEndTimeRef.current !== currentEarliest
      ) {
        lastFetchedEndTimeRef.current = currentEarliest;
        setIsLoadingHistory(true);
        try {
          const reqTicker = ticker;
          const reqTf = timeframe;
          const oldLogicalRange = timeScale ? timeScale.getVisibleLogicalRange() : null;
          const currentChartBars = priceSeriesRef.current ? (priceSeriesRef.current.data() as CandlestickData[]) : [];
          
          const chunk = await streamingClient.getCandles(reqTicker, {
            timeframe: reqTf,
            endTime: currentEarliest,
            limit: 5000,
          });

          // LIVE-CONTEXT-02: Discard obsolete response if context changed while in flight
          if (
            loadedTickerRef.current !== reqTicker ||
            dataTimeframeRef.current !== reqTf
          ) {
            return;
          }
          
          if (chunk && chunk.length > 0) {
            // LIVE-ORDER-01: Enforce strict timestamp ordering and deduplication at history merge boundary
            const toMs = (t: string | number) => {
              if (typeof t === 'number') return t < 1e11 ? t * 1000 : t;
              const str = String(t);
              return new Date(str.replace(' ', 'T') + (str.includes('Z') ? '' : 'Z')).getTime();
            };

            const map = new Map<number, RawBar>();
            for (const b of chunk) {
              const msVal = toMs(b.time);
              if (!isNaN(msVal)) map.set(msVal, b);
            }
            for (const b of localMasterDataRef.current) {
              const msVal = toMs(b.time);
              if (!isNaN(msVal)) map.set(msVal, b);
            }

            const sortedTimes = Array.from(map.keys()).sort((a, b) => a - b);
            const newData = sortedTimes.map(t => map.get(t)!);

            if (newData.length > localMasterDataRef.current.length) {
              earliestLoadedDateRef.current = newData[0].time;
              localMasterDataRef.current = newData;
              
              pendingHistoryPrependRef.current = {
                oldFirstTime: currentChartBars.length > 0 ? (currentChartBars[0].time as number) : null,
                oldLogicalRange: oldLogicalRange
              };
              
              setLocalMasterData(newData);
            } else {
              hasMoreHistoryRef.current = false;
            }
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
    if (localMasterData[0]?.symbol && localMasterData[0].symbol.toUpperCase() !== ticker.toUpperCase()) {
      return [];
    }
    
    let filtered: RawBar[];
    if (timeframe === '1D') {
      // 1D chart strictly uses RTH hours, never ETH / full 24h day
      filtered = localMasterData.filter((d) => isRthBar(d, ticker, timeframe));
    } else if (showEth) {
      filtered = localMasterData;
    } else {
      filtered = localMasterData.filter((d) => !d.session || d.session === 'REG' || d.session.includes('REG'));
    }
    
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

    if (timeframe === '1D') {
      // In replay mode, drop today's completed bar so it is formed live from RTH bars/ticks
      if (selectedDate && (isReplayMode || globalTime)) {
        filtered = filtered.filter((d) => d.time.slice(0, 10) < selectedDate);
      }
    } else {
      const durationSec = TF_SECONDS[timeframe] || 60;
      const currentBucketStartMs = Math.floor(effectiveCutoff / (durationSec * 1000)) * (durationSec * 1000);
      
      if (latestTick) {
        filtered = filtered.filter((_, i) => filteredTimestamps[i] < currentBucketStartMs);
      } else if (timeframe === '1min') {
        filtered = filtered.filter((_, i) => filteredTimestamps[i] <= effectiveCutoff);
      } else {
        // Higher timeframe bars before the current forming bucket
        filtered = filtered.filter((_, i) => filteredTimestamps[i] < currentBucketStartMs);
      }
    }
    
    // DATA-04: Diagnostic warning when data filtering reduces bar count drastically
    if (filtered.length <= 1 && localMasterData.length > 1) {
      console.warn(`[useChartData ${id}] Diagnostic: Filtered data severely reduced`, {
        rawCount: localMasterData.length,
        filteredCount: filtered.length,
        timeframe,
        effectiveCutoff,
        selectedDate,
        isReplayMode,
        hasGlobalTime: Boolean(globalTime)
      });
    }

    return filtered;
  }, [localMasterData, barTimestampsMs, timeframe, showEth, effectiveCutoff, latestTick, selectedDate, isReplayMode, globalTime]);

  // Resample the filtered data to the target timeframe and synthesize live tick
  const chartData = useMemo(() => {
    let resampled = resampleData(filteredData, timeframe);

    if (timeframe === '1D') {
      if (isReplayMode || globalTime) {
        const probeDate = new Date(`${selectedDate}T14:00:00Z`);
        const nyHour = new Intl.DateTimeFormat('en-US', { 
          timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' 
        }).format(probeDate);
        const offsetHours = 14 - parseInt(nyHour, 10);
        const startOfTodayMs = new Date(`${selectedDate}T00:00:00Z`).getTime() + (offsetHours * 3600000);

        // Regular Trading Hours (09:30 AM to 16:00 PM Eastern Time)
        const rthOpenMs = startOfTodayMs + (9.5 * 3600000);
        const rthCloseMs = startOfTodayMs + (16 * 3600000);

        const candidateBars = (masterData && masterData.length > 0 && (!masterData[0].symbol || masterData[0].symbol.toUpperCase() === ticker.toUpperCase()))
          ? masterData
          : localMasterData;

        const todayBars = candidateBars.filter(b => {
          if (!isRthBar(b, ticker)) return false;
          const bMs = new Date(b.time.replace(' ', 'T') + (b.time.includes('Z') ? '' : 'Z')).getTime();
          return bMs >= rthOpenMs && bMs <= Math.min(effectiveCutoff, rthCloseMs);
        }).map(b => {
          const bMs = new Date(b.time.replace(' ', 'T') + (b.time.includes('Z') ? '' : 'Z')).getTime();
          // CONV-DAILY-01: Protect forming minute bar across entire interval
          const isMinuteForming = isReplayMode && bMs <= effectiveCutoff && bMs + 60000 > effectiveCutoff;
          if (isMinuteForming) {
            return {
              ...b,
              high: b.open,
              low: b.open,
              close: b.open,
              volume: 0,
            };
          }
          return b;
        });

        if (todayBars.length > 0) {
          const formingDaily: RawBar = {
            time: `${selectedDate} 12:00:00`,
            open: todayBars[0].open,
            high: Math.max(...todayBars.map(b => b.high)),
            low: Math.min(...todayBars.map(b => b.low)),
            close: todayBars[todayBars.length - 1].close,
            volume: todayBars.reduce((s, b) => s + (b.volume || 0), 0),
            session: 'REG',
            tickCount: todayBars.reduce((s, b) => s + (b.tickCount || 1), 0),
          };

          // Incorporate elapsed ticks from the forming minute
          if (symbolTicks && symbolTicks.length > 0 && effectiveCutoff >= rthOpenMs && effectiveCutoff <= rthCloseMs) {
            const currentMinuteStartMs = Math.floor(effectiveCutoff / 60000) * 60000;
            const formingTicks = symbolTicks.filter(t => {
              const tMs = isoToMs(t.time);
              return tMs >= currentMinuteStartMs && tMs <= effectiveCutoff && isRthTick(t, ticker);
            });
            if (formingTicks.length > 0) {
              formingDaily.high = Math.max(formingDaily.high, ...formingTicks.map(t => t.price));
              formingDaily.low = Math.min(formingDaily.low, ...formingTicks.map(t => t.price));
              formingDaily.close = formingTicks[formingTicks.length - 1].price;
              formingDaily.volume += formingTicks.reduce((s, t) => s + (t.volume || 0), 0);
            }
          } else if (latestTick && latestTick.price && !(latestTick as any).isSynthesized && effectiveCutoff >= rthOpenMs && effectiveCutoff <= rthCloseMs) {
            if (isRthTick(latestTick, ticker)) {
              formingDaily.high = Math.max(formingDaily.high, latestTick.price);
              formingDaily.low = Math.min(formingDaily.low, latestTick.price);
              formingDaily.close = latestTick.price;
              if (latestTick.volume) formingDaily.volume += latestTick.volume;
            }
          }

          resampled = [...resampled, formingDaily];
        } else if (symbolTicks && symbolTicks.length > 0 && effectiveCutoff >= rthOpenMs) {
          // Fallback: build forming daily candle from raw symbol ticks
          const rthTicks = symbolTicks.filter(t => {
            const tMs = isoToMs(t.time);
            return tMs >= rthOpenMs && tMs <= Math.min(effectiveCutoff, rthCloseMs) && isRthTick(t, ticker);
          });
          if (rthTicks.length > 0) {
            const formingDaily: RawBar = {
              time: `${selectedDate} 12:00:00`,
              open: rthTicks[0].price,
              high: Math.max(...rthTicks.map(t => t.price)),
              low: Math.min(...rthTicks.map(t => t.price)),
              close: rthTicks[rthTicks.length - 1].price,
              volume: rthTicks.reduce((s, t) => s + (t.volume || 0), 0),
              session: 'REG',
              tickCount: rthTicks.length,
            };
            resampled = [...resampled, formingDaily];
          }
        }
      }
    } else if (
      effectiveCutoff &&
      latestTick &&
      symbolTicks &&
      symbolTicks.length > 0 &&
      tickTimestampsMs.length > 0 &&
      tickTimestampsMs[0] <= effectiveCutoff
    ) {
      const durationSec = TF_SECONDS[timeframe] || 60;
      const durationMs = durationSec * 1000;
      const currentBucketStartMs = Math.floor(effectiveCutoff / durationMs) * durationMs;

      // Determine where resampled bars currently end
      let lastBarTimeMs = -1;
      if (resampled.length > 0) {
        const lastBar = resampled[resampled.length - 1];
        lastBarTimeMs = typeof lastBar.time === 'number'
          ? (lastBar.time > 1e11 ? lastBar.time : lastBar.time * 1000)
          : new Date(String(lastBar.time).replace(' ', 'T') + (String(lastBar.time).includes('Z') ? '' : 'Z')).getTime();
      }

      // If resampled ends before currentBucketStartMs, synthesize all elapsed buckets from ticks
      const startMs = lastBarTimeMs >= currentBucketStartMs ? currentBucketStartMs : (lastBarTimeMs > 0 ? lastBarTimeMs + durationMs : 0);

      // Binary search for the first tick >= startMs using pre-cached timestamps
      let lo = 0, hi = tickTimestampsMs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tickTimestampsMs[mid] < startMs) lo = mid + 1;
        else hi = mid;
      }

      if (lo < symbolTicks.length && tickTimestampsMs[lo] <= effectiveCutoff) {
        // Group ticks into buckets of durationMs up to effectiveCutoff
        let currentBucketTicks: MarketTick[] = [];
        let currentBucketMs = -1;

        for (let i = lo; i < symbolTicks.length; i++) {
          const tMs = tickTimestampsMs[i];
          if (tMs > effectiveCutoff) break;

          const t = symbolTicks[i];
          if (!showEth && !isRthTick(t, ticker)) continue;

          const bMs = Math.floor(tMs / durationMs) * durationMs;
          if (bMs < startMs) continue;

          if (currentBucketMs === -1) {
            currentBucketMs = bMs;
            currentBucketTicks = [t];
          } else if (bMs === currentBucketMs) {
            currentBucketTicks.push(t);
          } else {
            // Push completed candle for previous bucket
            if (currentBucketTicks.length > 0) {
              const bTime = getBucketTimestamp(currentBucketMs, timeframe);
              const candle = buildCandleFromTickSlice(
                currentBucketTicks,
                0,
                currentBucketTicks.length - 1,
                bTime,
                currentBucketTicks[0]?.session || 'REG'
              );
              if (candle) {
                if (resampled.length > 0 && resampled[resampled.length - 1].time === bTime) {
                  const last = resampled[resampled.length - 1];
                  resampled = [
                    ...resampled.slice(0, -1),
                    {
                      ...last,
                      high: Math.max(last.high, candle.high),
                      low: Math.min(last.low, candle.low),
                      close: candle.close,
                      volume: (last.volume || 0) + candle.volume,
                    }
                  ];
                } else {
                  resampled.push(candle);
                }
              }
            }
            currentBucketMs = bMs;
            currentBucketTicks = [t];
          }
        }

        // Handle the final (current forming) bucket
        if (currentBucketTicks.length > 0 && currentBucketMs !== -1) {
          const bTime = getBucketTimestamp(currentBucketMs, timeframe);
          const candle = buildCandleFromTickSlice(
            currentBucketTicks,
            0,
            currentBucketTicks.length - 1,
            bTime,
            latestTick.session || 'REG'
          );
          if (candle) {
            if (resampled.length > 0 && resampled[resampled.length - 1].time === bTime) {
              const last = resampled[resampled.length - 1];
              resampled = [
                ...resampled.slice(0, -1),
                {
                  ...last,
                  high: Math.max(last.high, candle.high),
                  low: Math.min(last.low, candle.low),
                  close: candle.close,
                  volume: (last.volume || 0) + candle.volume,
                }
              ];
            } else {
              resampled = [...resampled, candle];
            }
          }
        }
      }
    } else {
      if ((timeframe as string) !== '1min' && (timeframe as string) !== '1D') {
        // Synthesize missing and forming multi-minute/hour candles from 1m candidateBars up to effectiveCutoff
        const durationSec = TF_SECONDS[timeframe] || 60;
        const durationMs = durationSec * 1000;
        const currentBucketStartMs = Math.floor(effectiveCutoff / durationMs) * durationMs;

        const candidateBars = (masterData && masterData.length > 0 && (!masterData[0].symbol || masterData[0].symbol.toUpperCase() === ticker.toUpperCase()))
          ? masterData
          : localMasterData;

        const isLocalCandidate = candidateBars === localMasterData;
        const candidateDurationSec = isLocalCandidate ? (TF_SECONDS[timeframe] || 60) : 60;
        const candidateDurationMs = candidateDurationSec * 1000;

        if (candidateBars && candidateBars.length > 0) {
          let lastBarTimeMs = -1;
          if (resampled.length > 0) {
            const lastBar = resampled[resampled.length - 1];
            lastBarTimeMs = typeof lastBar.time === 'number'
              ? (lastBar.time > 1e11 ? lastBar.time : lastBar.time * 1000)
              : new Date(String(lastBar.time).replace(' ', 'T') + (String(lastBar.time).includes('Z') ? '' : 'Z')).getTime();
          }

          const startMs = lastBarTimeMs >= currentBucketStartMs ? currentBucketStartMs : (lastBarTimeMs > 0 ? lastBarTimeMs + durationMs : 0);

          const validBars = candidateBars.filter(b => {
            if (!showEth && !isRthBar(b, ticker)) return false;
            const bMs = new Date(b.time.replace(' ', 'T') + (b.time.includes('Z') ? '' : 'Z')).getTime();
            return bMs >= startMs && bMs <= effectiveCutoff;
          }).map(b => {
            const bMs = new Date(b.time.replace(' ', 'T') + (b.time.includes('Z') ? '' : 'Z')).getTime();
            // CONV-TIME-01: Protect forming bucket across source duration until bar closes
            const isConstituentForming = isReplayMode && bMs <= effectiveCutoff && bMs + candidateDurationMs > effectiveCutoff;
            if (isConstituentForming) {
              return {
                ...b,
                high: b.open,
                low: b.open,
                close: b.open,
                volume: 0,
              };
            }
            return b;
          });

          if (validBars.length > 0) {
            const extraCandles = resampleData(validBars, timeframe);
            for (const c of extraCandles) {
              if (resampled.length > 0 && resampled[resampled.length - 1].time === c.time) {
                const last = resampled[resampled.length - 1];
                resampled = [
                  ...resampled.slice(0, -1),
                  {
                    ...last,
                    high: Math.max(last.high, c.high),
                    low: Math.min(last.low, c.low),
                    close: c.close,
                    volume: (last.volume || 0) + c.volume,
                  }
                ];
              } else {
                resampled = [...resampled, c];
              }
            }
          }
        }
      }

      if (latestTick) {
        resampled = applyTickToCandles(resampled, latestTick, timeframe);
      }
    }

    return resampled;

  }, [filteredData, timeframe, isReplayMode, effectiveCutoff, latestTick, symbolTicks, tickTimestampsMs, selectedDate, ticker, masterData, localMasterData]);

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
