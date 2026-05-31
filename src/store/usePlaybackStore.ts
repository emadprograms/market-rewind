import { create } from 'zustand';
import type { RawBar } from '../types';

interface PlaybackState {
  currentTime: number | null; // Unix ms
  isPaused: boolean;
  playbackSpeed: number;
  stepMinutes: number;
  masterData: RawBar[];

  // Actions
  setCurrentTime: (time: number | null) => void;
  setPaused: (paused: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setStepMinutes: (minutes: number) => void;
  setMasterData: (data: RawBar[]) => void;
  
  tick: () => void;
  stepForward: () => void;
  stepBackward: () => void;
}

const isoToMs = (iso: string) => new Date(iso.replace(' ', 'T') + 'Z').getTime();
const msToIso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

const advanceTimeLogic = (currentMs: number | null, stepMinutes: number, masterData: RawBar[]) => {
  if (!currentMs || masterData.length === 0) return null;
  
  const targetMs = currentMs + stepMinutes * 60000;
  const targetStr = msToIso(targetMs);
  
  const nextBar = masterData.find(d => d.time >= targetStr);
  if (nextBar) {
    const nextMs = isoToMs(nextBar.time);
    return nextMs !== currentMs ? nextMs : null;
  }
  return null;
};

const rewindTimeLogic = (currentMs: number | null, stepMinutes: number, masterData: RawBar[]) => {
  if (!currentMs || masterData.length === 0) return currentMs;
  
  const targetMs = currentMs - stepMinutes * 60000;
  const targetStr = msToIso(targetMs);
  
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
  currentTime: null,
  isPaused: true,
  playbackSpeed: 1,
  stepMinutes: 1,
  masterData: [],

  setCurrentTime: (time) => set({ currentTime: time }),
  setPaused: (paused) => set({ isPaused: paused }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setStepMinutes: (minutes) => set({ stepMinutes: minutes }),
  setMasterData: (data) => set({ masterData: data }),

  tick: () => {
    const { currentTime, stepMinutes, masterData, isPaused } = get();
    if (isPaused) return;
    
    const next = advanceTimeLogic(currentTime, stepMinutes, masterData);
    if (next) {
      set({ currentTime: next });
    } else {
      set({ isPaused: true });
    }
  },

  stepForward: () => {
    const { currentTime, stepMinutes, masterData } = get();
    const next = advanceTimeLogic(currentTime, stepMinutes, masterData);
    if (next) set({ currentTime: next });
  },

  stepBackward: () => {
    const { currentTime, stepMinutes, masterData } = get();
    const prev = rewindTimeLogic(currentTime, stepMinutes, masterData);
    if (prev) set({ currentTime: prev });
  }
}));
