import { describe, it, expect, beforeEach } from 'vitest';
import { streamingClient } from '../../src/lib/streamingClient';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';

describe('TEST-04: Genuine Tick Replay & Anti-Capping', () => {
  beforeEach(() => {
    usePlaybackStore.getState().reset();
  });

  it('should stream authentic market ticks from streaming.duckdb exceeding the legacy 4,200 cap', async () => {
    // September 4, 2026 had 27,082 ticks in streaming.duckdb for AAPL
    const ticks = await streamingClient.getTicks('AAPL', {
      startTime: '2026-09-04 13:20:00',
      endTime: '2026-09-04 20:00:00',
      limit: 10000,
    });

    expect(ticks.length).toBeGreaterThan(4200);
    expect(ticks[0]).toHaveProperty('price');
    expect(ticks[0]).toHaveProperty('volume');
    expect(ticks[0].symbol).toBe('AAPL');

    // Buffer into playback store
    usePlaybackStore.getState().setBufferedTicks(ticks);
    expect(usePlaybackStore.getState().totalTicks).toBeGreaterThan(4200);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(0);
  });

  it('should advance tick-by-tick without skipping when stepping', () => {
    const sampleTicks = [
      { time: '2026-09-25 13:30:00.100', price: 340.50, volume: 10, symbol: 'AAPL', session: 'REG' },
      { time: '2026-09-25 13:30:00.150', price: 340.52, volume: 5, symbol: 'AAPL', session: 'REG' },
      { time: '2026-09-25 13:30:00.200', price: 340.51, volume: 8, symbol: 'AAPL', session: 'REG' },
    ];

    usePlaybackStore.getState().setBufferedTicks(sampleTicks);
    expect(usePlaybackStore.getState().currentTickIndex).toBe(0);
    expect(usePlaybackStore.getState().currentTick?.price).toBe(340.50);

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTickIndex).toBe(1);
    expect(usePlaybackStore.getState().currentTick?.price).toBe(340.52);

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTickIndex).toBe(2);
    expect(usePlaybackStore.getState().currentTick?.price).toBe(340.51);

    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTickIndex).toBe(1);
    expect(usePlaybackStore.getState().currentTick?.price).toBe(340.52);
  });
});
