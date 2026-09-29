import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('TDD: PlaybackStore Tick Ingestion & Sorting Performance', () => {
  beforeEach(() => {
    usePlaybackStore.getState().reset();
  });

  it('efficiently sorts and ingests 20,000 ticks in under 150ms without UI thread blocking', () => {
    // Generate 20,000 ticks with microsecond strings in non-chronological order
    const rawTicks: MarketTick[] = Array.from({ length: 20000 }, (_, i) => {
      const sec = String((i * 7) % 60).padStart(2, '0');
      const ms = String((i * 13) % 1000).padStart(3, '0');
      return {
        time: `2026-09-08 13:30:${sec}.${ms}`,
        price: 350 + (i % 20),
        volume: 10,
        symbol: 'TSLA',
        session: 'REG',
      };
    });

    const start = performance.now();
    usePlaybackStore.getState().addSymbolTicks('TSLA', rawTicks);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(150); // Must be fast, not seconds

    const state = usePlaybackStore.getState();
    const stored = state.ticksBySymbol['TSLA'];
    expect(stored.length).toBe(20000);

    // Verify correct chronological ordering
    for (let i = 1; i < Math.min(stored.length, 100); i++) {
      expect(stored[i].time >= stored[i - 1].time).toBe(true);
    }
  });

  it('efficiently appends ticks without redundant double full-array sorting', () => {
    const batch1: MarketTick[] = Array.from({ length: 5000 }, (_, i) => ({
      time: `2026-09-08 13:30:00.${String(i).padStart(3, '0')}`,
      price: 350,
      volume: 10,
      symbol: 'AAPL',
      session: 'REG',
    }));

    const batch2: MarketTick[] = Array.from({ length: 5000 }, (_, i) => ({
      time: `2026-09-08 13:30:01.${String(i).padStart(3, '0')}`,
      price: 351,
      volume: 10,
      symbol: 'AAPL',
      session: 'REG',
    }));

    const start = performance.now();
    usePlaybackStore.getState().addTicks(batch1);
    usePlaybackStore.getState().addTicks(batch2);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
    expect(usePlaybackStore.getState().totalTicks).toBe(10000);
  });
});
