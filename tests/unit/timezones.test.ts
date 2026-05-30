import { describe, it, expect } from 'vitest';
import { getTzForTicker } from '../../src/lib/timezones';

describe('getTzForTicker', () => {
  it('should return UTC for crypto tickers', () => {
    expect(getTzForTicker('BTC')).toBe('UTC');
    expect(getTzForTicker('ETH')).toBe('UTC');
    expect(getTzForTicker('SOL')).toBe('UTC');
  });

  it('should return UTC for pair tickers (containing /)', () => {
    expect(getTzForTicker('EUR/USD')).toBe('UTC');
    expect(getTzForTicker('BTC/USDT')).toBe('UTC');
  });

  it('should return UTC for index tickers (starting with ^)', () => {
    expect(getTzForTicker('^GSPC')).toBe('UTC');
  });

  it('should return America/New_York for standard US stocks', () => {
    expect(getTzForTicker('AAPL')).toBe('America/New_York');
    expect(getTzForTicker('TSLA')).toBe('America/New_York');
    expect(getTzForTicker('MSFT')).toBe('America/New_York');
  });

  it('should return UTC for empty ticker', () => {
    expect(getTzForTicker('')).toBe('UTC');
  });
});
