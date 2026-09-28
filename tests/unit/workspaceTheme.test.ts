import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';

describe('useWorkspaceStore - Theme & Timeframe Management', () => {
  beforeEach(() => {
    // Reset state before each test
    useWorkspaceStore.setState({
      theme: 'oled',
      timeframes: {},
    });
  });

  describe('Theme Cycling', () => {
    it('defaults to oled theme', () => {
      const theme = useWorkspaceStore.getState().theme;
      expect(theme).toBe('oled');
    });

    it('cycles from oled -> dark -> light -> oled', () => {
      const store = useWorkspaceStore.getState();

      expect(useWorkspaceStore.getState().theme).toBe('oled');

      store.cycleTheme();
      expect(useWorkspaceStore.getState().theme).toBe('dark');

      store.cycleTheme();
      expect(useWorkspaceStore.getState().theme).toBe('light');

      store.cycleTheme();
      expect(useWorkspaceStore.getState().theme).toBe('oled');
    });

    it('manually sets specific theme via setState', () => {
      useWorkspaceStore.setState({ theme: 'light' });
      expect(useWorkspaceStore.getState().theme).toBe('light');

      useWorkspaceStore.getState().cycleTheme();
      expect(useWorkspaceStore.getState().theme).toBe('oled');
    });
  });

  describe('Per-Chart Timeframe Management', () => {
    it('sets and updates timeframe for a specific chart ID', () => {
      const store = useWorkspaceStore.getState();

      store.setTimeframe('chart-1', '5min');
      expect(useWorkspaceStore.getState().timeframes['chart-1']).toBe('5min');

      store.setTimeframe('chart-2', '1D');
      expect(useWorkspaceStore.getState().timeframes['chart-2']).toBe('1D');
      expect(useWorkspaceStore.getState().timeframes['chart-1']).toBe('5min');

      // Update chart-1
      store.setTimeframe('chart-1', '15min');
      expect(useWorkspaceStore.getState().timeframes['chart-1']).toBe('15min');
    });
  });
});
