import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, getEffectiveTicker } from '../../src/store/useWorkspaceStore';

describe('Group Synchronization Unit Tests', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      selectedId: null,
      tickers: {},
      groups: {},
      groupTickers: {},
    });
  });

  it('should return the chart ticker when not in a group', () => {
    useWorkspaceStore.setState({
      tickers: { 'chart1': 'AAPL' },
      groups: { 'chart1': 'none' },
      groupTickers: {},
    });
    
    expect(getEffectiveTicker('chart1')).toBe('AAPL');
  });

  it('should return the group ticker when in a group', () => {
    useWorkspaceStore.setState({
      tickers: { 'chart1': 'AAPL' },
      groups: { 'chart1': 'blue' },
      groupTickers: { 'blue': 'MSFT' },
    });
    
    expect(getEffectiveTicker('chart1')).toBe('MSFT');
  });

  it('should return empty string when no ticker is available', () => {
    useWorkspaceStore.setState({
      tickers: {},
      groups: { 'chart1': 'none' },
      groupTickers: {},
    });
    
    expect(getEffectiveTicker('chart1')).toBe('');
  });

  it('should update group ticker when setGroupTicker is called', () => {
    useWorkspaceStore.setState({
      groups: { 'chart1': 'red' },
      groupTickers: { 'red': 'AAPL' },
    });
    
    useWorkspaceStore.getState().setGroupTicker('red', 'TSLA');
    
    expect(getEffectiveTicker('chart1')).toBe('TSLA');
  });

  it('should resolve ticker inheritance immediately upon setting a group', () => {
    useWorkspaceStore.setState({
      tickers: { 'chart1': 'AAPL' },
      groupTickers: { 'green': 'MSFT' },
    });
    
    // Chart 1 joins green group
    useWorkspaceStore.getState().setGroup('chart1', 'green');
    
    expect(getEffectiveTicker('chart1')).toBe('MSFT');
  });

  it('should revert to chart ticker when group is set to none', () => {
    useWorkspaceStore.setState({
      tickers: { 'chart1': 'AAPL' },
      groups: { 'chart1': 'blue' },
      groupTickers: { 'blue': 'MSFT' },
    });
    
    useWorkspaceStore.getState().setGroup('chart1', 'none');
    
    expect(getEffectiveTicker('chart1')).toBe('AAPL');
  });

  it('should validate tickers and sanitize them to uppercase', () => {
    useWorkspaceStore.getState().setTicker('chart1', '  aapl  ');
    expect(getEffectiveTicker('chart1')).toBe('AAPL');
    
    useWorkspaceStore.getState().setGroupTicker('red', '  msft  ');
    useWorkspaceStore.setState({ groups: { 'chart1': 'red' } });
    expect(getEffectiveTicker('chart1')).toBe('MSFT');
  });
});
