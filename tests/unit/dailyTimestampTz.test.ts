import { describe, it, expect } from 'vitest';
import { isRthBar } from '../../src/lib/timezones';
import type { RawBar } from '../../src/types';

describe('TDD: Daily Timestamp & UTC Offset Recognition in isRthBar', () => {
  it('correctly identifies daily bars serialized as UTC 04:00:00 (EDT midnight) with composite sessions', () => {
    // DuckDB daily bars for EDT dates (UTC-4) serialize to 04:00:00 UTC
    const barUtc4: RawBar = {
      time: '2026-09-25 04:00:00',
      open: 350.0,
      high: 355.0,
      low: 348.0,
      close: 352.0,
      volume: 12000000,
      session: 'PRE, POST, REG',
    };

    expect(isRthBar(barUtc4, 'TSLA', '1D')).toBe(true);
    expect(isRthBar(barUtc4, 'TSLA')).toBe(true);
  });

  it('correctly identifies daily bars serialized as UTC 05:00:00 (EST midnight) with composite sessions', () => {
    // DuckDB daily bars for EST dates (UTC-5) serialize to 05:00:00 UTC
    const barUtc5: RawBar = {
      time: '2026-01-15 05:00:00',
      open: 220.0,
      high: 225.0,
      low: 218.0,
      close: 222.0,
      volume: 8000000,
      session: 'POST, PRE, REG',
    };

    expect(isRthBar(barUtc5, 'AAPL', '1D')).toBe(true);
    expect(isRthBar(barUtc5, 'AAPL')).toBe(true);
  });

  it('correctly identifies daily bars with explicit timeframe 1D regardless of session string order', () => {
    const bar: RawBar = {
      time: '2026-09-08 04:00:00',
      open: 360.0,
      high: 365.0,
      low: 358.0,
      close: 362.0,
      volume: 5000000,
      session: 'ETH, REG',
    };

    expect(isRthBar(bar, 'TSLA', '1D')).toBe(true);
  });

  it('still rejects pure PRE, POST, or ETH daily bars even with UTC midnight timestamps', () => {
    const purePreBar: RawBar = {
      time: '2026-09-08 04:00:00',
      open: 360.0,
      high: 365.0,
      low: 358.0,
      close: 362.0,
      volume: 5000,
      session: 'PRE',
    };

    expect(isRthBar(purePreBar, 'TSLA', '1D')).toBe(false);
    expect(isRthBar(purePreBar, 'TSLA')).toBe(false);
  });
});
