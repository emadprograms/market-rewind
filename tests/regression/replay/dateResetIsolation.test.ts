import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { streamingClient } from '../../../src/lib/streamingClient';
import { usePlaybackStore, isoToMs } from '../../../src/store/usePlaybackStore';

describe('TEST-01: Date Reset Temporal Isolation & Boundary Integrity', () => {
  let fetchSpy: any;

  beforeEach(() => {
    usePlaybackStore.getState().reset();
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('start_time=2026-09-07')) {
        return { ok: true, json: async () => ({ ticks: [], count: 0 }) } as any;
      }
      if (urlStr.includes('start_time=2026-09-04')) {
        const mockTicks = [
          { time: '2026-09-04 13:20:00.000', price: 224.5, volume: 100, symbol: 'AAPL', session: 'REG' },
          { time: '2026-09-04 13:25:00.000', price: 224.8, volume: 150, symbol: 'AAPL', session: 'REG' },
          { time: '2026-09-04 14:00:00.000', price: 225.0, volume: 200, symbol: 'AAPL', session: 'REG' },
        ];
        return { ok: true, json: async () => ({ ticks: mockTicks, count: mockTicks.length }) } as any;
      }
      return { ok: true, json: async () => ({ ticks: [], count: 0 }) } as any;
    });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('should NEVER return future ticks when querying a holiday or day with no ticks (e.g. Sept 7, 2026)', async () => {
    // September 7, 2026 is US Labor Day - zero ticks in database
    const ticks = await streamingClient.getTicks('AAPL', {
      startTime: '2026-09-07 13:20:00',
      endTime: '2026-09-07 23:59:59',
      limit: 10000,
    });

    // Must be empty or only within Sept 7; MUST NOT contain Sept 24/25 ticks!
    for (const t of ticks) {
      expect(t.time.startsWith('2026-09-07')).toBe(true);
      expect(t.time.includes('2026-09-24')).toBe(false);
      expect(t.time.includes('2026-09-25')).toBe(false);
    }
  });

  it('should strictly bound ticks to the requested date on valid trading days (Sept 4, 2026)', async () => {
    const ticks = await streamingClient.getTicks('AAPL', {
      startTime: '2026-09-04 13:20:00',
      endTime: '2026-09-04 20:00:00',
      limit: 50,
    });

    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.time.startsWith('2026-09-04')).toBe(true);
      const ms = isoToMs(t.time);
      expect(ms).toBeGreaterThanOrEqual(isoToMs('2026-09-04 13:20:00'));
      expect(ms).toBeLessThanOrEqual(isoToMs('2026-09-04 20:00:00'));
    }
  });

  it('should not mutate playback cursor to a future date when buffering empty or sparse day', () => {
    const targetMs = isoToMs('2026-09-07 13:20:00');
    usePlaybackStore.getState().setCurrentTime(targetMs);
    usePlaybackStore.getState().seekTickTime(targetMs);

    expect(usePlaybackStore.getState().currentTime).toBe(targetMs);

    // If an empty tick array is buffered, currentTime must remain on the selected date
    usePlaybackStore.getState().setBufferedTicks([]);
    expect(usePlaybackStore.getState().currentTime).toBe(targetMs);
  });
});
