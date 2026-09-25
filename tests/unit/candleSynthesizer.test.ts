import { describe, it, expect } from 'vitest';
import { getBucketTimestamp, applyTickToCandles, buildCandlesFromTicks } from '../../src/lib/candleSynthesizer';
import type { MarketTick, RawBar } from '../../src/types';

describe('Candle Synthesizer Unit Tests', () => {
  it('should compute bucket timestamps correctly for sub-second and minute timeframes', () => {
    const timeStr = '2026-09-25 14:30:17.450';
    
    expect(getBucketTimestamp(timeStr, '1s')).toBe('2026-09-25 14:30:17');
    expect(getBucketTimestamp(timeStr, '5s')).toBe('2026-09-25 14:30:15');
    expect(getBucketTimestamp(timeStr, '15s')).toBe('2026-09-25 14:30:15');
    expect(getBucketTimestamp(timeStr, '30s')).toBe('2026-09-25 14:30:00');
    expect(getBucketTimestamp(timeStr, '1min')).toBe('2026-09-25 14:30:00');
    expect(getBucketTimestamp(timeStr, '5min')).toBe('2026-09-25 14:30:00');
  });

  it('should initialize the first candle from a tick', () => {
    const tick: MarketTick = {
      time: '2026-09-25 14:30:01.100',
      symbol: 'NVDA',
      price: 180.5,
      volume: 10,
    };

    const candles = applyTickToCandles([], tick, '5s');
    expect(candles).toHaveLength(1);
    expect(candles[0].open).toBe(180.5);
    expect(candles[0].high).toBe(180.5);
    expect(candles[0].low).toBe(180.5);
    expect(candles[0].close).toBe(180.5);
    expect(candles[0].volume).toBe(10);
    expect(candles[0].tickCount).toBe(1);
    expect(candles[0].time).toBe('2026-09-25 14:30:00');
  });

  it('should update current candle in real-time for ticks in the same bucket', () => {
    const tick1: MarketTick = { time: '2026-09-25 14:30:01.000', symbol: 'NVDA', price: 180.0, volume: 10 };
    const tick2: MarketTick = { time: '2026-09-25 14:30:02.000', symbol: 'NVDA', price: 182.5, volume: 5 };
    const tick3: MarketTick = { time: '2026-09-25 14:30:03.000', symbol: 'NVDA', price: 179.5, volume: 8 };

    let candles: RawBar[] = [];
    candles = applyTickToCandles(candles, tick1, '5s');
    candles = applyTickToCandles(candles, tick2, '5s');
    candles = applyTickToCandles(candles, tick3, '5s');

    expect(candles).toHaveLength(1);
    expect(candles[0].open).toBe(180.0);
    expect(candles[0].high).toBe(182.5);
    expect(candles[0].low).toBe(179.5);
    expect(candles[0].close).toBe(179.5);
    expect(candles[0].volume).toBe(23);
    expect(candles[0].tickCount).toBe(3);
  });

  it('should roll over into a new candle when the bucket advances', () => {
    const tick1: MarketTick = { time: '2026-09-25 14:30:04.000', symbol: 'NVDA', price: 180.0, volume: 10 };
    const tick2: MarketTick = { time: '2026-09-25 14:30:06.000', symbol: 'NVDA', price: 181.0, volume: 15 };

    let candles: RawBar[] = [];
    candles = applyTickToCandles(candles, tick1, '5s'); // bucket 14:30:00
    candles = applyTickToCandles(candles, tick2, '5s'); // bucket 14:30:05

    expect(candles).toHaveLength(2);
    expect(candles[0].close).toBe(180.0);
    expect(candles[1].open).toBe(181.0);
    expect(candles[1].time).toBe('2026-09-25 14:30:05');
  });

  it('should bulk build candles accurately from tick arrays', () => {
    const ticks: MarketTick[] = [
      { time: '2026-09-25 10:00:00.000', symbol: 'QQQ', price: 500.0, volume: 1 },
      { time: '2026-09-25 10:00:00.500', symbol: 'QQQ', price: 501.0, volume: 2 },
      { time: '2026-09-25 10:00:01.200', symbol: 'QQQ', price: 499.5, volume: 3 },
      { time: '2026-09-25 10:00:01.800', symbol: 'QQQ', price: 500.5, volume: 4 },
    ];

    const candles1s = buildCandlesFromTicks(ticks, '1s');
    expect(candles1s).toHaveLength(2);
    expect(candles1s[0].time).toBe('2026-09-25 10:00:00');
    expect(candles1s[0].open).toBe(500.0);
    expect(candles1s[0].high).toBe(501.0);
    expect(candles1s[0].low).toBe(500.0);
    expect(candles1s[0].close).toBe(501.0);
    expect(candles1s[0].volume).toBe(3);

    expect(candles1s[1].time).toBe('2026-09-25 10:00:01');
    expect(candles1s[1].open).toBe(499.5);
    expect(candles1s[1].high).toBe(500.5);
    expect(candles1s[1].low).toBe(499.5);
    expect(candles1s[1].close).toBe(500.5);
    expect(candles1s[1].volume).toBe(7);
  });
});
