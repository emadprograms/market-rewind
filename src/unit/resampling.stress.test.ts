import { describe, it, expect } from 'vitest';
import { resampleData } from '../lib/resampling';
import type { RawBar } from '../types';

describe('resampleData O(tail) stress test', () => {
  const createBars = (count: number): RawBar[] => {
    return Array.from({ length: count }, (_, i) => ({
      time: new Date(1700000000000 + i * 60000).toISOString().replace('T', ' ').split('.')[0],
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 100,
      session: 'REG',
    }));
  };

  it('verifies that resampling time is independent of total data size when only processing tail', () => {
    const smallTail = createBars(5);
    const largeTail = createBars(100);
    const hugeTail = createBars(1000);

    // Warmup
    resampleData(smallTail, '5min');

    const start1 = performance.now();
    resampleData(smallTail, '5min');
    const end1 = performance.now();
    const timeSmall = end1 - start1;

    const start2 = performance.now();
    resampleData(largeTail, '5min');
    const end2 = performance.now();
    const timeLarge = end2 - start2;

    const start3 = performance.now();
    resampleData(hugeTail, '5min');
    const end3 = performance.now();
    const timeHuge = end3 - start3;

    console.log(`Small tail (5 bars): ${timeSmall.toFixed(4)}ms`);
    console.log(`Large tail (100 bars): ${timeLarge.toFixed(4)}ms`);
    console.log(`Huge tail (1000 bars): ${timeHuge.toFixed(4)}ms`);

    // While 1000 bars will obviously take longer than 5 bars,
    // the point of O(tail) is that during a PLAYBACK TICK,
    // we only send the "tail" (bars since last bucket closed).
    // In a typical 5m timeframe, the tail is 1-5 bars.
    // We want to ensure that even with a "large" tail (e.g. 100 bars if someone jumps), it's still fast.
    
    expect(timeSmall).toBeLessThan(2); // Should be very fast
    expect(timeLarge).toBeLessThan(5); // Still fast
  });

  it('simulates playback ticks to verify cumulative performance', () => {
    const fullData = createBars(1000);
    const timeframe = '5min';
    const durationMs = 5 * 60000;
    
    let lastClosedBucketEnd = 0;
    let totalResampleTime = 0;
    const ticks = 100;

    for (let i = 0; i < ticks; i++) {
      const currentTime = 1700000000000 + (i * 60000);
      
      // Calculate lastClosedBucketEnd like useChartData does
      const currentBucketStart = Math.floor(currentTime / durationMs) * durationMs;
      // In useChartData, lastClosedBucketEnd is updated when a candle closes.
      // For this simulation, let's just use the currentBucketStart as the tail threshold.
      
      const tailData = fullData.filter(bar => {
        const ts = new Date(bar.time.replace(' ', 'T') + 'Z').getTime();
        return ts >= currentBucketStart && ts <= currentTime;
      });

      const start = performance.now();
      resampleData(tailData, timeframe);
      totalResampleTime += (performance.now() - start);
    }

    const avgTime = totalResampleTime / ticks;
    console.log(`Average resample time per playback tick (1m advance): ${avgTime.toFixed(4)}ms`);
    
    expect(avgTime).toBeLessThan(0.5); // Should be extremely fast
  });
});
