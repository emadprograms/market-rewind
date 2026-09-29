import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';

// Minimal types for the tests based on user instructions
interface MarketTick {
  time: string;
  price: number;
  volume: number;
  symbol: string;
  bid: number;
  ask: number;
}

interface RawBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: string;
}

function makeTick(timeUtc: string, price: number, symbol = 'SPY'): MarketTick {
  return { time: timeUtc, price, volume: 100, symbol, bid: price - 0.01, ask: price + 0.01 };
}

function makeBar(timeUtc: string, open: number, close?: number): RawBar {
  const c = close ?? open + 0.5;
  return { time: timeUtc, open, high: Math.max(open, c) + 0.2, low: Math.min(open, c) - 0.2, close: c, volume: 1000, session: 'REG' };
}

// Mock date parser for the app's specific UTC string format
function parseAppTimeMs(timeUtc: string) {
  return new Date(timeUtc.replace(' ', 'T') + 'Z').getTime();
}

describe('seekChartBehavior', () => {
  beforeEach(() => {
    usePlaybackStore.getState().reset();
  });

  describe('seekTickTime behavior', () => {
    it('Bug 1: seekTickTime does NOT pause playback', () => {
      const store = usePlaybackStore.getState();
      
      // Setup state
      usePlaybackStore.setState({ isPaused: false });
      
      const targetTimeMs = parseAppTimeMs('2024-09-29 13:45:00');
      
      // Action
      usePlaybackStore.getState().seekTickTime(targetTimeMs);
      
      // Assertion
      expect(usePlaybackStore.getState().isPaused).toBe(true);
    });

    it('Bug 5: seekTickTime correctly updates latestTickBySymbol', () => {
      // 1. Create buffered ticks for SPY from 9:30-10:15, one per second
      // 9:30 ET is 13:30 UTC
      const startTimeMs = parseAppTimeMs('2024-09-29 13:30:00');
      const targetTimeMs = parseAppTimeMs('2024-09-29 14:00:00'); // 10:00 AM ET
      
      const bufferedTicks = [];
      for (let i = 0; i < 45 * 60; i++) {
        const time = new Date(startTimeMs + i * 1000).toISOString().replace('T', ' ').substring(0, 19);
        bufferedTicks.push(makeTick(time, 100 + i * 0.01));
      }
      
      usePlaybackStore.setState({ 
        bufferedTicks,
        isPaused: true
      });
      
      // 2. Call seekTickTime to 10:00 AM
      usePlaybackStore.getState().seekTickTime(targetTimeMs);
      
      // 3. Assert latestTickBySymbol['SPY'] exists and its time <= 10:00 AM
      const state = usePlaybackStore.getState();
      const latestTick = state.latestTickBySymbol['SPY'];
      
      expect(latestTick).toBeDefined();
      const latestTickTimeMs = parseAppTimeMs(latestTick.time);
      expect(latestTickTimeMs).toBeLessThanOrEqual(targetTimeMs);
      
      // 4. Assert currentTickIndex points to the right tick
      // The tick at 10:00:00 should be exactly at index 30 * 60 = 1800
      expect(state.currentTickIndex).toBe(1800);
    });
  });

  describe('PERF-01 subscription behavior', () => {
    it('Bug 2: subscription skips seek updates when not paused', () => {
      // The bug: the hook only responds when isPaused === true
      // So if isPaused is false during a seek, the hook won't update
      
      // Simulate the component subscription
      let subscriberCallCount = 0;
      let lastTime = 0;
      
      const unsubscribe = usePlaybackStore.subscribe((state) => {
        // This is simulating the condition inside the useChartData hook:
        if (state.isPaused) {
          subscriberCallCount++;
          lastTime = state.currentTime;
        }
      });
      
      // 1. Set up store with isPaused: false, buffered ticks from 9:30-10:15
      usePlaybackStore.setState({ 
        isPaused: false,
        currentTime: parseAppTimeMs('2024-09-29 13:30:00')
      });
      
      // 2. Call seekTickTime(10:15 AM ms)
      const targetTimeMs = parseAppTimeMs('2024-09-29 14:15:00');
      usePlaybackStore.getState().seekTickTime(targetTimeMs);
      
      // 3. Check that currentTime was updated in store
      expect(usePlaybackStore.getState().currentTime).toBe(targetTimeMs);
      
      // Now that seekTickTime sets isPaused: true, the subscriber MUST fire
      expect(subscriberCallCount).toBe(1);
      expect(lastTime).toBe(targetTimeMs);
      
      unsubscribe();
    });
  });

  describe('bar filtering on seek', () => {
    // Shared setup
    const durationSec = 300; // 5 min
    const bars: RawBar[] = [
      makeBar('2024-09-29 13:30:00', 100), // 9:30 AM
      makeBar('2024-09-29 13:35:00', 101),
      makeBar('2024-09-29 13:40:00', 102),
      makeBar('2024-09-29 13:45:00', 103),
      makeBar('2024-09-29 13:50:00', 104),
      makeBar('2024-09-29 13:55:00', 105),
      makeBar('2024-09-29 14:00:00', 106), // 10:00 AM
      makeBar('2024-09-29 14:05:00', 107),
      makeBar('2024-09-29 14:10:00', 108),
      makeBar('2024-09-29 14:15:00', 109),
      makeBar('2024-09-29 14:20:00', 110), // 10:20 AM
    ];

    it('Bug 3: Chart data bar count after seeking', () => {
      // 1. Create mock 5m bars: 9:30 to 10:20 (done above)
      // 2. Set effectiveCutoff to 10:15 AM ET = 14:15:00 UTC
      const effectiveCutoffMs = parseAppTimeMs('2024-09-29 14:15:00');
      
      // 3. Simulate the filtering logic from useChartData:
      const currentBucketStartMs = Math.floor(effectiveCutoffMs / (durationSec * 1000)) * (durationSec * 1000);
      const filteredTimestamps = bars.map(d => parseAppTimeMs(d.time));
      const filtered = bars.filter((_, i) => filteredTimestamps[i] < currentBucketStartMs);
      
      // 4. Assert filtered.length === 9 (bars from 9:30 to 10:10 in ET, which is 13:30 to 14:10 in UTC)
      expect(filtered.length).toBe(9);
    });

    it('Bug 4: Seeking backward preserves historical candles', () => {
      // 1. Same mock bars
      // 2. effectiveCutoff = 9:45 AM ET = 13:45 UTC
      const effectiveCutoffMs = parseAppTimeMs('2024-09-29 13:45:00');
      
      // 3. Apply the same filter logic
      const currentBucketStartMs = Math.floor(effectiveCutoffMs / (durationSec * 1000)) * (durationSec * 1000);
      const filteredTimestamps = bars.map(d => parseAppTimeMs(d.time));
      const filtered = bars.filter((_, i) => filteredTimestamps[i] < currentBucketStartMs);
      
      // 4. Assert filtered.length === 3 (bars at 9:30, 9:35, 9:40)
      expect(filtered.length).toBe(3);
    });

    it('Bug 6: defaultCutoff at 9:30 excludes first bar in replay mode', () => {
      // 1. effectiveCutoff = 9:30 AM ET = 13:30 UTC
      const effectiveCutoffMs = parseAppTimeMs('2024-09-29 13:30:00');
      
      // 2. durationSec = 300
      // 3. currentBucketStartMs = floor(13:30_UTC_ms / 300000) * 300000
      const currentBucketStartMs = Math.floor(effectiveCutoffMs / (durationSec * 1000)) * (durationSec * 1000);
      
      // 4. For a bar at 13:30 UTC: check if 13:30 < currentBucketStartMs
      const filteredTimestamps = bars.map(d => parseAppTimeMs(d.time));
      const filtered = bars.filter((_, i) => filteredTimestamps[i] < currentBucketStartMs);
      
      // 5. Assert this reveals the bug: zero bars pass the filter when effectiveCutoff = 9:30 AM
      expect(filtered.length).toBe(0);
    });
  });
});
