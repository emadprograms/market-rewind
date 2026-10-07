import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePlaybackStore, isoToMs } from '../../../src/store/usePlaybackStore';
import { PlaybackBar } from '../../../src/components/PlaybackBar';
import { synthesizeTicksFromBars, buildCandleFromTickSlice } from '../../../src/lib/tickSynthesizer';
import { getBucketTimestamp } from '../../../src/lib/candleSynthesizer';
import { resampleData } from '../../../src/lib/resampling';
import type { MarketTick, RawBar } from '../../../src/types';

describe('Milestone v3.0 Tick Replay, Date Reset & Temporal Isolation Regression', () => {

  const computeUtcMsFromEt = (dateStr: string, etTimeStr: string): number => {
    const probeDate = new Date(`${dateStr}T14:00:00Z`);
    const nyHour = new Intl.DateTimeFormat('en-US', { 
      timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' 
    }).format(probeDate);
    const offsetHours = 14 - parseInt(nyHour, 10);
    const [hh, mm] = etTimeStr.split(':');
    const localMs = new Date(`${dateStr}T${hh}:${mm}:00Z`).getTime();
    const targetUtcDate = new Date(localMs + (offsetHours * 3600000));
    return targetUtcDate.getTime();
  };

  beforeEach(() => {
    usePlaybackStore.getState().reset();
  });

  describe('1. Canonical 9:20 AM ET Day Reset', () => {
    it('should compute exact 9:20 AM ET in UTC for any day and set playback state', () => {
      // For September 2, 2026 (EDT, UTC-4), 09:20 AM ET is 13:20:00 UTC
      const sept2UtcMs = computeUtcMsFromEt('2026-09-02', '09:20');
      const expectedUtcStr = new Date(sept2UtcMs).toISOString().replace('T', ' ').slice(0, 19);

      expect(expectedUtcStr).toBe('2026-09-02 13:20:00');

      usePlaybackStore.getState().setCurrentTime(sept2UtcMs);
      usePlaybackStore.getState().setPaused(true);

      expect(usePlaybackStore.getState().currentTime).toBe(sept2UtcMs);
      expect(usePlaybackStore.getState().isPaused).toBe(true);
    });

    it('should seek tick buffer directly to 9:20 AM ET upon reset', () => {
      const sept2UtcMs = computeUtcMsFromEt('2026-09-02', '09:20');
      const ticks: MarketTick[] = [
        { time: '2026-09-02 13:20:00.000', symbol: 'NVDA', price: 218.0, volume: 100 },
        { time: '2026-09-02 13:20:15.000', symbol: 'NVDA', price: 218.5, volume: 50 },
        { time: '2026-09-02 13:28:00.000', symbol: 'NVDA', price: 219.0, volume: 300 },
      ];

      usePlaybackStore.getState().setBufferedTicks(ticks);
      usePlaybackStore.getState().seekTickTime(sept2UtcMs);

      expect(usePlaybackStore.getState().currentTickIndex).toBe(0);
      expect(usePlaybackStore.getState().currentTick?.price).toBe(218.0);
      expect(usePlaybackStore.getState().currentTime).toBe(sept2UtcMs);
    });
  });

  describe('2. Strict Temporal Isolation (Zero Future Data Leak)', () => {
    it('should strictly exclude future daily candles beyond the selected replay day', () => {
      const replayTimeMs = computeUtcMsFromEt('2026-09-02', '09:20');
      const endOfReplayDay = new Date(new Date(replayTimeMs).toISOString().slice(0, 10) + 'T23:59:59.999Z').getTime();

      const allDailyBars: RawBar[] = [
        { time: '2026-08-31 00:00:00', open: 210, high: 215, low: 209, close: 214, volume: 10000, session: 'REG' },
        { time: '2026-09-01 00:00:00', open: 214, high: 218, low: 213, close: 217, volume: 12000, session: 'REG' },
        { time: '2026-09-02 00:00:00', open: 217, high: 225, low: 216, close: 224, volume: 15000, session: 'REG' },
        // Future bars that MUST NOT leak
        { time: '2026-09-03 00:00:00', open: 224, high: 228, low: 223, close: 227, volume: 14000, session: 'REG' },
        { time: '2026-09-25 00:00:00', open: 228, high: 235, low: 227, close: 234, volume: 18000, session: 'REG' },
      ];

      const visibleBars = allDailyBars.filter(d => new Date(d.time.replace(' ', 'T') + 'Z').getTime() <= endOfReplayDay);

      expect(visibleBars.length).toBe(3);
      expect(visibleBars.map(b => b.time)).toEqual([
        '2026-08-31 00:00:00',
        '2026-09-01 00:00:00',
        '2026-09-02 00:00:00',
      ]);
      expect(visibleBars.some(b => b.time.startsWith('2026-09-03'))).toBe(false);
      expect(visibleBars.some(b => b.time.startsWith('2026-09-25'))).toBe(false);
    });

    it('should exclude intraday completed bars from historical data when forming live from ticks', () => {
      // Replay cursor at 13:22:00 on 5-minute timeframe.
      // Current bucket starts at 13:20:00.
      const globalTime = isoToMs('2026-09-02 13:22:00');
      const durationSec = 300; // 5min
      const currentBucketStartMs = Math.floor(globalTime / (durationSec * 1000)) * (durationSec * 1000);

      const historical1mBars: RawBar[] = [
        { time: '2026-09-02 13:18:00', open: 217.9, high: 218.0, low: 217.8, close: 217.95, volume: 100, session: 'REG' },
        { time: '2026-09-02 13:19:00', open: 217.95, high: 218.1, low: 217.9, close: 218.0, volume: 120, session: 'REG' },
        // Historical bars in the active 13:20-13:25 bucket that contain future minute closes:
        { time: '2026-09-02 13:20:00', open: 218.0, high: 218.3, low: 217.9, close: 218.2, volume: 150, session: 'REG' },
        { time: '2026-09-02 13:21:00', open: 218.2, high: 218.5, low: 218.1, close: 218.4, volume: 180, session: 'REG' },
        { time: '2026-09-02 13:22:00', open: 218.4, high: 218.6, low: 218.3, close: 218.5, volume: 200, session: 'REG' },
      ];

      // Completed bars strictly prior to the current forming 5-min bucket
      const completedHistoricalBars = historical1mBars.filter(
        d => new Date(d.time.replace(' ', 'T') + 'Z').getTime() < currentBucketStartMs
      );

      expect(completedHistoricalBars.length).toBe(2);
      expect(completedHistoricalBars.map(b => b.time)).toEqual([
        '2026-09-02 13:18:00',
        '2026-09-02 13:19:00',
      ]);
    });
  });

  describe('3. Real-Time 5-Minute Candle Forming on Each Tick', () => {
    it('should dynamically update Open, High, Low, Close, and Volume for forming 5-min candle as ticks arrive', () => {
      const ticks: MarketTick[] = [
        { time: '2026-09-02 13:20:01.100', symbol: 'NVDA', price: 218.0, volume: 10 },
        { time: '2026-09-02 13:20:15.200', symbol: 'NVDA', price: 219.5, volume: 20 }, // New High
        { time: '2026-09-02 13:21:00.300', symbol: 'NVDA', price: 217.2, volume: 15 }, // New Low
        { time: '2026-09-02 13:22:30.400', symbol: 'NVDA', price: 218.8, volume: 25 }, // Current Close
      ];

      const bucketTime = getBucketTimestamp(ticks[0].time, '5min');
      expect(bucketTime).toBe('2026-09-02 13:20:00');

      // 1st tick: Open=218, High=218, Low=218, Close=218, Vol=10
      const c1 = buildCandleFromTickSlice(ticks, 0, 0, bucketTime);
      expect(c1).toEqual({
        time: '2026-09-02 13:20:00',
        open: 218.0,
        high: 218.0,
        low: 218.0,
        close: 218.0,
        volume: 10,
        session: 'REG',
        tickCount: 1,
      });

      // 2nd tick arrives (price jumps to 219.5)
      const c2 = buildCandleFromTickSlice(ticks, 0, 1, bucketTime);
      expect(c2?.high).toBe(219.5);
      expect(c2?.close).toBe(219.5);
      expect(c2?.volume).toBe(30);

      // 3rd tick arrives (price drops to 217.2)
      const c3 = buildCandleFromTickSlice(ticks, 0, 2, bucketTime);
      expect(c3?.high).toBe(219.5);
      expect(c3?.low).toBe(217.2);
      expect(c3?.close).toBe(217.2);
      expect(c3?.volume).toBe(45);

      // 4th tick arrives (price rallies to 218.8)
      const c4 = buildCandleFromTickSlice(ticks, 0, 3, bucketTime);
      expect(c4?.open).toBe(218.0);
      expect(c4?.high).toBe(219.5);
      expect(c4?.low).toBe(217.2);
      expect(c4?.close).toBe(218.8);
      expect(c4?.volume).toBe(70);
      expect(c4?.tickCount).toBe(4);
    });

    it('should roll over to a new forming candle when ticks cross the 5-minute bucket boundary', () => {
      const ticks: MarketTick[] = [
        { time: '2026-09-02 13:24:59.000', symbol: 'NVDA', price: 218.8, volume: 10 },
        { time: '2026-09-02 13:25:01.000', symbol: 'NVDA', price: 219.2, volume: 15 },
      ];

      const bucket1 = getBucketTimestamp(ticks[0].time, '5min');
      const bucket2 = getBucketTimestamp(ticks[1].time, '5min');

      expect(bucket1).toBe('2026-09-02 13:20:00');
      expect(bucket2).toBe('2026-09-02 13:25:00');

      const forming2 = buildCandleFromTickSlice(ticks, 1, 1, bucket2);
      expect(forming2).toEqual({
        time: '2026-09-02 13:25:00',
        open: 219.2,
        high: 219.2,
        low: 219.2,
        close: 219.2,
        volume: 15,
        session: 'REG',
        tickCount: 1,
      });
    });
  });

  describe('4. Universal Micro-Tick Synthesis', () => {
    it('should generate 4 valid micro-ticks per 1-minute historical candle', () => {
      const bars: RawBar[] = [
        { time: '2026-09-02 13:20:00', open: 218.0, high: 218.8, low: 217.5, close: 218.5, volume: 100, session: 'REG' },
      ];

      const synthTicks = synthesizeTicksFromBars(bars, 'NVDA');
      expect(synthTicks.length).toBe(4);

      // Tick 1 (:00 Open)
      expect(synthTicks[0].price).toBe(218.0);
      expect(synthTicks[0].time).toContain('13:20:00');

      // Tick 2 (:15 Low)
      expect(synthTicks[1].price).toBe(217.5);
      expect(synthTicks[1].time).toContain('13:20:15');

      // Tick 3 (:35 High)
      expect(synthTicks[2].price).toBe(218.8);
      expect(synthTicks[2].time).toContain('13:20:35');

      // Tick 4 (:55 Close)
      expect(synthTicks[3].price).toBe(218.5);
      expect(synthTicks[3].time).toContain('13:20:55');

      // Volumes partitioned cleanly
      expect(synthTicks.reduce((acc, t) => acc + t.volume, 0)).toBe(100);
    });
  });

  describe('5. Pure Tick Playback UI Controls', () => {
    it('should render playback bar with speed, scrub, and step controls without any TICK/BAR toggle', () => {
      const sampleTicks: MarketTick[] = [
        { time: '2026-09-02 13:20:00.000', symbol: 'NVDA', price: 218.0, volume: 10 },
      ];
      usePlaybackStore.getState().setBufferedTicks(sampleTicks);

      render(
        <PlaybackBar
          totalRealized={0}
          totalUnrealized={0}
          isDbLoaded={true}
          sessionTicker="NVDA"
          onResetToOpen={vi.fn()}
          minStepMinutes={1}
        />
      );

      // Mode toggle buttons must NOT exist
      expect(screen.queryByText('BAR')).not.toBeInTheDocument();
      expect(screen.queryByText('STEP')).not.toBeInTheDocument();

      // Controls must exist
      expect(screen.getByText('PLAY')).toBeInTheDocument();
      expect(screen.getByTitle('Step 1 Tick Forward')).toBeInTheDocument();
      expect(screen.getByTitle('Step 1 Tick Backward')).toBeInTheDocument();
      expect(screen.getByText('SPEED')).toBeInTheDocument();
      expect(screen.queryByText('$218.00')).not.toBeInTheDocument();
    });
  });
});
