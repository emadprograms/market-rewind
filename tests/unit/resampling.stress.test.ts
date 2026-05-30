import { describe, it, expect } from 'vitest';
import { resampleData } from '../../src/lib/resampling';
import type { RawBar } from '../../src/types';

describe('resampleData STRESS TESTS', () => {
  it('should handle missing data gaps without creating ghost candles', () => {
    const dataWithGaps: RawBar[] = [
      { time: '2023-01-01 09:30:00', open: 100, high: 105, low: 95, close: 102, volume: 1000, session: 'REG' },
      // Gap from 09:31 to 09:34
      { time: '2023-01-01 09:35:00', open: 106, high: 110, low: 104, close: 108, volume: 1000, session: 'REG' },
    ];
    
    const result = resampleData(dataWithGaps, '5min');
    
    // Should have 2 candles: one for 09:30 bucket, one for 09:35 bucket.
    expect(result.length).toBe(2);
    expect(result[0].time).toBe('2023-01-01 09:30:00');
    expect(result[1].time).toBe('2023-01-01 09:35:00');
  });

  it('should handle bucket transitions across midnight (UTC)', () => {
    const midnightData: RawBar[] = [
      { time: '2023-01-01 23:58:00', open: 100, high: 101, low: 99, close: 100, volume: 100, session: 'REG' },
      { time: '2023-01-01 23:59:00', open: 100, high: 102, low: 98, close: 101, volume: 100, session: 'REG' },
      { time: '2023-01-02 00:00:00', open: 101, high: 103, low: 100, close: 102, volume: 100, session: 'REG' },
    ];
    
    const result = resampleData(midnightData, '15min');
    
    // 23:58 and 23:59 belong to the 23:45 bucket
    // 00:00 belongs to the 00:00 bucket
    expect(result.length).toBe(2);
    expect(result[0].time).toBe('2023-01-01 23:45:00');
    expect(result[1].time).toBe('2023-01-02 00:00:00');
  });

  it('should handle extreme volatility (High/Low stress)', () => {
    const volatileData: RawBar[] = [
      { time: '2023-01-01 09:30:00', open: 100, high: 500, low: 10, close: 100, volume: 100, session: 'REG' },
      { time: '2023-01-01 09:31:00', open: 100, high: 1000, low: 1, close: 100, volume: 100, session: 'REG' },
    ];
    const result = resampleData(volatileData, '5min');
    expect(result[0].high).toBe(1000);
    expect(result[0].low).toBe(1);
  });
});
