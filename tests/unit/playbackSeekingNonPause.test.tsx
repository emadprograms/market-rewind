import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { PlaybackBar } from '../../src/components/PlaybackBar';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import type { MarketTick, RawBar } from '../../src/types';

describe('Playback Seeking & Stepping Non-Pause Behavior', () => {
  const t0 = isoToMs('2026-09-08 13:30:00');
  const t1 = isoToMs('2026-09-08 13:35:00');
  const t2 = isoToMs('2026-09-08 13:40:00');
  const t3 = isoToMs('2026-09-08 13:45:00');
  const tEnd = isoToMs('2026-09-08 14:00:00');

  const mockTicks: MarketTick[] = [
    { time: '2026-09-08 13:30:00', price: 100.0, volume: 10, symbol: 'SPY', session: 'REG' },
    { time: '2026-09-08 13:35:00', price: 101.0, volume: 20, symbol: 'SPY', session: 'REG' },
    { time: '2026-09-08 13:40:00', price: 102.0, volume: 30, symbol: 'SPY', session: 'REG' },
    { time: '2026-09-08 13:45:00', price: 103.0, volume: 40, symbol: 'SPY', session: 'REG' },
    { time: '2026-09-08 14:00:00', price: 104.0, volume: 50, symbol: 'SPY', session: 'REG' },
  ];

  const mockBars: RawBar[] = [
    { time: '2026-09-08 13:30:00', open: 100, high: 102, low: 99, close: 101, volume: 1000, session: 'REG' },
    { time: '2026-09-08 13:35:00', open: 101, high: 103, low: 100, close: 102, volume: 1200, session: 'REG' },
    { time: '2026-09-08 13:40:00', open: 102, high: 104, low: 101, close: 103, volume: 1100, session: 'REG' },
    { time: '2026-09-08 13:45:00', open: 103, high: 105, low: 102, close: 104, volume: 1300, session: 'REG' },
    { time: '2026-09-08 14:00:00', open: 104, high: 106, low: 103, close: 105, volume: 1500, session: 'REG' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
    usePlaybackStore.setState({
      bufferedTicks: mockTicks,
      totalTicks: mockTicks.length,
      currentTickIndex: 1,
      currentTick: mockTicks[1],
      currentTime: t1,
      isPaused: false,
      stepMinutes: 1,
      masterData: mockBars,
      latestTickBySymbol: { SPY: mockTicks[1] },
      ticksBySymbol: { SPY: mockTicks },
    });
  });

  describe('When playback is active (isPaused === false)', () => {
    it('stepForward() does NOT pause playback', () => {
      usePlaybackStore.setState({ isPaused: false, currentTime: t1, stepMinutes: 1 });
      usePlaybackStore.getState().stepForward();

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.currentTime).toBeGreaterThan(t1);
    });

    it('stepForward() with 1-tick step (stepMinutes: 0) does NOT pause playback', () => {
      usePlaybackStore.setState({ isPaused: false, currentTickIndex: 1, stepMinutes: 0 });
      usePlaybackStore.getState().stepForward();

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.currentTickIndex).toBe(2);
      expect(state.currentTime).toBe(t2);
    });

    it('stepBackward() does NOT pause playback', () => {
      usePlaybackStore.setState({ isPaused: false, currentTime: t2, stepMinutes: 1 });
      usePlaybackStore.getState().stepBackward();

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.currentTime).toBeLessThan(t2);
    });

    it('stepBackward() with 1-tick step (stepMinutes: 0) does NOT pause playback', () => {
      usePlaybackStore.setState({ isPaused: false, currentTickIndex: 2, stepMinutes: 0 });
      usePlaybackStore.getState().stepBackward();

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.currentTickIndex).toBe(1);
      expect(state.currentTime).toBe(t1);
    });

    it('seekTickTime() does NOT pause playback when seeking to mid-session', () => {
      usePlaybackStore.setState({ isPaused: false, currentTime: t0 });
      usePlaybackStore.getState().seekTickTime(t2);

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.currentTime).toBe(t2);
    });

    it('seekTickIndex() does NOT pause playback', () => {
      usePlaybackStore.setState({ isPaused: false, currentTickIndex: 0 });
      usePlaybackStore.getState().seekTickIndex(2);

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.currentTickIndex).toBe(2);
      expect(state.currentTime).toBe(t2);
    });

    it('PlaybackBar timeline slider seek does NOT pause playback', async () => {
      usePlaybackStore.setState({ isPaused: false, currentTime: t0 });

      const { getByTestId } = render(
        <PlaybackBar
          totalRealized={0}
          totalUnrealized={0}
          isDbLoaded={true}
          sessionTicker="SPY"
          onResetToOpen={vi.fn()}
          minStepMinutes={1}
        />
      );

      const slider = getByTestId('playback-time-slider');
      await act(async () => {
        fireEvent.change(slider, { target: { value: String(t2) } });
        fireEvent.mouseUp(slider);
      });

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.currentTime).toBe(t2);
    });

    it('PlaybackBar jump input does NOT pause playback', async () => {
      usePlaybackStore.setState({ isPaused: false, currentTime: t0 });

      const { getByTestId } = render(
        <PlaybackBar
          totalRealized={0}
          totalUnrealized={0}
          isDbLoaded={true}
          sessionTicker="SPY"
          onResetToOpen={vi.fn()}
          minStepMinutes={1}
        />
      );

      const jumpInput = getByTestId('time-jump-input');
      await act(async () => {
        // 13:40:00 UTC = 09:40:00 ET (EDT UTC-4)
        fireEvent.change(jumpInput, { target: { value: '09:40:00' } });
        fireEvent.submit(jumpInput.closest('form')!);
      });

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.currentTime).toBe(t2);
    });
  });

  describe('When playback is paused (isPaused === true)', () => {
    beforeEach(() => {
      usePlaybackStore.setState({ isPaused: true });
    });

    it('stepForward() remains paused', () => {
      usePlaybackStore.setState({ isPaused: true, currentTime: t1, stepMinutes: 1 });
      usePlaybackStore.getState().stepForward();

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.currentTime).toBeGreaterThan(t1);
    });

    it('stepForward() with 1-tick step (stepMinutes: 0) remains paused', () => {
      usePlaybackStore.setState({ isPaused: true, currentTickIndex: 1, stepMinutes: 0 });
      usePlaybackStore.getState().stepForward();

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.currentTickIndex).toBe(2);
      expect(state.currentTime).toBe(t2);
    });

    it('stepBackward() remains paused', () => {
      usePlaybackStore.setState({ isPaused: true, currentTime: t2, stepMinutes: 1 });
      usePlaybackStore.getState().stepBackward();

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.currentTime).toBeLessThan(t2);
    });

    it('stepBackward() with 1-tick step (stepMinutes: 0) remains paused', () => {
      usePlaybackStore.setState({ isPaused: true, currentTickIndex: 2, stepMinutes: 0 });
      usePlaybackStore.getState().stepBackward();

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.currentTickIndex).toBe(1);
      expect(state.currentTime).toBe(t1);
    });

    it('seekTickTime() remains paused', () => {
      usePlaybackStore.setState({ isPaused: true, currentTime: t0 });
      usePlaybackStore.getState().seekTickTime(t2);

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.currentTime).toBe(t2);
    });

    it('seekTickIndex() remains paused', () => {
      usePlaybackStore.setState({ isPaused: true, currentTickIndex: 0 });
      usePlaybackStore.getState().seekTickIndex(2);

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.currentTickIndex).toBe(2);
      expect(state.currentTime).toBe(t2);
    });

    it('PlaybackBar timeline slider seek remains paused', async () => {
      usePlaybackStore.setState({ isPaused: true, currentTime: t0 });

      const { getByTestId } = render(
        <PlaybackBar
          totalRealized={0}
          totalUnrealized={0}
          isDbLoaded={true}
          sessionTicker="SPY"
          onResetToOpen={vi.fn()}
          minStepMinutes={1}
        />
      );

      const slider = getByTestId('playback-time-slider');
      await act(async () => {
        fireEvent.change(slider, { target: { value: String(t2) } });
        fireEvent.mouseUp(slider);
      });

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.currentTime).toBe(t2);
    });

    it('PlaybackBar jump input remains paused', async () => {
      usePlaybackStore.setState({ isPaused: true, currentTime: t0 });

      const { getByTestId } = render(
        <PlaybackBar
          totalRealized={0}
          totalUnrealized={0}
          isDbLoaded={true}
          sessionTicker="SPY"
          onResetToOpen={vi.fn()}
          minStepMinutes={1}
        />
      );

      const jumpInput = getByTestId('time-jump-input');
      await act(async () => {
        fireEvent.change(jumpInput, { target: { value: '09:40:00' } });
        fireEvent.submit(jumpInput.closest('form')!);
      });

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.currentTime).toBe(t2);
    });
  });

  describe('End-of-data handling', () => {
    it('seekTickTime pauses playback when seeking to or beyond the end of data', () => {
      usePlaybackStore.setState({ isPaused: false, currentTime: t1 });
      // tEnd is the last tick time (14:00:00), maxMs for masterData is 14:00:00 + 60s
      const beyondEnd = tEnd + 120000;
      usePlaybackStore.getState().seekTickTime(beyondEnd);

      const state = usePlaybackStore.getState();
      expect(state.isPaused).toBe(true);
    });
  });
});
