import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('Real-Time Tick Playback Timing Engine', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      bufferedTicks: [],
      ticksBySymbol: {},
      latestTickBySymbol: {},
      currentTickIndex: 0,
      currentTick: null,
      currentTime: null,
      isPaused: true,
      playbackSpeed: 1,
      totalTicks: 0,
    });
  });

  const baseMs = new Date('2026-09-25T13:30:00.000Z').getTime();

  // Create 17 ticks within 1 second (0 to 800ms) for AAPL, plus 1 tick 5 seconds later
  const clusteredTicks: MarketTick[] = [
    ...Array.from({ length: 17 }).map((_, i) => ({
      time: new Date(baseMs + i * 50).toISOString().replace('T', ' ').slice(0, 23),
      price: 150 + i * 0.1,
      volume: 100,
      symbol: 'AAPL',
      session: 'REG' as const,
      source: 'STREAMING' as const,
    })),
    {
      time: new Date(baseMs + 5000).toISOString().replace('T', ' ').slice(0, 23),
      price: 152.0,
      volume: 500,
      symbol: 'AAPL',
      session: 'REG' as const,
      source: 'STREAMING' as const,
    },
  ];

  it('should consume all 17 ticks within 1 market second when simulation time advances by 1000ms', () => {
    const store = usePlaybackStore.getState();
    store.setBufferedTicks(clusteredTicks);
    store.seekTickTime(baseMs);

    expect(usePlaybackStore.getState().currentTickIndex).toBe(0);

    // Advance simulation time by 500ms (half a second)
    // Ticks are at 0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500 (index 0 to 10 = 11 ticks)
    usePlaybackStore.getState().advanceSimulationTime(baseMs + 500);

    const stateAt500ms = usePlaybackStore.getState();
    expect(stateAt500ms.currentTime).toBe(baseMs + 500);
    expect(stateAt500ms.currentTickIndex).toBe(10);
    expect(stateAt500ms.currentTick?.price).toBeCloseTo(151.0);

    // Advance simulation time to 1000ms (1 full second)
    // All 17 ticks occurred before 850ms, so all 17 ticks (indices 0..16) must be consumed
    usePlaybackStore.getState().advanceSimulationTime(baseMs + 1000);

    const stateAt1s = usePlaybackStore.getState();
    expect(stateAt1s.currentTime).toBe(baseMs + 1000);
    expect(stateAt1s.currentTickIndex).toBe(16);
    expect(stateAt1s.currentTick?.price).toBeCloseTo(151.6);
    // The 18th tick (at +5000ms) must NOT have been consumed yet
    expect(stateAt1s.currentTickIndex).not.toBe(17);
  });

  it('should smoothly advance currentTime across quiet market periods without skipping to the next tick prematurely', () => {
    const store = usePlaybackStore.getState();
    store.setBufferedTicks(clusteredTicks);
    store.seekTickTime(baseMs + 1000);

    // At 1000ms, tick index is 16 (last tick of the burst). The next tick is at 5000ms.
    // Advance to 3000ms (during the quiet period with no trades)
    usePlaybackStore.getState().advanceSimulationTime(baseMs + 3000);

    const stateAt3s = usePlaybackStore.getState();
    // Clock must accurately reflect 3000ms
    expect(stateAt3s.currentTime).toBe(baseMs + 3000);
    // Tick index must stay at 16 (no new trades occurred)
    expect(stateAt3s.currentTickIndex).toBe(16);

    // Advance to 5000ms
    usePlaybackStore.getState().advanceSimulationTime(baseMs + 5000);
    const stateAt5s = usePlaybackStore.getState();
    expect(stateAt5s.currentTime).toBe(baseMs + 5000);
    expect(stateAt5s.currentTickIndex).toBe(17);
    expect(stateAt5s.currentTick?.price).toBe(152.0);
  });

  it('should synchronize multiple interleaved tickers proportionally to real-time market offsets', () => {
    // 5 AAPL ticks and 5 AMD ticks interleaved in the first 500ms
    const multiTicks: MarketTick[] = [
      { time: new Date(baseMs + 100).toISOString().replace('T', ' ').slice(0, 23), price: 150.1, volume: 10, symbol: 'AAPL', session: 'REG', source: 'STREAMING' },
      { time: new Date(baseMs + 150).toISOString().replace('T', ' ').slice(0, 23), price: 80.1, volume: 20, symbol: 'AMD', session: 'REG', source: 'STREAMING' },
      { time: new Date(baseMs + 200).toISOString().replace('T', ' ').slice(0, 23), price: 150.2, volume: 10, symbol: 'AAPL', session: 'REG', source: 'STREAMING' },
      { time: new Date(baseMs + 300).toISOString().replace('T', ' ').slice(0, 23), price: 80.2, volume: 20, symbol: 'AMD', session: 'REG', source: 'STREAMING' },
      { time: new Date(baseMs + 400).toISOString().replace('T', ' ').slice(0, 23), price: 150.3, volume: 10, symbol: 'AAPL', session: 'REG', source: 'STREAMING' },
    ];

    const store = usePlaybackStore.getState();
    store.setBufferedTicks(multiTicks);
    store.seekTickTime(baseMs);

    // At 180ms: AAPL should be at 150.1 (from 100ms), AMD should be at 80.1 (from 150ms)
    usePlaybackStore.getState().advanceSimulationTime(baseMs + 180);

    const state = usePlaybackStore.getState();
    expect(state.latestTickBySymbol['AAPL']?.price).toBe(150.1);
    expect(state.latestTickBySymbol['AMD']?.price).toBe(80.1);

    // At 350ms: AAPL is at 150.2 (from 200ms), AMD is at 80.2 (from 300ms)
    usePlaybackStore.getState().advanceSimulationTime(baseMs + 350);

    const state2 = usePlaybackStore.getState();
    expect(state2.latestTickBySymbol['AAPL']?.price).toBe(150.2);
    expect(state2.latestTickBySymbol['AMD']?.price).toBe(80.2);
  });

  it('should smoothly advance simulation time before the first tick without stalling or emitting premature ticks', () => {
    const store = usePlaybackStore.getState();
    store.setBufferedTicks(clusteredTicks); // first tick is at baseMs (13:30:00)

    // Pre-market time 10 minutes earlier (13:20:00)
    const preMarketMs = baseMs - 10 * 60 * 1000;
    store.setCurrentTime(preMarketMs);

    // Advance 5 seconds into pre-market
    usePlaybackStore.getState().advanceSimulationTime(preMarketMs + 5000);
    const state = usePlaybackStore.getState();
    expect(state.currentTime).toBe(preMarketMs + 5000);
    expect(state.currentTickIndex).toBe(0);

    // Now advance right past the first tick (+200ms after market open)
    usePlaybackStore.getState().advanceSimulationTime(baseMs + 200);
    const stateOpen = usePlaybackStore.getState();
    expect(stateOpen.currentTime).toBe(baseMs + 200);
    // Ticks at 0, 50, 100, 150, 200 are consumed (indices 0..4)
    expect(stateOpen.currentTickIndex).toBe(4);
    expect(stateOpen.latestTickBySymbol['AAPL']).toBeDefined();
  });
});
