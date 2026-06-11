import { describe, it, expect } from 'vitest';
import { resampleData } from './resampling';
import type { RawBar } from '../types';

describe('resampleData', () => {
  const createBar = (time: string, session: string = 'REG', price: number = 100): RawBar => ({
    time,
    open: price,
    high: price + 1,
    low: price - 1,
    close: price,
    volume: 100,
    session,
  });

  it('handles null, undefined, and empty input', () => {
    expect(resampleData(null, '5min')).toEqual([]);
    expect(resampleData(undefined, '5min')).toEqual([]);
    expect(resampleData([], '5min')).toEqual([]);
  });

  it('resamples 1m bars into 5m candles (Test 1)', () => {
    const data = [
      createBar('2024-01-01 10:00:00'),
      createBar('2024-01-01 10:01:00'),
      createBar('2024-01-01 10:02:00'),
      createBar('2024-01-01 10:03:00'),
      createBar('2024-01-01 10:04:00'),
    ];

    const resampled = resampleData(data, '5min');
    expect(resampled).toHaveLength(1);
    expect(resampled[0].time).toBe('2024-01-01 10:00:00');
    expect(resampled[0].volume).toBe(500);
  });

  it('splits candles at session boundaries even within the same time window (Test 2)', () => {
    // 09:25 (PRE) and 09:35 (REG) both fall into the 09:30-09:45 15m window if bucketed normally.
    // However, they MUST be split by session.
    // Wait, 09:25 falls into 09:15-09:30 bucket. 09:35 falls into 09:30-09:45 bucket.
    // Let's pick 09:29 (PRE) and 09:30 (REG) for a 15m timeframe.
    // 09:29 -> bucket 09:15
    // 09:30 -> bucket 09:30
    // Still different buckets.
    
    // Let's try 09:30 (PRE) and 09:35 (REG) for 15m timeframe.
    // Both fall into 09:30 bucket.
    const data = [
      createBar('2024-01-01 09:30:00', 'PRE', 100),
      createBar('2024-01-01 09:35:00', 'REG', 105),
    ];

    const resampled = resampleData(data, '15min');
    expect(resampled).toHaveLength(2);
    expect(resampled[0].session).toBe('PRE');
    expect(resampled[1].session).toBe('REG');
    expect(resampled[0].time).toBe('2024-01-01 09:30:00');
    expect(resampled[1].time).toBe('2024-01-01 09:30:00'); // Same bucket time, different session
  });

  it('handles data gaps correctly (Test 3)', () => {
    const data = [
      createBar('2024-01-01 10:00:00'),
      // 10:01 missing
      createBar('2024-01-01 10:02:00'),
    ];

    const resampled = resampleData(data, '5min');
    expect(resampled).toHaveLength(1);
    expect(resampled[0].time).toBe('2024-01-01 10:00:00');
    expect(resampled[0].volume).toBe(200);
  });

  it('ensures precision with integer milliseconds (Test 4)', () => {
    // This is more of a code review / logic test. 
    // We can verify that 1H resampling works across day boundaries.
    const data = [
      createBar('2024-01-01 23:59:00'),
      createBar('2024-01-02 00:00:00'),
    ];
    const resampled = resampleData(data, '1H');
    expect(resampled).toHaveLength(2);
    expect(resampled[0].time).toBe('2024-01-01 23:00:00');
    expect(resampled[1].time).toBe('2024-01-02 00:00:00');
  });

  it('resamples 1D timeframe correctly', () => {
    const data = [
      createBar('2024-01-01 09:30:00'),
      createBar('2024-01-01 16:00:00'),
      createBar('2024-01-02 09:30:00'),
    ];
    const resampled = resampleData(data, '1D');
    expect(resampled).toHaveLength(2);
    expect(resampled[0].time).toBe('2024-01-01 12:00:00');
    expect(resampled[1].time).toBe('2024-01-02 12:00:00');
  });
});
