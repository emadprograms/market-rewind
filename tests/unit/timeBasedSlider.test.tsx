import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlaybackBar } from '../../src/components/PlaybackBar';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('Time-Based Playback Slider Unit Tests', () => {
  // Simulating market replay ticks from 09:20 AM ET to 16:00 PM ET
  // On 2026-09-25 (EDT, UTC-4):
  // 09:20:00 ET = 13:20:00 UTC
  // 09:29:00 ET = 13:29:00 UTC
  // 09:30:00 ET = 13:30:00 UTC (Market Open)
  // 16:00:00 ET = 20:00:00 UTC (Market Close)
  const t0830 = isoToMs('2026-09-25 12:30:00.000');
  const t0920 = isoToMs('2026-09-25 13:20:00.000');
  const t0922 = isoToMs('2026-09-25 13:22:00.000');
  const t0925 = isoToMs('2026-09-25 13:25:00.000');
  const t0930 = isoToMs('2026-09-25 13:30:00.000');
  const t1600 = isoToMs('2026-09-25 20:00:00.000');

  const sampleTicks: MarketTick[] = [
    { time: '2026-09-25 13:20:00.000', symbol: 'SPY', price: 500.0, volume: 100 },
    { time: '2026-09-25 13:22:00.000', symbol: 'SPY', price: 500.25, volume: 50 },
    { time: '2026-09-25 13:25:00.000', symbol: 'SPY', price: 500.5, volume: 80 },
    { time: '2026-09-25 13:30:00.000', symbol: 'SPY', price: 501.0, volume: 5000 },
    { time: '2026-09-25 20:00:00.000', symbol: 'SPY', price: 505.0, volume: 2000 },
  ];

  beforeEach(() => {
    usePlaybackStore.getState().reset();
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);
    usePlaybackStore.getState().setCurrentTime(t0920);
    usePlaybackStore.getState().seekTickTime(t0920);
  });

  it('renders time-based slider with bounds spanning session start to end in ms', () => {
    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="SPY"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const slider = screen.getByTestId('playback-time-slider') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.type).toBe('range');

    // Slider min starts at 08:30 ET and max ends at market close 16:00 ET
    expect(Number(slider.min)).toBe(t0830);
    expect(Number(slider.max)).toBe(t1600);
    expect(Number(slider.value)).toBe(t0920);
    expect(Number(slider.step)).toBe(1000); // 1-second resolution
  });

  it('displays session time progress in the label instead of raw tick count', () => {
    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="SPY"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const label = screen.getByTestId('playback-time-label');
    expect(label).toBeInTheDocument();
    // In America/New_York, 13:20:00 UTC is 09:20:00 and 20:00:00 UTC is 16:00:00
    expect(label.textContent).toContain('09:20:00');
    expect(label.textContent).toContain('16:00:00');
  });

  it('seeks by time when dragging the slider to 09:29 AM ET', () => {
    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="SPY"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const slider = screen.getByTestId('playback-time-slider');
    const t0929 = isoToMs('2026-09-25 13:29:00.000');

    // User drags slider to 09:29:00 AM ET
    fireEvent.change(slider, { target: { value: String(t0929) } });

    const state = usePlaybackStore.getState();
    expect(state.currentTime).toBe(t0929);
    // At 09:29:00, the last tick executed was 09:25:00 (index 2)
    expect(state.currentTickIndex).toBe(2);
    expect(state.currentTick?.price).toBe(500.5);
  });

  it('seeks by time when dragging the slider to 09:30 AM ET market open', () => {
    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="SPY"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const slider = screen.getByTestId('playback-time-slider');

    // User drags slider to 09:30:00 AM ET (open tick)
    fireEvent.change(slider, { target: { value: String(t0930) } });

    const state = usePlaybackStore.getState();
    expect(state.currentTime).toBe(t0930);
    // At 09:30:00, open tick (index 3) has executed
    expect(state.currentTickIndex).toBe(3);
    expect(state.currentTick?.price).toBe(501.0);
  });

  it('preserves initial currentTime if before first buffered tick', () => {
    // If user enters at 09:20 AM ET but first trade was at 09:25 AM ET
    const lateTicks: MarketTick[] = [
      { time: '2026-09-25 13:25:00.000', symbol: 'SPY', price: 500.5, volume: 80 },
      { time: '2026-09-25 20:00:00.000', symbol: 'SPY', price: 505.0, volume: 2000 },
    ];
    usePlaybackStore.getState().setBufferedTicks(lateTicks);
    usePlaybackStore.getState().setCurrentTime(t0920);
    usePlaybackStore.getState().seekTickTime(t0920);

    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="SPY"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const slider = screen.getByTestId('playback-time-slider') as HTMLInputElement;
    // Slider min allows seeking back to 08:30:00 while value sits at initial currentTime 09:20:00
    expect(Number(slider.min)).toBe(t0830);
    expect(Number(slider.value)).toBe(t0920);
  });
});
