import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('Time-Based Playback Scrubbing & Continuation', () => {
  // Scenario:
  // Stock session starts at 09:20 AM ET.
  // User prepares for the open.
  // Pre-market has occasional ticks:
  // - 09:20:00 (tick 0)
  // - 09:22:30 (tick 1)
  // - 09:25:00 (tick 2)
  // Market opens at 09:30:00 with burst of ticks:
  // - 09:30:00.050 (tick 3)
  // - 09:30:00.200 (tick 4)
  // - 09:30:01.000 (tick 5)
  // Post-open trading continues:
  // - 09:35:00.000 (tick 6)

  const ticks: MarketTick[] = [
    { time: '2026-09-25 13:20:00.000', symbol: 'NVDA', price: 215.0, volume: 100 },
    { time: '2026-09-25 13:22:30.000', symbol: 'NVDA', price: 215.2, volume: 150 },
    { time: '2026-09-25 13:25:00.000', symbol: 'NVDA', price: 215.5, volume: 200 },
    { time: '2026-09-25 13:30:00.050', symbol: 'NVDA', price: 217.0, volume: 5000 },
    { time: '2026-09-25 13:30:00.200', symbol: 'NVDA', price: 217.5, volume: 3000 },
    { time: '2026-09-25 13:30:01.000', symbol: 'NVDA', price: 217.2, volume: 1200 },
    { time: '2026-09-25 13:35:00.000', symbol: 'NVDA', price: 219.0, volume: 4000 },
  ];

  const ms0920 = isoToMs('2026-09-25 13:20:00.000');
  const ms0929 = isoToMs('2026-09-25 13:29:00.000');
  const ms0930 = isoToMs('2026-09-25 13:30:00.000');
  const ms0930_100 = isoToMs('2026-09-25 13:30:00.100');

  beforeEach(() => {
    usePlaybackStore.getState().reset();
    usePlaybackStore.getState().setBufferedTicks(ticks);
    usePlaybackStore.getState().setCurrentTime(ms0920);
    usePlaybackStore.getState().seekTickTime(ms0920);
    usePlaybackStore.getState().setPaused(true);
  });

  it('initializes at 09:20 AM ET preparation anchor with initial pre-market tick', () => {
    const s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(ms0920);
    expect(s.currentTickIndex).toBe(0);
    expect(s.currentTick?.price).toBe(215.0);
    expect(s.isPaused).toBe(true);
  });

  it('scrubs to 09:29 AM ET without leaking market-open ticks', () => {
    // User moves slider to 09:29:00 AM ET to prepare right before the open
    usePlaybackStore.getState().seekTickTime(ms0929);

    const s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(ms0929);
    // At 09:29:00, latest tick executed was 09:25:00 (index 2)
    expect(s.currentTickIndex).toBe(2);
    expect(s.currentTick?.price).toBe(215.5);
    // Zero lookahead bias: market open tick (index 3 at 09:30:00.050) has NOT occurred
    expect(s.currentTick?.price).not.toBe(217.0);
  });

  it('continues smoothly from 09:29 AM ET when playback runs forward into open', () => {
    // 1. User scrubs to 09:29:00 AM ET
    usePlaybackStore.getState().seekTickTime(ms0929);
    usePlaybackStore.getState().setPaused(false);

    // 2. Playback advances 30 seconds into pre-market (09:29:30 AM ET)
    const ms0929_30 = ms0929 + 30000;
    usePlaybackStore.getState().advanceSimulationTime(ms0929_30);

    let s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(ms0929_30);
    expect(s.currentTickIndex).toBe(2); // Still at 09:25 tick since no new pre-market ticks

    // 3. Playback reaches 09:30:00.100 ET (market open)
    usePlaybackStore.getState().advanceSimulationTime(ms0930_100);

    s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(ms0930_100);
    // Tick 3 (09:30:00.050) has occurred!
    expect(s.currentTickIndex).toBe(3);
    expect(s.currentTick?.price).toBe(217.0);

    // 4. Playback reaches 09:30:01.000 ET
    const ms0930_1000 = isoToMs('2026-09-25 13:30:01.000');
    usePlaybackStore.getState().advanceSimulationTime(ms0930_1000);

    s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(ms0930_1000);
    expect(s.currentTickIndex).toBe(5);
    expect(s.currentTick?.price).toBe(217.2);
  });

  it('scrubs to 09:30 AM ET open and executes opening tick immediately', () => {
    // User moves slider to exact 09:30:00.050 open
    const msOpenTick = isoToMs('2026-09-25 13:30:00.050');
    usePlaybackStore.getState().seekTickTime(msOpenTick);

    const s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(msOpenTick);
    expect(s.currentTickIndex).toBe(3);
    expect(s.currentTick?.price).toBe(217.0);
  });

  it('scrubs backward from 09:30 AM ET to 09:25 AM ET and rewinds state correctly', () => {
    // First at open
    usePlaybackStore.getState().seekTickTime(ms0930_100);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(3);

    // User rewinds slider to 09:25:00
    const ms0925 = isoToMs('2026-09-25 13:25:00.000');
    usePlaybackStore.getState().seekTickTime(ms0925);

    const s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(ms0925);
    expect(s.currentTickIndex).toBe(2);
    expect(s.currentTick?.price).toBe(215.5);
  });

  it('handles seeking before the first tick without crashing or throwing', () => {
    const earlyTime = ms0920 - 60000; // 09:19:00
    usePlaybackStore.getState().seekTickTime(earlyTime);

    const s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(earlyTime);
    expect(s.currentTickIndex).toBe(-1);
    expect(s.currentTick).toBeNull();

    // Now simulation advances past first tick (09:20:00)
    usePlaybackStore.getState().advanceSimulationTime(ms0920);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(0);
    expect(usePlaybackStore.getState().currentTick?.price).toBe(215.0);
  });
});
