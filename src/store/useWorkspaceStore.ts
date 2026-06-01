import { create } from 'zustand';

export type GroupColor = 'none' | 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

interface WorkspaceState {
  selectedId: string | null;
  tickers: Record<string, string>;
  groups: Record<string, GroupColor>;
  groupTickers: Record<string, string>;

  // Actions
  setSelectedId: (id: string) => void;
  setTicker: (id: string, ticker: string) => void;
  setGroup: (id: string, group: GroupColor) => void;
  setGroupTicker: (group: string, ticker: string) => void;
}

/**
 * Validates ticker strings to prevent unexpected characters or excessive length.
 * Mitigation for T-02-01.
 */
const validateTicker = (ticker: string): string => {
  // Allow alphanumeric, dots, dashes, and underscores. Max length 20.
  const sanitized = ticker.replace(/[^a-zA-Z0-9.\-_]/g, '').substring(0, 20).toUpperCase();
  return sanitized || 'UNKNOWN';
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  selectedId: null,
  tickers: {},
  groups: {},
  groupTickers: {},

  setSelectedId: (id) => set({ selectedId: id }),

  setTicker: (id, ticker) => 
    set((state) => ({
      tickers: {
        ...state.tickers,
        [id]: validateTicker(ticker),
      },
    })),

  setGroup: (id, group) => 
    set((state) => ({
      groups: {
        ...state.groups,
        [id]: group,
      },
    })),

  setGroupTicker: (group, ticker) => 
    set((state) => ({
      groupTickers: {
        ...state.groupTickers,
        [group]: validateTicker(ticker),
      },
    })),
}));

/**
 * Returns the effective ticker for a chart.
 * If the chart is assigned to a group and that group has a ticker, use the group ticker.
 * Otherwise, fallback to the chart's individual ticker.
 */
export const getEffectiveTicker = (id: string) => {
  const { groups, groupTickers, tickers } = useWorkspaceStore.getState();
  const group = groups[id];
  
  if (group && group !== 'none' && groupTickers[group]) {
    return groupTickers[group];
  }
  
  return tickers[id] || 'NO TICKER';
};
