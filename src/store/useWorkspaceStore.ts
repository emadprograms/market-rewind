import { create } from 'zustand';

export type GroupColor = 'none' | 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

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
  // Basic validation: alphanumeric, dots, dashes, max 20 chars
  const sanitized = ticker.trim().toUpperCase();
  if (sanitized.length === 0 || sanitized.length > 20) {
    console.warn(`Invalid ticker length: ${ticker}`);
  }
  if (!/^[A-Z0-9.\- ]+$/.test(sanitized)) {
    console.warn(`Invalid ticker characters: ${ticker}`);
  }
  return sanitized;
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  selectedId: null,
  tickers: {},
  groups: {},
  groupTickers: {},

  setSelectedId: (id) => set({ selectedId: id }),
  
  setTicker: (id, ticker) => {
    const validated = validateTicker(ticker);
    set((state) => ({
      tickers: { ...state.tickers, [id]: validated },
    }));
  },

  setGroup: (id, group) => {
    set((state) => ({
      groups: { ...state.groups, [id]: group },
    }));
  },

  setGroupTicker: (group, ticker) => {
    if (group === 'none') return;
    const validated = validateTicker(ticker);
    set((state) => ({
      groupTickers: { ...state.groupTickers, [group]: validated },
    }));
  },
}));

/**
 * Returns the effective ticker for a chart.
 * If the chart is assigned to a group other than 'none', return the group's ticker.
 * Otherwise, return the chart's own ticker.
 */
export const getEffectiveTicker = (id: string) => {
  const { groups, groupTickers, tickers } = useWorkspaceStore.getState();
  const group = groups[id] || 'none';
  
  if (group !== 'none' && groupTickers[group]) {
    return groupTickers[group];
  }
  
  return tickers[id] || '';
};
