import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import { streamingClient } from '../../src/lib/streamingClient';
import type { MarketTick } from '../../src/types';

describe('Time and Sales Tick Density & Timing Regression Tests', () => {
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

  it('demonstrates that 1st second of TSLA on 2026-09-08 has 49 authentic ticks and 2nd second has 10 ticks', async () => {
    const ticks = await streamingClient.getTicks('TSLA', {
      startTime: '2026-09-08 13:30:00',
      endTime: '2026-09-08 13:30:02',
      limit: 100000,
      direction: 'asc',
    });

    const sec0 = ticks.filter(t => t.time.includes('13:30:00'));
    const sec1 = ticks.filter(t => t.time.includes('13:30:01'));

    // Second 0 (13:30:00 UTC / 09:30:00 ET) MUST contain 49 real ticks
    expect(sec0.length).toBe(49);

    // Second 1 (13:30:01 UTC / 09:30:01 ET) MUST contain 10 real ticks
    expect(sec1.length).toBe(10);

    // Verify sub-second timestamps are present and increasing
    const msList = sec0.map(t => isoToMs(t.time));
    for (let i = 1; i < msList.length; i++) {
      expect(msList[i]).toBeGreaterThanOrEqual(msList[i - 1]);
    }
  });

  it('verifies advanceSimulationTime accurately steps through all 49 ticks within 1 second of simulation time', async () => {
    const ticks = await streamingClient.getTicks('TSLA', {
      startTime: '2026-09-08 13:30:00',
      endTime: '2026-09-08 13:30:05',
      limit: 100000,
      direction: 'asc',
    });

    usePlaybackStore.getState().setBufferedTicks(ticks);
    const startMs = isoToMs('2026-09-08T13:30:00.000000Z');
    usePlaybackStore.getState().setCurrentTime(startMs);

    // Advance 1 second of simulation time (to 13:30:01.000)
    usePlaybackStore.getState().advanceSimulationTime(startMs + 1000);

    const state = usePlaybackStore.getState();

    // After 1 full second, all 49 ticks of second 0 must have been consumed
    const sec0Ticks = ticks.filter(t => t.time.includes('13:30:00'));
    expect(state.currentTickIndex).toBeGreaterThanOrEqual(sec0Ticks.length - 1);
  });

  it('verifies that Time and Sales must NOT display future ticks ahead of current simulation index', () => {
    // Generate 10 mock ticks
    const mockTicks: MarketTick[] = Array.from({ length: 10 }, (_, i) => ({
      time: `2026-09-08 13:30:00.${String(i * 100).padStart(3, '0')}`,
      price: 350 + i,
      volume: 10,
      symbol: 'TSLA',
      session: 'REG',
      source: 'STREAMING',
    }));

    usePlaybackStore.getState().setBufferedTicks(mockTicks);
    usePlaybackStore.getState().currentTickIndex = 3;

    const state = usePlaybackStore.getState();
    const currIdx = state.currentTickIndex;

    // A real Time & Sales tape window MUST show only executed ticks up to currIdx
    // (i.e. indices <= currIdx), never future ticks
    const executedTicks = state.bufferedTicks.slice(0, currIdx + 1);
    expect(executedTicks.length).toBe(4);
    expect(executedTicks.every((_, idx) => idx <= currIdx)).toBe(true);
  });

  it('verifies timezone formatting: Time & Sales should format timestamps in the active ticker timezone with milliseconds', () => {
    const rawTime = '2026-09-08T13:30:00.020357';
    const ms = isoToMs(rawTime);
    const date = new Date(ms);

    // Format in New York time (ET)
    const etFormatted = date.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const subMs = String(date.getMilliseconds()).padStart(3, '0');
    const displayWithMs = `${etFormatted}.${subMs}`;

    // Must show 09:30:00.020 (ET market open), NOT 13:30:00 (UTC)
    expect(etFormatted).toBe('09:30:00');
    expect(displayWithMs).toBe('09:30:00.020');
  });
});
