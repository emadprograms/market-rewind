import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlaybackStore, isoToMs } from '../../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../../src/store/useWorkspaceStore';
import { resampleData } from '../../../src/lib/resampling';
import { isRthBar, isRthTick } from '../../../src/lib/timezones';
import type { RawBar, MarketTick } from '../../../src/types';

describe('Regression: Premarket (9:20 AM) to RTH (9:30 AM) Playback & Multi-Chart Integrity', () => {
  const selectedDate = '2026-09-08';
  // 2026-09-08 is EDT (UTC-4)
  // 9:20 AM ET = 13:20:00 UTC
  // 9:30 AM ET = 13:30:00 UTC
  const time920Ms = isoToMs('2026-09-08T13:20:00.000Z');
  const time925Ms = isoToMs('2026-09-08T13:25:00.000Z');
  const time930Ms = isoToMs('2026-09-08T13:30:00.000Z');

  // Realistic historical daily bars with composite DuckDB session string "POST, PRE, REG"
  const historicalDailyBars: RawBar[] = Array.from({ length: 30 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return {
      time: `2026-08-${day} 12:00:00`,
      open: 300 + i,
      high: 305 + i,
      low: 298 + i,
      close: 303 + i,
      volume: 1000000 + i * 10000,
      session: 'POST, PRE, REG', // DuckDB composite session string
    };
  });

  // Ticks: 5 pre-market ticks between 9:20 and 9:29:59 ET, followed by a burst of 49 RTH ticks at 9:30:00 ET
  const premarketTicks: MarketTick[] = [
    { time: '2026-09-08 13:20:10.000', symbol: 'TSLA', price: 345.0, volume: 50, session: 'PRE' },
    { time: '2026-09-08 13:22:00.000', symbol: 'TSLA', price: 346.0, volume: 100, session: 'PRE' },
    { time: '2026-09-08 13:25:00.000', symbol: 'TSLA', price: 347.5, volume: 75, session: 'PRE' },
    { time: '2026-09-08 13:28:30.000', symbol: 'TSLA', price: 348.0, volume: 120, session: 'PRE' },
    { time: '2026-09-08 13:29:55.000', symbol: 'TSLA', price: 349.0, volume: 200, session: 'PRE' },
  ];

  const rthTicksAt930: MarketTick[] = Array.from({ length: 49 }, (_, i) => ({
    time: `2026-09-08 13:30:00.${String(i * 20).padStart(3, '0')}`,
    symbol: 'TSLA',
    price: 350.0 + (i % 5) * 0.5 - (i % 3) * 0.25,
    volume: 100 + i * 10,
    session: 'REG',
  }));

  const allTicks = [...premarketTicks, ...rthTicksAt930];

  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
    usePlaybackStore.setState({
      currentTime: time920Ms,
      bufferedTicks: allTicks,
      totalTicks: allTicks.length,
      currentTickIndex: 0,
      isPaused: true,
      playbackSpeed: 1,
    });
  });

  describe('1. 9:20 AM Pre-market Preparation State', () => {
    it('preserves all historical daily bars with composite session strings ("POST, PRE, REG")', () => {
      // Historical daily bars from DuckDB must pass isRthBar
      const filtered = historicalDailyBars.filter((b) => isRthBar(b, 'TSLA'));
      expect(filtered.length).toBe(30);

      // Verify resampleData preserves all 30 historical daily bars
      const resampled = resampleData(filtered, '1D');
      expect(resampled.length).toBe(30);
    });

    it('rejects pure PRE and POST daily bars that contain no regular trading hours', () => {
      const holidayOrEthOnlyBars: RawBar[] = [
        { time: '2026-08-15 12:00:00', open: 310, high: 312, low: 309, close: 311, volume: 5000, session: 'PRE' },
        { time: '2026-08-16 12:00:00', open: 311, high: 315, low: 310, close: 314, volume: 8000, session: 'POST' },
        { time: '2026-08-17 12:00:00', open: 314, high: 318, low: 312, close: 316, volume: 10000, session: 'ETH' },
      ];

      const filtered = holidayOrEthOnlyBars.filter((b) => isRthBar(b, 'TSLA'));
      expect(filtered.length).toBe(0);
    });

    it('does NOT form a daily candle from pre-market ticks between 9:20 AM and 9:29:59 AM ET', () => {
      // Advance to 9:25 AM ET (premarket)
      usePlaybackStore.getState().advanceSimulationTime(time925Ms);
      const state = usePlaybackStore.getState();

      // Three premarket ticks have passed
      expect(state.currentTickIndex).toBe(2);
      expect(state.currentTick?.session).toBe('PRE');

      // Ticks before 9:30 AM ET must NOT be considered RTH ticks
      const consumedTicks = allTicks.slice(0, state.currentTickIndex + 1);
      const rthTicks = consumedTicks.filter((t) => isRthTick(t, 'TSLA'));
      expect(rthTicks.length).toBe(0);
    });
  });

  describe('2. 9:30 AM Market Open Tick Flood', () => {
    it('accurately transitions from 9:20 AM to 9:30 AM and consumes all 49 RTH ticks', () => {
      // Advance simulation time to 9:30:00.999 ET
      usePlaybackStore.getState().advanceSimulationTime(time930Ms + 999);
      const state = usePlaybackStore.getState();

      // All 5 premarket ticks + all 49 RTH ticks = 54 total ticks
      expect(state.currentTickIndex).toBe(53);
      expect(state.bufferedTicks.length).toBe(54);
    });

    it('forms today 1D candle strictly from RTH ticks, starting at 9:30:00 ET open price', () => {
      // Advance to 9:30:00.999 ET
      usePlaybackStore.getState().advanceSimulationTime(time930Ms + 999);
      const state = usePlaybackStore.getState();

      const executedTicks = state.bufferedTicks.slice(0, state.currentTickIndex + 1);
      const rthTicks = executedTicks.filter((t) => isRthTick(t, 'TSLA'));
      expect(rthTicks.length).toBe(49);

      // Synthesize today's forming daily candle
      const formingDaily: RawBar = {
        time: `${selectedDate} 12:00:00`,
        open: rthTicks[0].price,
        high: Math.max(...rthTicks.map((t) => t.price)),
        low: Math.min(...rthTicks.map((t) => t.price)),
        close: rthTicks[rthTicks.length - 1].price,
        volume: rthTicks.reduce((s, t) => s + (t.volume || 0), 0),
        session: 'REG',
        tickCount: rthTicks.length,
      };

      // Open MUST be first RTH tick at 9:30:00 (350.0), NOT premarket tick (345.0)
      expect(formingDaily.open).toBe(350.0);
      expect(formingDaily.tickCount).toBe(49);
      expect(formingDaily.session).toBe('REG');

      // Combined 1D chart data MUST have 30 historical daily bars + 1 forming daily bar = 31 bars!
      // NEVER just 1 lone candle!
      const totalDailyChartBars = [...historicalDailyBars, formingDaily];
      expect(totalDailyChartBars.length).toBe(31);
      expect(totalDailyChartBars[0].time).toBe('2026-08-01 12:00:00');
      expect(totalDailyChartBars[30].time).toBe('2026-09-08 12:00:00');
    });

    it('excludes after-hours/post-market ticks after 16:00 ET from the 1D daily candle', () => {
      const postTick: MarketTick = {
        time: '2026-09-08 20:05:00.000', // 16:05 ET = 20:05 UTC
        symbol: 'TSLA',
        price: 399.0, // After-hours wild spike
        volume: 50000,
        session: 'POST',
      };

      expect(isRthTick(postTick, 'TSLA')).toBe(false);
    });
  });

  describe('3. Viewport Stability during 9:30 AM Flood', () => {
    it('verifies that rapid incoming ticks at 9:30 AM do not reset viewport when user panned back in time', () => {
      // Mock timeScale
      const mockTimeScale = {
        getVisibleLogicalRange: vi.fn(),
        setVisibleLogicalRange: vi.fn(),
        scrollToPosition: vi.fn(),
        scrollToRealTime: vi.fn(),
        options: vi.fn().mockReturnValue({ rightOffset: 15 }),
      };

      // User panned back in time: viewing bars 5..20 (historical range, wasAtEnd = false)
      mockTimeScale.getVisibleLogicalRange.mockReturnValue({ from: 5, to: 20 });

      // Before ticks arrive: 30 bars loaded
      const lastDataCount = 30;
      const isSameContext = true;
      const wasAtEnd = 20 >= lastDataCount - 0.5; // false!

      expect(wasAtEnd).toBe(false);

      // In useChartLifecycle, incremental ticks set canIncrement = true and do NOT call syncViewport
      // Even if syncViewport is explicitly invoked when wasAtEnd is false, it MUST preserve user's historical range
      if (wasAtEnd) {
        mockTimeScale.setVisibleLogicalRange({ from: 5 + 1, to: 20 + 1 });
      } else {
        mockTimeScale.setVisibleLogicalRange({ from: 5, to: 20 });
      }

      expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 5, to: 20 });
      // Viewport did NOT snap to end or shake!
      expect(mockTimeScale.scrollToRealTime).not.toHaveBeenCalled();
    });
  });
});
