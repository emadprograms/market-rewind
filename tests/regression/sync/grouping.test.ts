import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, getEffectiveTicker } from '../../../src/store/useWorkspaceStore';
import { act } from '@testing-library/react';

describe('Group Synchronization Logical Tests', () => {
  beforeEach(() => {
    // Reset store to a clean state before each test
    act(() => {
      useWorkspaceStore.setState({
        selectedId: null,
        tickers: {},
        groups: {},
        groupTickers: {},
      });
    });
  });

  it('SYNC-02: should sync ticker on mount (join existing group)', () => {
    const groupColor = 'red';
    const groupTicker = 'BTC';
    
    // 1. Establish a group with a ticker
    act(() => {
      useWorkspaceStore.getState().setGroupTicker(groupColor, groupTicker);
    });

    // 2. Join a chart to that group
    const chartId = 'chart-1';
    act(() => {
      useWorkspaceStore.getState().setGroup(chartId, groupColor);
    });

    // 3. Verify the effective ticker is the group ticker
    expect(getEffectiveTicker(chartId)).toBe(groupTicker);
  });

  it('SYNC-03: should propagate ticker changes to all group members', () => {
    const groupColor = 'blue';
    const chart1 = 'chart-1';
    const chart2 = 'chart-2';

    // 1. Setup group and members
    act(() => {
      useWorkspaceStore.getState().setGroup(chart1, groupColor);
      useWorkspaceStore.getState().setGroup(chart2, groupColor);
      useWorkspaceStore.getState().setGroupTicker(groupColor, 'BTC');
    });

    expect(getEffectiveTicker(chart1)).toBe('BTC');
    expect(getEffectiveTicker(chart2)).toBe('BTC');

    // 2. Change group ticker
    act(() => {
      useWorkspaceStore.getState().setGroupTicker(groupColor, 'ETH');
    });

    // 3. Verify both members now have the new ticker
    expect(getEffectiveTicker(chart1)).toBe('ETH');
    expect(getEffectiveTicker(chart2)).toBe('ETH');
  });

  it('SYNC-04: should stop syncing when a chart leaves a group', () => {
    const groupColor = 'green';
    const chartId = 'chart-1';

    // 1. Join group
    act(() => {
      useWorkspaceStore.getState().setGroup(chartId, groupColor);
      useWorkspaceStore.getState().setGroupTicker(groupColor, 'BTC');
    });
    expect(getEffectiveTicker(chartId)).toBe('BTC');

    // 2. Leave group (set to 'none')
    act(() => {
      useWorkspaceStore.getState().setGroup(chartId, 'none');
    });

    // 3. Change group ticker
    act(() => {
      useWorkspaceStore.getState().setGroupTicker(groupColor, 'ETH');
    });

    // 4. Verify chart does not change (it should now use its own ticker or empty)
    expect(getEffectiveTicker(chartId)).not.toBe('ETH');
  });

  it('SYNC-05: should adopt group ticker when joining a group', () => {
    const groupColor = 'yellow';
    const chartId = 'chart-1';

    // 1. Chart starts with its own ticker
    act(() => {
      useWorkspaceStore.getState().setTicker(chartId, 'SOL');
    });
    expect(getEffectiveTicker(chartId)).toBe('SOL');

    // 2. Join a group that already has a ticker
    act(() => {
      useWorkspaceStore.getState().setGroupTicker(groupColor, 'BTC');
      useWorkspaceStore.getState().setGroup(chartId, groupColor);
    });

    // 3. Verify it now uses the group ticker
    expect(getEffectiveTicker(chartId)).toBe('BTC');
  });
});
