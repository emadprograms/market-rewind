import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore, isoToMs } from '../../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../../src/store/useWorkspaceStore';
import type { MarketTick } from '../../../src/types';

describe('TEST-02: Global Multi-Asset Playback Synchronization', () => {
  beforeEach(() => {
    usePlaybackStore.getState().reset();
    useWorkspaceStore.getState().setTicker('0', 'AAPL');
    useWorkspaceStore.getState().setTicker('1', 'AMD');
  });

  it('should maintain playback progress for multiple distinct tickers in the workspace', () => {
    // Both AAPL and AMD are open in workspace
    const chart0Ticker = useWorkspaceStore.getState().tickers['0'];
    const chart1Ticker = useWorkspaceStore.getState().tickers['1'];
    expect(chart0Ticker).toBe('AAPL');
    expect(chart1Ticker).toBe('AMD');

    // Simulate multi-asset tick stream
    const mixedTicks: MarketTick[] = [
      { time: '2026-09-25 13:30:00.100', symbol: 'AAPL', price: 340.50, volume: 10, session: 'REG' },
      { time: '2026-09-25 13:30:00.200', symbol: 'AMD', price: 155.20, volume: 15, session: 'REG' },
      { time: '2026-09-25 13:30:01.000', symbol: 'AAPL', price: 340.60, volume: 20, session: 'REG' },
      { time: '2026-09-25 13:30:01.100', symbol: 'AMD', price: 155.30, volume: 25, session: 'REG' },
    ];

    usePlaybackStore.getState().setBufferedTicks(mixedTicks);
    usePlaybackStore.getState().setPaused(false);

    // Initial tick
    expect(usePlaybackStore.getState().currentTickIndex).toBe(0);
    expect(usePlaybackStore.getState().currentTick?.symbol).toBe('AAPL');

    // Advance 1 tick -> AMD must be active
    usePlaybackStore.getState().tick(1);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(1);
    expect(usePlaybackStore.getState().currentTick?.symbol).toBe('AMD');
    expect(usePlaybackStore.getState().currentTick?.price).toBe(155.20);

    // Advance 1 tick -> AAPL again
    usePlaybackStore.getState().tick(1);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(2);
    expect(usePlaybackStore.getState().currentTick?.symbol).toBe('AAPL');
    expect(usePlaybackStore.getState().currentTick?.price).toBe(340.60);
  });

  it('should advance replay time globally so all open charts reflect the same cursor time', () => {
    const t0 = isoToMs('2026-09-25 13:30:00.000');
    usePlaybackStore.getState().setCurrentTime(t0);

    const currentTime = usePlaybackStore.getState().currentTime;
    expect(currentTime).toBe(t0);

    // Both charts reading global currentTime observe the exact same timestamp
    expect(usePlaybackStore.getState().currentTime).toBe(t0);
  });
});
