import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GroupColor } from '../types';

interface WorkspaceState {
  selectedId: string | null;
  tickers: Record<string, string>; // chartId -> ticker
  groups: Record<string, GroupColor>; // chartId -> group color
  groupTickers: Record<string, string>; // group color -> ticker

  // Actions
  setSelectedId: (id: string) => void;
  setTicker: (id: string, ticker: string) => void;
  setGroup: (id: string, group: GroupColor) => void;
  setGroupTicker: (group: GroupColor, ticker: string) => void;
}

const validateTicker = (ticker: string): string => {
  const sanitized = ticker.trim().toUpperCase();
  if (sanitized.length === 0 || sanitized.length > 20) {
    console.warn(`Invalid ticker length: ${ticker}`);
  }
  if (!/^[A-Z0-9.\- ]+$/.test(sanitized)) {
    console.warn(`Invalid ticker characters: ${ticker}`);
  }
  return sanitized;
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      selectedId: null,
      tickers: {},
      groups: {},
      groupTickers: { red: 'SPY', blue: 'SPY', green: 'SPY', yellow: 'SPY' },

      setSelectedId: (id) => set({ selectedId: id }),
      
      setTicker: (id, ticker) => {
        const validated = validateTicker(ticker);
        set((state) => {
          const group = state.groups[id] || 'none';
          const nextTickers = { ...state.tickers, [id]: validated };
          const nextGroupTickers = { ...state.groupTickers };
          
          if (group !== 'none') {
            nextGroupTickers[group] = validated;
          }
          
          return {
            tickers: nextTickers,
            groupTickers: nextGroupTickers
          };
        });
      },

      setGroup: (id, group) => {
        const allowedGroups: GroupColor[] = ['none', 'red', 'blue', 'green', 'yellow'];
        if (!allowedGroups.includes(group)) {
          console.warn(`Invalid group color provided: ${group}. Reverting to 'none'.`);
          set((state) => ({
            groups: { ...state.groups, [id]: 'none' },
          }));
          return;
        }

        set((state) => {
          const nextGroups = { ...state.groups, [id]: group };
          const nextTickers = { ...state.tickers };
          const nextGroupTickers = { ...state.groupTickers };
          
          if (group !== 'none') {
            if (!nextGroupTickers[group]) {
              // If group has no ticker yet, adopt the chart's current ticker
              nextGroupTickers[group] = state.tickers[id] || 'SPY';
            }
            // Ensure individual ticker matches group ticker
            nextTickers[id] = nextGroupTickers[group];
          }

          return {
            groups: nextGroups,
            tickers: nextTickers,
            groupTickers: nextGroupTickers
          };
        });
      },

      setGroupTicker: (group, ticker) => {
        if (group === 'none') return;
        const validated = validateTicker(ticker);
        set((state) => ({
          groupTickers: { ...state.groupTickers, [group]: validated },
        }));
      },
    }),
    {
      name: 'workspace-storage', // unique name for localStorage key
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ groups: state.groups, groupTickers: state.groupTickers, tickers: state.tickers }),
    }
  )
);

export const getEffectiveTicker = (id: string) => {
  const { groups, groupTickers, tickers } = useWorkspaceStore.getState();
  const group = groups[id] || 'none';
  
  if (group !== 'none' && groupTickers[group]) {
    return groupTickers[group];
  }
  
  return tickers[id] || '';
};
