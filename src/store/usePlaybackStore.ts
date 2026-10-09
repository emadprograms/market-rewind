import { create } from 'zustand';
import type { RawBar, MarketTick } from '../types';

export type ReplayMode = 'bar' | 'tick';

interface PlaybackState {
  replayMode: ReplayMode;
  currentTime: number | null; // Unix ms
  isPaused: boolean;
  playbackSpeed: number;
  stepMinutes: number;
  masterData: RawBar[];

  // Tick Replay State
  isLoadingTicks: boolean;
  bufferedTicks: MarketTick[];
  ticksBySymbol: Record<string, MarketTick[]>;
  latestTickBySymbol: Record<string, MarketTick>;
  currentTickIndex: number;
  currentTick: MarketTick | null;
  totalTicks: number;

  /**
   * Monotonic counter bumped by every explicit playhead move (seek, step, scrub, time jump).
   * It is the only way to distinguish a temporal *discontinuity* from a frame-sized playback
   * advance: both change `currentTime`, but a discontinuity must be rendered by a bulk
   * snapshot rebuild instead of by replaying each jumped-over tick. Never bumped by
   * `advanceSimulationTime`, so a per-frame call cannot trigger a React rebuild.
   */
  seekEpoch: number;

  // Actions
  setIsLoadingTicks: (loading: boolean) => void;
  setReplayMode: (mode: ReplayMode) => void;
  setCurrentTime: (time: number | null) => void;
  setPaused: (paused: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setStepMinutes: (minutes: number) => void;
  setMasterData: (data: RawBar[]) => void;
  setBufferedTicks: (ticks: MarketTick[]) => void;
  addTicks: (ticks: MarketTick[]) => void;
  addSymbolTicks: (symbol: string, ticks: MarketTick[]) => void;
  
  tick: (stepCount?: number) => void;
  advanceSimulationTime: (targetTimeMs: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  seekTickIndex: (index: number) => void;
  seekTickTime: (time: string | number) => void;
  reset: () => void;
}

export const isoToMs = (iso: string | number): number => {
  if (!iso) return 0;
  if (typeof iso === 'number') {
    return iso < 1e11 ? iso * 1000 : iso;
  }
  const str = String(iso);
  const normalized = str.includes('T') ? str : str.replace(' ', 'T');
  return new Date(normalized.includes('Z') ? normalized : normalized + 'Z').getTime();
};

export const msToIso = (ms: number): string => {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
};

export const ensureTickMs = (t: MarketTick): number => {
  if (!t) return 0;
  if ((t as any)._ms !== undefined) return (t as any)._ms;
  const ms = isoToMs(t.time);
  (t as any)._ms = ms;
  return ms;
};

const advanceTimeLogic = (currentMs: number | null, stepMinutes: number, masterData: RawBar[]) => {
  if (!currentMs || masterData.length === 0) return null;
  
  const nextBoundaryMs = Math.ceil((currentMs + 1) / (stepMinutes * 60000)) * (stepMinutes * 60000);
  const targetStr = msToIso(nextBoundaryMs);
  
  const nextBar = masterData.find(d => d.time >= targetStr);
  if (nextBar) {
    const nextMs = isoToMs(nextBar.time);
    return nextMs !== currentMs ? nextMs : null;
  }
  return null;
};

const rewindTimeLogic = (currentMs: number | null, stepMinutes: number, masterData: RawBar[]) => {
  if (!currentMs || masterData.length === 0) return currentMs;
  
  const prevBoundaryMs = Math.floor((currentMs - 1) / (stepMinutes * 60000)) * (stepMinutes * 60000);
  const targetStr = msToIso(prevBoundaryMs);
  
  let best = null;
  for (let i = masterData.length - 1; i >= 0; i--) {
    if (masterData[i].time <= targetStr) {
      best = masterData[i].time;
      break;
    }
  }
  return best ? isoToMs(best) : isoToMs(masterData[0].time);
};

export const findBarAtOrBefore = (bars: RawBar[], targetMs: number): RawBar | null => {
  if (!bars || bars.length === 0) return null;
  let low = 0;
  let high = bars.length - 1;
  let bestIdx = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const midMs = isoToMs(bars[mid].time);
    if (midMs <= targetMs) {
      bestIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return bestIdx >= 0 ? bars[bestIdx] : bars[0];
};

export const getBarSynthesizedPrice = (bar: RawBar, targetTimeMs: number): number => {
  if (!bar) return 0;
  const barStartMs = isoToMs(bar.time);
  const barDurationMs = 60000;
  if (targetTimeMs >= barStartMs + barDurationMs) {
    return bar.close;
  }
  if (targetTimeMs <= barStartMs) {
    return bar.open;
  }

  const elapsed = targetTimeMs - barStartMs;
  const p = Math.max(0, Math.min(1, elapsed / barDurationMs));

  const isGreen = bar.close >= bar.open;
  const p1 = bar.open;
  const p2 = isGreen ? bar.low : bar.high;
  const p3 = isGreen ? bar.high : bar.low;
  const p4 = bar.close;

  if (p < 0.25) {
    const t = p / 0.25;
    return p1 + (p2 - p1) * t;
  } else if (p < 0.75) {
    const t = (p - 0.25) / 0.5;
    return p2 + (p3 - p2) * t;
  } else {
    const t = (p - 0.75) / 0.25;
    return p3 + (p4 - p3) * t;
  }
};

/**
 * Shared seek core: the state patch that moves the playhead to `targetMs`.
 *
 * `bumpSeekEpoch` marks the move as an explicit *discontinuity* (user seek, step, scrub or
 * time jump) rather than a frame-sized playback advance. Consumers read `seekEpoch` to tell
 * the two apart because they must be rendered differently: a discontinuity is rebuilt in
 * bulk from the candle snapshot, whereas replaying every jumped-over tick one at a time is
 * O(elapsed ticks) synchronous work inside a store subscriber -- thousands of chart
 * primitive writes for a single 3-minute step on a dense tape, which is what froze the tab.
 * `advanceSimulationTime`'s internal rewind branch reuses this core with the flag off, so a
 * per-frame call can never trigger a React rebuild.
 */
const computeSeekPatch = (
  state: PlaybackState,
  targetMs: number,
  bumpSeekEpoch: boolean
): Partial<PlaybackState> => {
  const { bufferedTicks, ticksBySymbol, masterData, isPaused } = state;
  const seekPatch = bumpSeekEpoch ? { seekEpoch: state.seekEpoch + 1 } : {};
  const lastTickMs = bufferedTicks.length > 0 ? isoToMs(bufferedTicks[bufferedTicks.length - 1].time) : null;
  const lastBarMs = masterData.length > 0 ? isoToMs(masterData[masterData.length - 1].time) + 60000 : null;
  const maxMs = (lastTickMs !== null && lastBarMs !== null) ? Math.max(lastTickMs, lastBarMs) : (lastTickMs ?? lastBarMs);
  const reachedEnd = maxMs !== null && targetMs >= maxMs;

  if (bufferedTicks.length === 0) {
    let synthTick: MarketTick | null = null;
    let updatedLatest: Record<string, MarketTick> = {};
    if (masterData.length > 0) {
      const bar = findBarAtOrBefore(masterData, targetMs);
      if (bar) {
        const sym = (bar.symbol || Object.keys(ticksBySymbol)[0] || 'SPY').toUpperCase();
        const price = getBarSynthesizedPrice(bar, targetMs);
        synthTick = {
          time: msToIso(targetMs),
          price: Number(price.toFixed(4)),
          volume: bar.volume || 1,
          symbol: sym,
          session: (bar.session as any) || 'REG',
          source: 'STREAMING',
          isSynthesized: true,
        };
        if (synthTick) updatedLatest[sym] = synthTick;
      }
    }
    return {
      ...seekPatch,
      currentTime: targetMs,
      currentTickIndex: -1,
      currentTick: synthTick,
      latestTickBySymbol: updatedLatest,
      isPaused: reachedEnd ? true : isPaused,
    };
  }

  const firstTickMs = isoToMs(bufferedTicks[0].time);
  if (targetMs < firstTickMs) {
    let synthTick: MarketTick | null = null;
    let updatedLatest: Record<string, MarketTick> = {};
    if (masterData.length > 0) {
      const bar = findBarAtOrBefore(masterData, targetMs);
      if (bar) {
        const sym = (bar.symbol || bufferedTicks[0].symbol || 'SPY').toUpperCase();
        const price = getBarSynthesizedPrice(bar, targetMs);
        synthTick = {
          time: msToIso(targetMs),
          price: Number(price.toFixed(4)),
          volume: bar.volume || 1,
          symbol: sym,
          session: (bar.session as any) || 'REG',
          source: 'STREAMING',
          isSynthesized: true,
        };
        if (synthTick) updatedLatest[sym] = synthTick;
      }
    }
    return {
      ...seekPatch,
      currentTickIndex: -1,
      currentTick: synthTick,
      latestTickBySymbol: updatedLatest,
      currentTime: targetMs,
      isPaused,
    };
  }


  // Binary search for the last tick occurring at or before targetMs (tMs <= targetMs)
  let low = 0;
  let high = bufferedTicks.length - 1;
  let targetIndex = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const midMs = isoToMs(bufferedTicks[mid].time);
    if (midMs <= targetMs) {
      targetIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const targetTick = bufferedTicks[targetIndex] || null;

  // Scan backwards from targetIndex to efficiently populate the latest tick for each symbol
  const updatedLatest: Record<string, MarketTick> = {};
  const knownSymbols = Object.keys(ticksBySymbol);
  const neededSymbolsCount = knownSymbols.length > 0 ? knownSymbols.length : Infinity;
  let foundCount = 0;

  for (let i = targetIndex; i >= 0; i--) {
    const t = bufferedTicks[i];
    if (t && t.symbol) {
      const sym = t.symbol.toUpperCase();
      if (!updatedLatest[sym]) {
        updatedLatest[sym] = t;
        foundCount++;
        if (foundCount >= neededSymbolsCount) break;
      }
    }
  }

  return {
    ...seekPatch,
    currentTickIndex: targetIndex,
    currentTick: targetTick,
    latestTickBySymbol: updatedLatest,
    currentTime: targetMs,
    isPaused: reachedEnd ? true : isPaused,
  };
};

export const usePlaybackStore = create<PlaybackState>((set, get) => ({

  replayMode: 'tick',
  currentTime: null,
  isPaused: true,
  playbackSpeed: 1,
  stepMinutes: 3,
  masterData: [],

  isLoadingTicks: false,
  bufferedTicks: [],
  ticksBySymbol: {},
  latestTickBySymbol: {},
  currentTickIndex: 0,
  currentTick: null,
  totalTicks: 0,
  seekEpoch: 0,

  setIsLoadingTicks: (loading) => set({ isLoadingTicks: loading }),
  setReplayMode: (mode) => set({ replayMode: mode }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setPaused: (paused) => set({ isPaused: paused }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setStepMinutes: (minutes) => set({ stepMinutes: minutes }),
  setMasterData: (data) => set({ masterData: data }),

  setBufferedTicks: (ticks) => {
    const ticksBySymbol: Record<string, MarketTick[]> = {};
    const latestTickBySymbol: Record<string, MarketTick> = {};

    for (const t of ticks) {
      const sym = (t.symbol || 'SPY').toUpperCase();
      if (!ticksBySymbol[sym]) {
        ticksBySymbol[sym] = [];
      }
      ticksBySymbol[sym].push(t);
    }

    const firstTick = ticks[0] || null;
    if (firstTick && firstTick.symbol) {
      latestTickBySymbol[firstTick.symbol.toUpperCase()] = firstTick;
    }
    const initialMs = firstTick ? isoToMs(firstTick.time) : null;

    set((state) => ({
      bufferedTicks: ticks,
      ticksBySymbol,
      latestTickBySymbol,
      totalTicks: ticks.length,
      currentTickIndex: 0,
      currentTick: firstTick,
      currentTime: state.currentTime ?? initialMs,
    }));
  },

  addTicks: (newTicks) => {
    set((state) => {
      for (let i = 0; i < newTicks.length; i++) {
        if ((newTicks[i] as any)._ms === undefined) {
          (newTicks[i] as any)._ms = isoToMs(newTicks[i].time);
        }
      }
      const combined = [...state.bufferedTicks, ...newTicks].sort(
        (a, b) => ensureTickMs(a) - ensureTickMs(b)
      );
      const ticksBySymbol: Record<string, MarketTick[]> = {};
      for (const t of combined) {
        const sym = (t.symbol || 'SPY').toUpperCase();
        if (!ticksBySymbol[sym]) ticksBySymbol[sym] = [];
        ticksBySymbol[sym].push(t);
      }
      return {
        bufferedTicks: combined,
        ticksBySymbol,
        totalTicks: combined.length,
      };
    });
  },

  addSymbolTicks: (symbol: string, newTicks: MarketTick[]) => {
    set((state) => {
      const sym = symbol.toUpperCase();
      for (let i = 0; i < newTicks.length; i++) {
        if ((newTicks[i] as any)._ms === undefined) {
          (newTicks[i] as any)._ms = isoToMs(newTicks[i].time);
        }
      }
      const existing = state.ticksBySymbol[sym] || [];
      const mergedSymbol = [...existing, ...newTicks].sort(
        (a, b) => ensureTickMs(a) - ensureTickMs(b)
      );
      
      const updatedTicksBySymbol = {
        ...state.ticksBySymbol,
        [sym]: mergedSymbol,
      };

      const combined = [...state.bufferedTicks, ...newTicks].sort(
        (a, b) => ensureTickMs(a) - ensureTickMs(b)
      );

      const updatedLatest = { ...state.latestTickBySymbol };
      if (state.currentTime) {
        for (let i = mergedSymbol.length - 1; i >= 0; i--) {
          if (ensureTickMs(mergedSymbol[i]) <= state.currentTime) {
            updatedLatest[sym] = mergedSymbol[i];
            break;
          }
        }
      } else if (mergedSymbol.length > 0) {
        updatedLatest[sym] = mergedSymbol[0];
      }

      let updatedIndex = state.currentTickIndex;
      if (state.currentTick && combined.length > 0) {
        const found = combined.indexOf(state.currentTick);
        if (found !== -1) {
          updatedIndex = found;
        } else if (state.currentTime) {
          for (let i = combined.length - 1; i >= 0; i--) {
            if (ensureTickMs(combined[i]) <= state.currentTime) {
              updatedIndex = i;
              break;
            }
          }
        }
      }

      return {
        bufferedTicks: combined,
        ticksBySymbol: updatedTicksBySymbol,
        latestTickBySymbol: updatedLatest,
        totalTicks: combined.length,
        currentTickIndex: updatedIndex,
      };
    });
  },

  tick: (stepCount = 1) => {
    const { isPaused, bufferedTicks, currentTickIndex, currentTime, stepMinutes, masterData, latestTickBySymbol } = get();
    if (isPaused) return;

    if (bufferedTicks.length > 0) {
      if (currentTickIndex < bufferedTicks.length - 1) {
        const nextIndex = Math.min(bufferedTicks.length - 1, currentTickIndex + Math.max(1, stepCount));
        const updatedLatest = { ...latestTickBySymbol };
        for (let i = currentTickIndex + 1; i <= nextIndex; i++) {
          const t = bufferedTicks[i];
          if (t && t.symbol) {
            updatedLatest[t.symbol.toUpperCase()] = t;
          }
        }
        const nextTick = bufferedTicks[nextIndex];
        set({
          currentTickIndex: nextIndex,
          currentTick: nextTick,
          latestTickBySymbol: updatedLatest,
          currentTime: isoToMs(nextTick.time),
        });
      } else {
        set({ isPaused: true });
      }
    } else {
      const next = advanceTimeLogic(currentTime, stepMinutes, masterData);
      if (next) {
        set({ currentTime: next });
      } else {
        set({ isPaused: true });
      }
    }
  },

  advanceSimulationTime: (targetTimeMs: number) => {
    const { bufferedTicks, currentTickIndex, currentTick, latestTickBySymbol, masterData, ticksBySymbol } = get();

    if (bufferedTicks.length === 0) {
      if (masterData.length > 0) {
        const lastBarMs = isoToMs(masterData[masterData.length - 1].time) + 60000;
        const reachedEnd = targetTimeMs >= lastBarMs;
        const bar = findBarAtOrBefore(masterData, targetTimeMs);
        if (bar) {
          const sym = (bar.symbol || Object.keys(ticksBySymbol)[0] || 'SPY').toUpperCase();
          const price = getBarSynthesizedPrice(bar, targetTimeMs);
          const synthTick: MarketTick = {
            time: msToIso(targetTimeMs),
            price: Number(price.toFixed(4)),
            volume: bar.volume || 1,
            symbol: sym,
            session: (bar.session as any) || 'REG',
            source: 'STREAMING',
            isSynthesized: true,
          } as any;
          const updatedLatest = { ...latestTickBySymbol, [sym]: synthTick };
          set({
            currentTime: targetTimeMs,
            currentTickIndex: -1,
            currentTick: synthTick,
            latestTickBySymbol: updatedLatest,
            ...(reachedEnd ? { isPaused: true } : {}),
          });
          return;
        }
      }
      set({ currentTime: targetTimeMs });
      return;
    }

    const firstTickMs = bufferedTicks.length > 0 ? isoToMs(bufferedTicks[0].time) : 0;
    if (targetTimeMs < firstTickMs) {
      if (masterData.length > 0) {
        const bar = findBarAtOrBefore(masterData, targetTimeMs);
        if (bar) {
          const sym = (bar.symbol || bufferedTicks[0].symbol || 'SPY').toUpperCase();
          const price = getBarSynthesizedPrice(bar, targetTimeMs);
          const synthTick: MarketTick = {
            time: msToIso(targetTimeMs),
            price: Number(price.toFixed(4)),
            volume: bar.volume || 1,
            symbol: sym,
            session: (bar.session as any) || 'REG',
            source: 'STREAMING',
            isSynthesized: true,
          } as any;
          const updatedLatest = { ...latestTickBySymbol, [sym]: synthTick };
          set({
            currentTime: targetTimeMs,
            currentTickIndex: -1,
            currentTick: synthTick,
            latestTickBySymbol: updatedLatest,
          });
          return;
        }
      }
      set({ currentTime: targetTimeMs });
      return;
    }

    const currentTickTime = (currentTickIndex >= 0 && bufferedTicks[currentTickIndex]) ? isoToMs(bufferedTicks[currentTickIndex].time) : 0;
    if (currentTickIndex >= 0 && targetTimeMs < currentTickTime) {
      // Internal rewind inside a per-frame advance: reuse the seek core but do NOT bump
      // seekEpoch -- a frame must never trigger a React snapshot rebuild.
      set((state) => computeSeekPatch(state, targetTimeMs, false));
      return;
    }

    let nextIdx = currentTickIndex < 0 ? -1 : currentTickIndex;
    let advanced = false;
    // Built lazily. At 25x a tick elapses on only ~35% of frames, and on the rest there
    // is nothing to merge -- allocating a fresh map there would wake every identity-keyed
    // subscriber (TimeAndSales, useChartData) for a frame that carries no new data.
    let merged: Record<string, MarketTick> | null = null;

    while (nextIdx + 1 < bufferedTicks.length) {
      const candidate = bufferedTicks[nextIdx + 1];
      if (ensureTickMs(candidate) <= targetTimeMs) {
        nextIdx++;
        advanced = true;
        if (candidate && candidate.symbol) {
          merged = merged || { ...latestTickBySymbol };
          merged[candidate.symbol.toUpperCase()] = candidate;
        }
      } else {
        break;
      }
    }

    const nextTick = nextIdx >= 0 ? bufferedTicks[nextIdx] : null;
    let latestOut: Record<string, MarketTick> = merged || latestTickBySymbol;
    if (nextTick && nextTick.symbol) {
      const key = nextTick.symbol.toUpperCase();
      if (latestOut[key] !== nextTick) {
        latestOut = { ...latestOut, [key]: nextTick };
      }
    }

    const lastTickMs = ensureTickMs(bufferedTicks[bufferedTicks.length - 1]);
    const reachedEnd = nextIdx >= bufferedTicks.length - 1 && targetTimeMs >= lastTickMs;

    // Each slice is spread in only when its value actually changes, so zustand hands the
    // previous reference back and identity-keyed subscribers skip the frame entirely.
    set({
      currentTime: targetTimeMs,
      ...(advanced ? { currentTickIndex: nextIdx } : {}),
      ...(nextTick !== null && nextTick !== currentTick ? { currentTick: nextTick } : {}),
      ...(latestOut !== latestTickBySymbol ? { latestTickBySymbol: latestOut } : {}),
      ...(reachedEnd ? { isPaused: true } : {}),
    });
  },

  stepForward: () => {
    const { bufferedTicks, currentTickIndex, currentTime, stepMinutes, masterData, latestTickBySymbol, isPaused } = get();

    if (stepMinutes <= 0) {
      if (bufferedTicks.length > 0) {
        if (currentTickIndex < bufferedTicks.length - 1) {
          const nextIndex = currentTickIndex < 0 ? 0 : currentTickIndex + 1;
          const nextTick = bufferedTicks[nextIndex];
          const nextTickMs = isoToMs(nextTick.time);

          const updatedLatest = { ...latestTickBySymbol };
          if (nextTick && nextTick.symbol) {
            updatedLatest[nextTick.symbol.toUpperCase()] = nextTick;
          }
          set((state) => ({
            seekEpoch: state.seekEpoch + 1,
            currentTickIndex: nextIndex,
            currentTick: nextTick,
            latestTickBySymbol: updatedLatest,
            currentTime: nextTickMs,
            isPaused,
          }));
        }
      }
      return;
    }

    const currentMs = currentTime ?? (bufferedTicks[0] ? isoToMs(bufferedTicks[0].time) : (masterData[0] ? isoToMs(masterData[0].time) : null));
    if (currentMs === null) return;

    const stepMs = stepMinutes * 60000;
    let targetMs = Math.ceil((currentMs + 1000) / stepMs) * stepMs;

    const lastTickMs = bufferedTicks.length > 0 ? isoToMs(bufferedTicks[bufferedTicks.length - 1].time) : null;
    const lastBarMs = masterData.length > 0 ? isoToMs(masterData[masterData.length - 1].time) : null;
    const maxMs = (lastTickMs !== null && lastBarMs !== null) ? Math.max(lastTickMs, lastBarMs) : (lastTickMs ?? lastBarMs);

    if (maxMs !== null) {
      if (currentMs >= maxMs) {
        set({ isPaused: true });
        return;
      }
      if (targetMs > maxMs) {
        targetMs = maxMs;
      }
    }

    get().seekTickTime(targetMs);
  },

  stepBackward: () => {
    const { bufferedTicks, currentTickIndex, currentTime, stepMinutes, masterData, isPaused } = get();

    if (stepMinutes <= 0) {
      if (bufferedTicks.length > 0 && currentTickIndex > 0) {
        const prevIndex = currentTickIndex - 1;
        const prevTick = bufferedTicks[prevIndex];
        const updatedLatest: Record<string, MarketTick> = {};
        for (let i = 0; i <= prevIndex; i++) {
          const t = bufferedTicks[i];
          if (t && t.symbol) {
            updatedLatest[t.symbol.toUpperCase()] = t;
          }
        }
        set((state) => ({
          seekEpoch: state.seekEpoch + 1,
          currentTickIndex: prevIndex,
          currentTick: prevTick,
          latestTickBySymbol: updatedLatest,
          currentTime: isoToMs(prevTick.time),
          isPaused,
        }));
      }
      return;
    }

    const currentMs = currentTime ?? (bufferedTicks[0] ? isoToMs(bufferedTicks[0].time) : (masterData[0] ? isoToMs(masterData[0].time) : null));
    if (currentMs === null) return;

    const stepMs = stepMinutes * 60000;
    let targetMs = Math.floor((currentMs - 1000) / stepMs) * stepMs;

    const firstTickMs = bufferedTicks.length > 0 ? isoToMs(bufferedTicks[0].time) : null;
    const firstBarMs = masterData.length > 0 ? isoToMs(masterData[0].time) : null;
    const minMs = (firstTickMs !== null && firstBarMs !== null) ? Math.min(firstTickMs, firstBarMs) : (firstTickMs ?? firstBarMs);

    if (minMs !== null) {
      if (currentMs <= minMs) {
        return;
      }
      if (targetMs < minMs) {
        targetMs = minMs;
      }
    }

    if (targetMs === currentMs) {
      return;
    }

    get().seekTickTime(targetMs);
  },

  seekTickIndex: (index) => {
    const { bufferedTicks, isPaused } = get();
    if (bufferedTicks.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(index, bufferedTicks.length - 1));
    const targetTick = bufferedTicks[clampedIndex];
    const updatedLatest: Record<string, MarketTick> = {};
    for (let i = 0; i <= clampedIndex; i++) {
      const t = bufferedTicks[i];
      if (t && t.symbol) {
        updatedLatest[t.symbol.toUpperCase()] = t;
      }
    }
    set((state) => ({
      seekEpoch: state.seekEpoch + 1,
      currentTickIndex: clampedIndex,
      currentTick: targetTick,
      latestTickBySymbol: updatedLatest,
      currentTime: isoToMs(targetTick.time),
      isPaused,
    }));
  },

  seekTickTime: (time) => {
    const targetMs = typeof time === 'number' ? time : isoToMs(time);
    set((state) => computeSeekPatch(state, targetMs, true));
  },
  reset: () => {
    set({
      currentTime: null,
      isPaused: true,
      currentTickIndex: 0,
      currentTick: null,
      bufferedTicks: [],
      ticksBySymbol: {},
      latestTickBySymbol: {},
      totalTicks: 0,
      isLoadingTicks: false,
    });
  },
}));

if (typeof window !== 'undefined') {
  (window as any).usePlaybackStore = usePlaybackStore;
}
