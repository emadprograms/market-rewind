import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { PlaybackBar } from '../../src/components/PlaybackBar';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('PlaybackBar Slider & Timeline Seeking Behavior', () => {
  const time920Ms = new Date('2026-09-08T13:20:00Z').getTime();
  const time930Ms = new Date('2026-09-08T13:30:00Z').getTime();
  const time1015Ms = new Date('2026-09-08T14:15:00Z').getTime();
  const time1600Ms = new Date('2026-09-08T20:00:00Z').getTime();

  // Create mock ticks from 9:20 AM to 16:00 PM
  const totalSeconds = (time1600Ms - time920Ms) / 1000;
  const mockTicks: MarketTick[] = [
    { time: '2026-09-08 13:20:00', price: 350.0, volume: 10, symbol: 'TSLA', session: 'PRE' },
    { time: '2026-09-08 13:30:00', price: 351.0, volume: 100, symbol: 'TSLA', session: 'REG' },
    { time: '2026-09-08 14:15:00', price: 355.0, volume: 200, symbol: 'TSLA', session: 'REG' },
    { time: '2026-09-08 20:00:00', price: 360.0, volume: 50, symbol: 'TSLA', session: 'REG' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
    usePlaybackStore.setState({
      bufferedTicks: mockTicks,
      totalTicks: mockTicks.length,
      currentTickIndex: 0,
      currentTick: mockTicks[0],
      currentTime: time920Ms,
      isPaused: true,
      playbackSpeed: 1,
      latestTickBySymbol: { TSLA: mockTicks[0] },
      ticksBySymbol: { TSLA: mockTicks },
    });
  });

  it('renders slider with correct minTime and maxTime spanning 9:20 AM to 4:00 PM', () => {
    const { getByTestId } = render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="TSLA"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const slider = getByTestId('playback-time-slider') as HTMLInputElement;
    expect(Number(slider.min)).toBe(time920Ms);
    expect(Number(slider.max)).toBe(time1600Ms);
    expect(Number(slider.value)).toBe(time920Ms);
  });

  it('immediately pauses playback when user seeks via timeline slider', async () => {
    // Start playback (playing)
    usePlaybackStore.setState({ isPaused: false });
    expect(usePlaybackStore.getState().isPaused).toBe(false);

    const { getByTestId } = render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="TSLA"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const slider = getByTestId('playback-time-slider');

    // User drags slider to 10:15 AM
    await act(async () => {
      fireEvent.change(slider, { target: { value: String(time1015Ms) } });
      fireEvent.mouseUp(slider);
    });

    // Playback must be paused immediately on seek
    expect(usePlaybackStore.getState().isPaused).toBe(true);
    expect(usePlaybackStore.getState().currentTime).toBe(time1015Ms);
  });

  it('updates latestTickBySymbol and currentTickIndex to match the seek target', async () => {
    const { getByTestId } = render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="TSLA"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const slider = getByTestId('playback-time-slider');

    await act(async () => {
      fireEvent.change(slider, { target: { value: String(time1015Ms) } });
      fireEvent.mouseUp(slider);
    });

    const state = usePlaybackStore.getState();
    expect(state.currentTickIndex).toBe(2); // index of the 14:15:00 tick
    expect(state.currentTick?.time).toBe('2026-09-08 14:15:00');
    expect(state.latestTickBySymbol['TSLA']?.time).toBe('2026-09-08 14:15:00');
  });

  it('supports rapid slider dragging without desyncing final committed time', async () => {
    const { getByTestId } = render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="TSLA"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const slider = getByTestId('playback-time-slider');

    // Simulate rapid drag across multiple points
    await act(async () => {
      fireEvent.change(slider, { target: { value: String(time930Ms) } });
      fireEvent.change(slider, { target: { value: String(time930Ms + 60000) } });
      fireEvent.change(slider, { target: { value: String(time1015Ms) } });
      fireEvent.mouseUp(slider);
    });

    expect(usePlaybackStore.getState().currentTime).toBe(time1015Ms);
    expect(usePlaybackStore.getState().isPaused).toBe(true);
  });

  it('seeks accurately when submitting explicit HH:MM:SS jump input (SCRUB-02)', async () => {
    const { getByTestId } = render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="TSLA"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const jumpInput = getByTestId('time-jump-input');
    await act(async () => {
      fireEvent.change(jumpInput, { target: { value: '10:15:00' } });
      fireEvent.submit(jumpInput.closest('form')!);
    });

    expect(usePlaybackStore.getState().currentTime).toBe(time1015Ms);
    expect(usePlaybackStore.getState().isPaused).toBe(true);
  });
});
