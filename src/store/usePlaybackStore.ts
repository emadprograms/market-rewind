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
  
  tick: () => void;
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
    const firstTick = ticks[0] || null;
    const initialMs = firstTick ? isoToMs(firstTick.time) : null;
    set({
      bufferedTicks: ticks,
      totalTicks: ticks.length,
      currentTickIndex: 0,
      currentTick: firstTick,
      currentTime: initialMs,
    });
  },

  addTicks: (newTicks) => {
    set((state) => {
      const combined = [...state.bufferedTicks, ...newTicks];
      return {
        bufferedTicks: combined,
        totalTicks: combined.length,
      };
    });
  },

  tick: () => {
    const { replayMode, isPaused, bufferedTicks, currentTickIndex, currentTime, stepMinutes, masterData } = get();
    if (isPaused) return;

    if (replayMode === 'tick') {
      if (currentTickIndex < bufferedTicks.length - 1) {
        const nextIndex = currentTickIndex + 1;
        const nextTick = bufferedTicks[nextIndex];
        set({
          currentTickIndex: nextIndex,
          currentTick: nextTick,
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
    const { replayMode, bufferedTicks, currentTickIndex, currentTime, stepMinutes, masterData } = get();

    if (replayMode === 'tick') {
      if (bufferedTicks.length > 0 && currentTickIndex < bufferedTicks.length - 1) {
        const nextIndex = currentTickIndex + 1;
        const nextTick = bufferedTicks[nextIndex];
        set({
          currentTickIndex: nextIndex,
          currentTick: nextTick,
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
    const { replayMode, bufferedTicks, currentTickIndex, currentTime, stepMinutes, masterData } = get();

    if (replayMode === 'tick') {
      if (bufferedTicks.length > 0 && currentTickIndex > 0) {
        const prevIndex = currentTickIndex - 1;
        const prevTick = bufferedTicks[prevIndex];
        set({
          currentTickIndex: prevIndex,
          currentTick: prevTick,
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
    set({
      currentTickIndex: clampedIndex,
      currentTick: targetTick,
      currentTime: isoToMs(targetTick.time),
    });
  },

  seekTickTime: (time) => {
    const { bufferedTicks } = get();
    if (bufferedTicks.length === 0) return;

    const targetMs = typeof time === 'number' ? time : isoToMs(time);
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
    set({
      currentTickIndex: closestIndex,
      currentTick: targetTick,
      currentTime: isoToMs(targetTick.time),
    });
  },

  reset: () => {
    set({
      currentTime: null,
      isPaused: true,
      currentTickIndex: 0,
      currentTick: null,
      bufferedTicks: [],
      totalTicks: 0,
    });
  },
}));
