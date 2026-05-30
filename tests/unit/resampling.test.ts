import { describe, it, expect } from 'vitest';
import { resampleData } from '../../src/lib/resampling';
import type { RawBar } from '../../src/types';

describe('resampleData', () => {
  const mockData: RawBar[] = [
    { time: '2023-01-01 09:30:00', open: 100, high: 105, low: 95, close: 102, volume: 1000, session: 'REG' },
    { time: '2023-01-01 09:31:00', open: 102, high: 103, low: 101, close: 101.5, volume: 500, session: 'REG' },
    { time: '2023-01-01 09:32:00', open: 101.5, high: 104, low: 100, close: 103, volume: 800, session: 'REG' },
    { time: '2023-01-01 09:33:00', open: 103, high: 106, low: 102, close: 105, volume: 1200, session: 'REG' },
    { time: '2023-01-01 09:34:00', open: 105, high: 107, low: 104, close: 106, volume: 600, session: 'REG' },
  ];

  it('should return 1-min data unchanged', () => {
    const result = resampleData(mockData, '1min');
    expect(result).toEqual(mockData);
  });

  it('should aggregate 1-min data into 5-min candles', () => {
    const result = resampleData(mockData, '5min');
    expect(result.length).toBe(1);
    expect(result[0].open).toBe(100);
    expect(result[0].high).toBe(107);
    expect(result[0].low).toBe(95);
    expect(result[0].close).toBe(106);
    expect(result[0].volume).toBe(4100);
    expect(result[0].time).toBe('2023-01-01 09:30:00');
  });

  it('should handle multiple 5-min buckets', () => {
    const extendedData = [
      ...mockData,
      { time: '2023-01-01 09:35:00', open: 106, high: 108, low: 105, close: 107, volume: 1000, session: 'REG' },
    ];
    const result = resampleData(extendedData, '5min');
    expect(result.length).toBe(2);
    expect(result[1].time).toBe('2023-01-01 09:35:00');
    expect(result[1].open).toBe(106);
    expect(result[1].close).toBe(107);
  });

  it('should handle daily resampling', () => {
    const result = resampleData(mockData, '1D');
    expect(result.length).toBe(1);
    expect(result[0].time).toBe('2023-01-01 12:00:00');
  });

  it('should return empty array for empty input', () => {
    expect(resampleData([], '5min')).toEqual([]);
  });
});
