import { describe, it, expect } from 'vitest';
import { resampleData } from '../../src/lib/resampling';
import { applyTickToCandles, buildCandlesFromTicks } from '../../src/lib/candleSynthesizer';
import { isRthBar, isRthTick, getSessionType } from '../../src/lib/timezones';
import type { RawBar, MarketTick } from '../../src/types';

describe('1D Daily Chart RTH Filtering', () => {

  describe('1. isRthBar and isRthTick detection', () => {
    it('accurately identifies RTH bars from session attribute', () => {
      expect(isRthBar({ time: '2026-09-25 13:30:00', session: 'REG' })).toBe(true);
      expect(isRthBar({ time: '2026-09-25 13:30:00', session: 'RTH' })).toBe(true);
      expect(isRthBar({ time: '2026-09-25 13:30:00', session: 'REG, POST' })).toBe(true);
      expect(isRthBar({ time: '2026-09-25 12:00:00', session: 'PRE' })).toBe(false);
      expect(isRthBar({ time: '2026-09-25 20:30:00', session: 'POST' })).toBe(false);
    });

    it('falls back to timestamp-based RTH detection when session is absent', () => {
      // 2026-09-25 is EDT (UTC-4)
      // 13:30:00 UTC = 09:30 ET (market open) -> RTH
      expect(isRthBar({ time: '2026-09-25 13:30:00' })).toBe(true);
      // 16:00:00 UTC = 12:00 ET (midday) -> RTH
      expect(isRthBar({ time: '2026-09-25 16:00:00' })).toBe(true);
      // 13:29:00 UTC = 09:29 ET (pre-market) -> PRE -> false
      expect(isRthBar({ time: '2026-09-25 13:29:00' })).toBe(false);
      // 20:01:00 UTC = 16:01 ET (post-market) -> POST -> false
      expect(isRthBar({ time: '2026-09-25 20:01:00' })).toBe(false);
    });

    it('preserves existing daily bars bucketed at 12:00:00 or 00:00:00 without session', () => {
      expect(isRthBar({ time: '2026-09-25 12:00:00' })).toBe(true);
      expect(isRthBar({ time: '2026-09-25 00:00:00' })).toBe(true);
    });

    it('accurately identifies RTH ticks from session attribute and timestamp', () => {
      expect(isRthTick({ time: '2026-09-25 13:30:00.100', session: 'REG' })).toBe(true);
      expect(isRthTick({ time: '2026-09-25 12:00:00.000', session: 'PRE' })).toBe(false);
      expect(isRthTick({ time: '2026-09-25 20:30:00.000', session: 'POST' })).toBe(false);

      // Without session: timestamp-based evaluation
      expect(isRthTick({ time: '2026-09-25 13:30:00.000' })).toBe(true);
      expect(isRthTick({ time: '2026-09-25 13:29:59.000' })).toBe(false);
      expect(isRthTick({ time: '2026-09-25 20:00:00.000' })).toBe(false);
    });
  });

  describe('2. resampleData 1D strictly uses RTH hours', () => {
    it('excludes PRE and POST market bars from the daily candle OHLCV', () => {
      const intradayBars: RawBar[] = [
        // Pre-market (08:00 - 09:29 ET): Extreme high spike at 800, low dip at 700
        { time: '2026-09-25 12:00:00', open: 710, high: 800, low: 700, close: 720, volume: 5000, session: 'PRE' },
        { time: '2026-09-25 13:29:00', open: 720, high: 725, low: 718, close: 722, volume: 2000, session: 'PRE' },

        // Regular Trading Hours (09:30 - 16:00 ET / 13:30 - 20:00 UTC)
        // 09:30 AM RTH Open = 730
        { time: '2026-09-25 13:30:00', open: 730, high: 735, low: 728, close: 732, volume: 10000, session: 'REG' },
        { time: '2026-09-25 15:00:00', open: 732, high: 750, low: 725, close: 745, volume: 25000, session: 'REG' },
        // 16:00 PM RTH Close = 740
        { time: '2026-09-25 19:59:00', open: 742, high: 744, low: 738, close: 740, volume: 15000, session: 'REG' },

        // After-hours / Post-market (16:01 - 20:00 ET): Extreme prices and extra volume
        { time: '2026-09-25 20:05:00', open: 740, high: 820, low: 680, close: 755, volume: 8000, session: 'POST' },
        { time: '2026-09-25 21:00:00', open: 755, high: 758, low: 750, close: 752, volume: 3000, session: 'POST' },
      ];

      const daily = resampleData(intradayBars, '1D');
      expect(daily).toHaveLength(1);

      const d = daily[0];
      expect(d.time).toBe('2026-09-25 12:00:00');
      // Open MUST be the RTH open (730), NOT the pre-market open (710)
      expect(d.open).toBe(730);
      // High MUST be the RTH high (750), NOT the pre-market (800) or post-market (820) spikes
      expect(d.high).toBe(750);
      // Low MUST be the RTH low (725), NOT the pre-market (700) or post-market (680) dips
      expect(d.low).toBe(725);
      // Close MUST be the RTH close (740), NOT the after-hours close (752)
      expect(d.close).toBe(740);
      // Volume MUST only sum RTH volume (10000 + 25000 + 15000 = 50000)
      expect(d.volume).toBe(50000);
      expect(d.session).toBe('REG');
    });

    it('returns empty array when all bars in the day are pre/post market', () => {
      const prePostBars: RawBar[] = [
        { time: '2026-09-25 12:00:00', open: 710, high: 715, low: 708, close: 712, volume: 500, session: 'PRE' },
        { time: '2026-09-25 20:30:00', open: 740, high: 742, low: 739, close: 741, volume: 300, session: 'POST' },
      ];

      const daily = resampleData(prePostBars, '1D');
      expect(daily).toHaveLength(0);
    });

    it('preserves already-resampled daily bars', () => {
      const dailyBars: RawBar[] = [
        { time: '2026-09-23 12:00:00', open: 720, high: 730, low: 715, close: 725, volume: 50000, session: 'REG' },
        { time: '2026-09-24 12:00:00', open: 725, high: 735, low: 720, close: 730, volume: 60000, session: 'REG' },
      ];

      const daily = resampleData(dailyBars, '1D');
      expect(daily).toHaveLength(2);
      expect(daily[0].open).toBe(720);
      expect(daily[1].close).toBe(730);
    });
  });

  describe('3. applyTickToCandles & buildCandlesFromTicks for 1D', () => {
    it('ignores pre-market and post-market ticks for 1D candle synthesis', () => {
      const initialCandles: RawBar[] = [
        { time: '2026-09-25 12:00:00', open: 730, high: 740, low: 728, close: 735, volume: 1000, session: 'REG' }
      ];

      const preTick: MarketTick = {
        time: '2026-09-25 12:30:00.000',
        symbol: 'SPY',
        price: 850, // extreme pre-market tick
        volume: 500,
        session: 'PRE'
      };

      const afterPre = applyTickToCandles(initialCandles, preTick, '1D');
      // Must be completely unchanged
      expect(afterPre).toEqual(initialCandles);

      const postTick: MarketTick = {
        time: '2026-09-25 20:15:00.000',
        symbol: 'SPY',
        price: 900, // extreme post-market tick
        volume: 800,
        session: 'POST'
      };

      const afterPost = applyTickToCandles(initialCandles, postTick, '1D');
      // Must be completely unchanged
      expect(afterPost).toEqual(initialCandles);
    });

    it('updates 1D candle when receiving valid RTH ticks', () => {
      const initialCandles: RawBar[] = [
        { time: '2026-09-25 12:00:00', open: 730, high: 740, low: 728, close: 735, volume: 1000, session: 'REG' }
      ];

      const rthTick: MarketTick = {
        time: '2026-09-25 15:30:00.000',
        symbol: 'SPY',
        price: 745,
        volume: 100,
        session: 'REG'
      };

      const updated = applyTickToCandles(initialCandles, rthTick, '1D');
      expect(updated).toHaveLength(1);
      expect(updated[0].high).toBe(745);
      expect(updated[0].close).toBe(745);
      expect(updated[0].volume).toBe(1100);
    });

    it('buildCandlesFromTicks builds 1D candle exclusively from RTH ticks', () => {
      const ticks: MarketTick[] = [
        // PRE tick
        { time: '2026-09-25 12:00:00.000', symbol: 'SPY', price: 710, volume: 50, session: 'PRE' },
        // RTH ticks
        { time: '2026-09-25 13:30:00.000', symbol: 'SPY', price: 730, volume: 100, session: 'REG' },
        { time: '2026-09-25 14:00:00.000', symbol: 'SPY', price: 738, volume: 150, session: 'REG' },
        { time: '2026-09-25 19:59:59.000', symbol: 'SPY', price: 735, volume: 200, session: 'REG' },
        // POST tick
        { time: '2026-09-25 20:30:00.000', symbol: 'SPY', price: 760, volume: 80, session: 'POST' },
      ];

      const candles = buildCandlesFromTicks(ticks, '1D');
      expect(candles).toHaveLength(1);
      expect(candles[0].open).toBe(730);
      expect(candles[0].high).toBe(738);
      expect(candles[0].low).toBe(730);
      expect(candles[0].close).toBe(735);
      expect(candles[0].volume).toBe(450); // 100 + 150 + 200
      expect(candles[0].session).toBe('REG');
    });
  });

  describe('4. Forming 1D candle temporal window logic', () => {
    it('does not create today forming candle before RTH open (09:30 ET)', () => {
      const selectedDate = '2026-09-25';
      const probeDate = new Date(`${selectedDate}T14:00:00Z`);
      const nyHour = new Intl.DateTimeFormat('en-US', { 
        timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' 
      }).format(probeDate);
      const offsetHours = 14 - parseInt(nyHour, 10);
      const startOfTodayMs = new Date(`${selectedDate}T00:00:00Z`).getTime() + (offsetHours * 3600000);

      const rthOpenMs = startOfTodayMs + (9.5 * 3600000);
      const rthCloseMs = startOfTodayMs + (16 * 3600000);

      // Playback is at 08:30 AM ET (pre-market, 1 hour before open)
      const effectiveCutoff = startOfTodayMs + (8.5 * 3600000);

      const candidateBars: RawBar[] = [
        { time: '2026-09-25 12:00:00', open: 710, high: 715, low: 708, close: 712, volume: 500, session: 'PRE' },
        { time: '2026-09-25 12:30:00', open: 712, high: 718, low: 710, close: 715, volume: 600, session: 'PRE' },
      ];

      const todayBars = candidateBars.filter(b => {
        const bMs = new Date(b.time.replace(' ', 'T') + (b.time.includes('Z') ? '' : 'Z')).getTime();
        return bMs >= rthOpenMs && bMs <= Math.min(effectiveCutoff, rthCloseMs) && isRthBar(b, 'SPY');
      });

      expect(todayBars).toHaveLength(0);
    });

    it('freezes today forming candle at 16:00 ET close during evening playback', () => {
      const selectedDate = '2026-09-25';
      const probeDate = new Date(`${selectedDate}T14:00:00Z`);
      const nyHour = new Intl.DateTimeFormat('en-US', { 
        timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' 
      }).format(probeDate);
      const offsetHours = 14 - parseInt(nyHour, 10);
      const startOfTodayMs = new Date(`${selectedDate}T00:00:00Z`).getTime() + (offsetHours * 3600000);

      const rthOpenMs = startOfTodayMs + (9.5 * 3600000);
      const rthCloseMs = startOfTodayMs + (16 * 3600000);

      // Playback is at 18:00 PM ET (2 hours after close)
      const effectiveCutoff = startOfTodayMs + (18 * 3600000);

      const candidateBars: RawBar[] = [
        // RTH bars
        { time: '2026-09-25 13:30:00', open: 730, high: 735, low: 728, close: 732, volume: 10000, session: 'REG' },
        { time: '2026-09-25 19:59:00', open: 732, high: 745, low: 730, close: 742, volume: 15000, session: 'REG' },
        // POST bars after 16:00
        { time: '2026-09-25 20:05:00', open: 742, high: 780, low: 720, close: 770, volume: 5000, session: 'POST' },
        { time: '2026-09-25 21:00:00', open: 770, high: 775, low: 765, close: 768, volume: 4000, session: 'POST' },
      ];

      const todayBars = candidateBars.filter(b => {
        const bMs = new Date(b.time.replace(' ', 'T') + (b.time.includes('Z') ? '' : 'Z')).getTime();
        return bMs >= rthOpenMs && bMs <= Math.min(effectiveCutoff, rthCloseMs) && isRthBar(b, 'SPY');
      });

      // Strictly only the 2 RTH bars should be included
      expect(todayBars).toHaveLength(2);
      expect(todayBars[0].open).toBe(730);
      expect(todayBars[1].close).toBe(742);
    });
  });
});
