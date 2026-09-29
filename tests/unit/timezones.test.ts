import { describe, it, expect } from 'vitest';
import { getTzForTicker, getTzLabel, getUtcTimeFromEt, getSessionType, isRthBar } from '../../src/lib/timezones';

describe('timezones utility tests', () => {
  describe('getTzForTicker', () => {
    it('should return UTC for crypto tickers', () => {
      expect(getTzForTicker('BTC')).toBe('UTC');
      expect(getTzForTicker('ETH')).toBe('UTC');
      expect(getTzForTicker('SOL')).toBe('UTC');
      expect(getTzForTicker('DOGE')).toBe('UTC');
    });

    it('should return UTC for pair tickers (containing /)', () => {
      expect(getTzForTicker('EUR/USD')).toBe('UTC');
      expect(getTzForTicker('BTC/USDT')).toBe('UTC');
    });

    it('should return UTC for index tickers (starting with ^)', () => {
      expect(getTzForTicker('^GSPC')).toBe('UTC');
      expect(getTzForTicker('^NDX')).toBe('UTC');
    });

    it('should return America/New_York for standard US stocks and ETFs', () => {
      expect(getTzForTicker('AAPL')).toBe('America/New_York');
      expect(getTzForTicker('TSLA')).toBe('America/New_York');
      expect(getTzForTicker('MSFT')).toBe('America/New_York');
      expect(getTzForTicker('SPY')).toBe('America/New_York');
      expect(getTzForTicker('QQQ')).toBe('America/New_York');
    });

    it('should return UTC for empty ticker', () => {
      expect(getTzForTicker('')).toBe('UTC');
    });
  });

  describe('getTzLabel', () => {
    it('returns ET for America/New_York and UTC for other zones', () => {
      expect(getTzLabel('America/New_York')).toBe('ET');
      expect(getTzLabel('UTC')).toBe('UTC');
      expect(getTzLabel('Europe/London')).toBe('UTC');
    });
  });

  describe('getUtcTimeFromEt', () => {
    it('converts ET to UTC during EDT (Summer, UTC-4)', () => {
      // July 15, 2024 at 09:30 ET -> 13:30 UTC
      const utcTime = getUtcTimeFromEt('2024-07-15', '09:30');
      expect(utcTime).toBe('2024-07-15 13:30:00');
    });

    it('converts ET to UTC during EST (Winter, UTC-5)', () => {
      // January 15, 2024 at 09:30 ET -> 14:30 UTC
      const utcTime = getUtcTimeFromEt('2024-01-15', '09:30');
      expect(utcTime).toBe('2024-01-15 14:30:00');
    });
  });

  describe('getSessionType', () => {
    it('returns RTH for UTC tickers (24/7 crypto markets)', () => {
      // Midnight, midday, any time
      const timeSec = Math.floor(new Date('2024-07-15T02:00:00Z').getTime() / 1000);
      expect(getSessionType(timeSec, 'BTC')).toBe('RTH');
      expect(getSessionType(timeSec, 'ETH')).toBe('RTH');
    });

    it('classifies US stock session types accurately in EDT (Summer)', () => {
      // July 15, 2024 EDT (UTC-4)
      // 04:00 ET = 08:00 UTC -> PRE (240 min)
      const tPre = Math.floor(new Date('2024-07-15T08:05:00Z').getTime() / 1000);
      expect(getSessionType(tPre, 'AAPL')).toBe('PRE');

      // 09:30 ET = 13:30 UTC -> RTH (570 min)
      const tOpen = Math.floor(new Date('2024-07-15T13:30:00Z').getTime() / 1000);
      expect(getSessionType(tOpen, 'AAPL')).toBe('RTH');

      // 12:00 ET = 16:00 UTC -> RTH
      const tMid = Math.floor(new Date('2024-07-15T16:00:00Z').getTime() / 1000);
      expect(getSessionType(tMid, 'AAPL')).toBe('RTH');

      // 16:05 ET = 20:05 UTC -> POST (965 min)
      const tPost = Math.floor(new Date('2024-07-15T20:05:00Z').getTime() / 1000);
      expect(getSessionType(tPost, 'AAPL')).toBe('POST');

      // 21:00 ET = 01:00 UTC (next day) -> OTHER (1260 min)
      const tClosed = Math.floor(new Date('2024-07-16T01:00:00Z').getTime() / 1000);
      expect(getSessionType(tClosed, 'AAPL')).toBe('OTHER');
    });

    it('classifies US stock session types accurately in EST (Winter)', () => {
      // January 15, 2024 EST (UTC-5)
      // 09:30 ET = 14:30 UTC -> RTH
      const tOpen = Math.floor(new Date('2024-01-15T14:30:00Z').getTime() / 1000);
      expect(getSessionType(tOpen, 'AAPL')).toBe('RTH');

      // 08:00 ET = 13:00 UTC -> PRE
      const tPre = Math.floor(new Date('2024-01-15T13:00:00Z').getTime() / 1000);
      expect(getSessionType(tPre, 'AAPL')).toBe('PRE');

      // 16:30 ET = 21:30 UTC -> POST
      const tPost = Math.floor(new Date('2024-01-15T21:30:00Z').getTime() / 1000);
      expect(getSessionType(tPost, 'AAPL')).toBe('POST');
    });

    it('processes consecutive timestamps through cached day logic with high performance', () => {
      // Benchmark: 10,000 timestamps in sequence
      const baseSec = Math.floor(new Date('2024-07-15T00:00:00Z').getTime() / 1000);
      let count = 0;
      for (let i = 0; i < 10000; i++) {
        const type = getSessionType(baseSec + i * 60, 'AAPL');
        if (type === 'RTH') count++;
      }
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('isRthBar Daily & Intraday Filtering', () => {
    it('preserves daily bars with composite session strings containing REG', () => {
      expect(isRthBar({ time: '2026-09-24 00:00:00', session: 'POST, PRE, REG' }, 'SPY')).toBe(true);
      expect(isRthBar({ time: '2026-09-24 00:00:00', session: 'REG, POST' }, 'SPY')).toBe(true);
      expect(isRthBar({ time: '2026-09-24 00:00:00', session: 'REG' }, 'SPY')).toBe(true);
    });

    it('preserves daily bars with ISO T formatting or date-only format', () => {
      expect(isRthBar({ time: '2026-09-24T00:00:00' }, 'SPY')).toBe(true);
      expect(isRthBar({ time: '2026-09-24T12:00:00' }, 'SPY')).toBe(true);
      expect(isRthBar({ time: '2026-09-24' }, 'SPY')).toBe(true);
    });

    it('rejects daily bars that strictly lack regular trading hours', () => {
      expect(isRthBar({ time: '2026-09-24 00:00:00', session: 'PRE' }, 'SPY')).toBe(false);
      expect(isRthBar({ time: '2026-09-24 00:00:00', session: 'POST' }, 'SPY')).toBe(false);
      expect(isRthBar({ time: '2026-09-24 00:00:00', session: 'ETH' }, 'SPY')).toBe(false);
    });

    it('strictly enforces RTH on intraday bars', () => {
      // 08:30 ET (12:30 UTC) PRE bar
      expect(isRthBar({ time: '2026-09-24 12:30:00', session: 'PRE' }, 'SPY')).toBe(false);
      // 09:35 ET (13:35 UTC) REG bar
      expect(isRthBar({ time: '2026-09-24 13:35:00', session: 'REG' }, 'SPY')).toBe(true);
      // 16:30 ET (20:30 UTC) POST bar
      expect(isRthBar({ time: '2026-09-24 20:30:00', session: 'POST' }, 'SPY')).toBe(false);
    });
  });
});
