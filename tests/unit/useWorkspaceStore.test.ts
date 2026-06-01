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

  it('should set and get the selectedId', () => {
    useWorkspaceStore.getState().setSelectedId('chart-1');
    expect(useWorkspaceStore.getState().selectedId).toBe('chart-1');
  });

  it('should set and validate tickers', () => {
    useWorkspaceStore.getState().setTicker('chart-1', ' apple ');
    expect(useWorkspaceStore.getState().tickers['chart-1']).toBe('APPLE');
  });

  it('should set and get group colors', () => {
    useWorkspaceStore.getState().setGroup('chart-1', 'red');
    expect(useWorkspaceStore.getState().groups['chart-1']).toBe('red');
  });

  it('should set group tickers', () => {
    useWorkspaceStore.getState().setGroupTicker('red', 'BTCUSD');
    expect(useWorkspaceStore.getState().groupTickers['red']).toBe('BTCUSD');
  });

  describe('getEffectiveTicker', () => {
    it('should return the chart ticker if not in a group', () => {
      useWorkspaceStore.getState().setTicker('chart-1', 'AAPL');
      useWorkspaceStore.getState().setGroup('chart-1', 'none');
      expect(getEffectiveTicker('chart-1')).toBe('AAPL');
    });

    it('should return the group ticker if the chart is in a group', () => {
      useWorkspaceStore.getState().setTicker('chart-1', 'AAPL');
      useWorkspaceStore.getState().setGroup('chart-1', 'red');
      useWorkspaceStore.getState().setGroupTicker('red', 'BTCUSD');
      expect(getEffectiveTicker('chart-1')).toBe('BTCUSD');
    });

    it('should fallback to chart ticker if group ticker is missing', () => {
      useWorkspaceStore.getState().setTicker('chart-1', 'AAPL');
      useWorkspaceStore.getState().setGroup('chart-1', 'red');
      // groupTickers['red'] is not set
      expect(getEffectiveTicker('chart-1')).toBe('AAPL');
    });

    it('should return empty string if no ticker is found', () => {
      expect(getEffectiveTicker('unknown')).toBe('');
    });
  });
});
