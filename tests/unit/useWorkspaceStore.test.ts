import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, getEffectiveTicker } from '../../src/store/useWorkspaceStore';

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useWorkspaceStore.setState({
      selectedId: null,
      tickers: {},
      groups: {},
      groupTickers: {},
    });
  });

  it('should update selectedId', () => {
    useWorkspaceStore.getState().setSelectedId('chart-1');
    expect(useWorkspaceStore.getState().selectedId).toBe('chart-1');
  });

  it('should validate and set tickers', () => {
    useWorkspaceStore.getState().setTicker('chart-1', 'AAPL!');
    expect(useWorkspaceStore.getState().tickers['chart-1']).toBe('AAPL');
    
    useWorkspaceStore.getState().setTicker('chart-2', 'very-long-ticker-name-that-should-be-truncated');
    expect(useWorkspaceStore.getState().tickers['chart-2']).toHaveLength(20);
  });

  it('should handle group assignments', () => {
    useWorkspaceStore.getState().setGroup('chart-1', 'red');
    expect(useWorkspaceStore.getState().groups['chart-1']).toBe('red');
  });

  it('should correctly derive effective ticker', () => {
    // Individual ticker
    useWorkspaceStore.getState().setTicker('chart-1', 'AAPL');
    expect(getEffectiveTicker('chart-1')).toBe('AAPL');

    // Group ticker override
    useWorkspaceStore.getState().setGroup('chart-1', 'red');
    useWorkspaceStore.getState().setGroupTicker('red', 'TSLA');
    expect(getEffectiveTicker('chart-1')).toBe('TSLA');

    // No ticker case
    expect(getEffectiveTicker('non-existent')).toBe('NO TICKER');
  });
});
