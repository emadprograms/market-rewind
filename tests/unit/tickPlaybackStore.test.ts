import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('Tick Playback Store Unit Tests', () => {
  const sampleTicks: MarketTick[] = [
    { time: '2026-09-25 14:30:00.100', symbol: 'NVDA', price: 180.0, volume: 10 },
    { time: '2026-09-25 14:30:00.350', symbol: 'NVDA', price: 180.25, volume: 5 },
    { time: '2026-09-25 14:30:01.000', symbol: 'NVDA', price: 179.9, volume: 20 },
    { time: '2026-09-25 14:30:02.500', symbol: 'NVDA', price: 180.5, volume: 15 },
  ];

  beforeEach(() => {
    usePlaybackStore.getState().reset();
  });

  it('should initialize with buffered ticks', () => {
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);

    const state = usePlaybackStore.getState();
    expect(state.totalTicks).toBe(4);
    expect(state.currentTickIndex).toBe(0);
    expect(state.currentTick?.price).toBe(180.0);
    expect(state.currentTime).toBe(isoToMs(sampleTicks[0].time));
    expect(state.isPaused).toBe(true);
  });

  it('should step forward by single tick and update currentTick', () => {
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);

    usePlaybackStore.getState().stepForward();
    let state = usePlaybackStore.getState();
    expect(state.currentTickIndex).toBe(1);
    expect(state.currentTick?.price).toBe(180.25);
    expect(state.isPaused).toBe(true);

    usePlaybackStore.getState().stepForward();
    state = usePlaybackStore.getState();
    expect(state.currentTickIndex).toBe(2);
    expect(state.currentTick?.price).toBe(179.9);
  });

  it('should step backward by single tick', () => {
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);

    usePlaybackStore.getState().seekTickIndex(2);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(2);

    usePlaybackStore.getState().stepBackward();
    const state = usePlaybackStore.getState();
    expect(state.currentTickIndex).toBe(1);
    expect(state.currentTick?.price).toBe(180.25);
  });

  it('should seek to specific tick index and clamp within bounds', () => {
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);

    usePlaybackStore.getState().seekTickIndex(3);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(3);
    expect(usePlaybackStore.getState().currentTick?.price).toBe(180.5);

    // Clamp out-of-bounds index
    usePlaybackStore.getState().seekTickIndex(999);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(3);

    usePlaybackStore.getState().seekTickIndex(-5);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(0);
  });

  it('should seek by timestamp to the last executed tick at or before target time without look-ahead bias', () => {
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);

    usePlaybackStore.getState().seekTickTime('2026-09-25 14:30:00.800');
    // At 14:30:00.800, the tick at 14:30:01.000 is in the future. Last executed tick is index 1 (14:30:00.350)
    expect(usePlaybackStore.getState().currentTickIndex).toBe(1);
    expect(usePlaybackStore.getState().currentTick?.price).toBe(180.25);
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:30:00.800'));
  });

  it('should support configurable playback speeds', () => {
    usePlaybackStore.getState().setPlaybackSpeed(5);
    expect(usePlaybackStore.getState().playbackSpeed).toBe(5);

    usePlaybackStore.getState().setPlaybackSpeed(50);
    expect(usePlaybackStore.getState().playbackSpeed).toBe(50);
  });

  it('should advance ticks during playback loop when not paused', () => {
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);
    usePlaybackStore.getState().setPaused(false);

    usePlaybackStore.getState().tick();
    expect(usePlaybackStore.getState().currentTickIndex).toBe(1);

    usePlaybackStore.getState().tick();
    expect(usePlaybackStore.getState().currentTickIndex).toBe(2);
  });
});
