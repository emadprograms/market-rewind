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
        set((state) => ({
          tickers: { ...state.tickers, [id]: validated },
        }));
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
          const oldGroup = state.groups[id];
          const nextGroups = { ...state.groups, [id]: group };
          
          // Check if the old group is now empty
          let nextGroupTickers = { ...state.groupTickers };
          if (oldGroup && oldGroup !== 'none' && oldGroup !== group) {
            const isNowEmpty = Object.values(nextGroups).every(g => g !== oldGroup);
            if (isNowEmpty) {
              const { [oldGroup]: _, ...rest } = nextGroupTickers;
              nextGroupTickers = rest;
            }
          }

          return {
            groups: nextGroups,
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
