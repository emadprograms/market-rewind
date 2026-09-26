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
  bufferedTicks: MarketTick[];
  ticksBySymbol: Record<string, MarketTick[]>;
  latestTickBySymbol: Record<string, MarketTick>;
  currentTickIndex: number;
  currentTick: MarketTick | null;
  totalTicks: number;

  // Actions
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

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  replayMode: 'tick',
  currentTime: null,
  isPaused: true,
  playbackSpeed: 1,
  stepMinutes: 1,
  masterData: [],

  bufferedTicks: [],
  ticksBySymbol: {},
  latestTickBySymbol: {},
  currentTickIndex: 0,
  currentTick: null,
  totalTicks: 0,

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
      const combined = [...state.bufferedTicks, ...newTicks].sort(
        (a, b) => isoToMs(a.time) - isoToMs(b.time)
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
      const existing = state.ticksBySymbol[sym] || [];
      const mergedSymbol = [...existing, ...newTicks].sort(
        (a, b) => isoToMs(a.time) - isoToMs(b.time)
      );
      
      const updatedTicksBySymbol = {
        ...state.ticksBySymbol,
        [sym]: mergedSymbol,
      };

      const combined = [...state.bufferedTicks, ...newTicks].sort(
        (a, b) => isoToMs(a.time) - isoToMs(b.time)
      );

      const updatedLatest = { ...state.latestTickBySymbol };
      if (state.currentTime) {
        for (let i = mergedSymbol.length - 1; i >= 0; i--) {
          if (isoToMs(mergedSymbol[i].time) <= state.currentTime) {
            updatedLatest[sym] = mergedSymbol[i];
            break;
          }
        }
      } else if (mergedSymbol.length > 0) {
        updatedLatest[sym] = mergedSymbol[0];
      }

      return {
        bufferedTicks: combined,
        ticksBySymbol: updatedTicksBySymbol,
        latestTickBySymbol: updatedLatest,
        totalTicks: combined.length,
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

  stepForward: () => {
    const { bufferedTicks, currentTickIndex, currentTime, stepMinutes, masterData, latestTickBySymbol } = get();

    if (bufferedTicks.length > 0) {
      if (currentTickIndex < bufferedTicks.length - 1) {
        const nextIndex = currentTickIndex + 1;
        const nextTick = bufferedTicks[nextIndex];
        const updatedLatest = { ...latestTickBySymbol };
        if (nextTick && nextTick.symbol) {
          updatedLatest[nextTick.symbol.toUpperCase()] = nextTick;
        }
        set({
          currentTickIndex: nextIndex,
          currentTick: nextTick,
          latestTickBySymbol: updatedLatest,
          currentTime: isoToMs(nextTick.time),
          isPaused: true,
        });
      }
    } else {
      const next = advanceTimeLogic(currentTime, stepMinutes, masterData);
      if (next) set({ currentTime: next, isPaused: true });
    }
  },

  stepBackward: () => {
    const { bufferedTicks, currentTickIndex, currentTime, stepMinutes, masterData } = get();

    if (bufferedTicks.length > 0) {
      if (currentTickIndex > 0) {
        const prevIndex = currentTickIndex - 1;
        const prevTick = bufferedTicks[prevIndex];
        const updatedLatest: Record<string, MarketTick> = {};
        for (let i = 0; i <= prevIndex; i++) {
          const t = bufferedTicks[i];
          if (t && t.symbol) {
            updatedLatest[t.symbol.toUpperCase()] = t;
          }
        }
        set({
          currentTickIndex: prevIndex,
          currentTick: prevTick,
          latestTickBySymbol: updatedLatest,
          currentTime: isoToMs(prevTick.time),
          isPaused: true,
        });
      }
    } else {
      const prev = rewindTimeLogic(currentTime, stepMinutes, masterData);
      if (prev) set({ currentTime: prev, isPaused: true });
    }
  },

  seekTickIndex: (index) => {
    const { bufferedTicks } = get();
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
    set({
      currentTickIndex: clampedIndex,
      currentTick: targetTick,
      latestTickBySymbol: updatedLatest,
      currentTime: isoToMs(targetTick.time),
    });
  },

  seekTickTime: (time) => {
    const { bufferedTicks } = get();
    const targetMs = typeof time === 'number' ? time : isoToMs(time);
    if (bufferedTicks.length === 0) {
      set({ currentTime: targetMs });
      return;
    }

    let closestIndex = 0;
    let minDiff = Infinity;

    for (let i = 0; i < bufferedTicks.length; i++) {
      const tMs = isoToMs(bufferedTicks[i].time);
      const diff = Math.abs(tMs - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
      if (tMs >= targetMs) break;
    }

    const targetTick = bufferedTicks[closestIndex];
    const updatedLatest: Record<string, MarketTick> = {};
    for (let i = 0; i <= closestIndex; i++) {
      const t = bufferedTicks[i];
      if (t && t.symbol) {
        updatedLatest[t.symbol.toUpperCase()] = t;
      }
    }

    set({
      currentTickIndex: closestIndex,
      currentTick: targetTick,
      latestTickBySymbol: updatedLatest,
      currentTime: targetMs,
    });
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
    });
  },
}));
