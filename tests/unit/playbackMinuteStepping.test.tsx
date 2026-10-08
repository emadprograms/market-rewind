import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { PlaybackBar } from '../../src/components/PlaybackBar';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('Minute-Based Playback Stepping Controls', () => {
  const baseTicks: MarketTick[] = [
    { time: '2026-09-25 14:30:00.000', symbol: 'SPY', price: 500.0, volume: 100 },
    { time: '2026-09-25 14:30:30.000', symbol: 'SPY', price: 500.1, volume: 50 },
    { time: '2026-09-25 14:31:00.000', symbol: 'SPY', price: 500.2, volume: 60 },
    { time: '2026-09-25 14:32:00.000', symbol: 'SPY', price: 500.3, volume: 70 },
    { time: '2026-09-25 14:35:00.000', symbol: 'SPY', price: 500.5, volume: 80 },
    { time: '2026-09-25 14:40:00.000', symbol: 'SPY', price: 501.0, volume: 90 },
    { time: '2026-09-25 14:45:00.000', symbol: 'SPY', price: 501.5, volume: 100 },
    { time: '2026-09-25 15:00:00.000', symbol: 'SPY', price: 502.0, volume: 110 },
  ];

  beforeEach(() => {
    usePlaybackStore.getState().reset();
    usePlaybackStore.getState().setBufferedTicks(baseTicks);
    usePlaybackStore.getState().setStepMinutes(3);
    usePlaybackStore.getState().seekTickTime('2026-09-25 14:30:00.000');
  });

  it('steps forward by 3 minutes by default (stepMinutes: 3)', () => {
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:30:00.000'));

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:33:00.000'));

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:36:00.000'));
  });

  it('steps forward by 1 minute when stepMinutes is set to 1', () => {
    usePlaybackStore.getState().setStepMinutes(1);
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:30:00.000'));

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:31:00.000'));

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:32:00.000'));
  });

  it('steps forward by 2 minutes when stepMinutes is set to 2', () => {
    usePlaybackStore.getState().setStepMinutes(2);

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:32:00.000'));

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:34:00.000'));
  });

  it('steps forward by 5 minutes when stepMinutes is set to 5', () => {
    usePlaybackStore.getState().setStepMinutes(5);

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:35:00.000'));

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:40:00.000'));
  });

  it('steps forward by 10 minutes when stepMinutes is set to 10', () => {
    usePlaybackStore.getState().setStepMinutes(10);

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:40:00.000'));
  });

  it('steps forward by 15 minutes when stepMinutes is set to 15', () => {
    usePlaybackStore.getState().setStepMinutes(15);

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:45:00.000'));

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 15:00:00.000'));
  });

  it('steps backward by 2 minutes when stepMinutes is set to 2', () => {
    usePlaybackStore.getState().seekTickTime('2026-09-25 14:35:00.000');
    usePlaybackStore.getState().setStepMinutes(2);

    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:34:00.000'));

    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:32:00.000'));
  });

  it('steps backward by 3 minutes when stepMinutes is set to 3', () => {
    usePlaybackStore.getState().seekTickTime('2026-09-25 14:35:00.000');
    usePlaybackStore.getState().setStepMinutes(3);

    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:33:00.000'));

    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:30:00.000'));
  });

  it('steps backward by 5 minutes when stepMinutes is set to 5', () => {
    usePlaybackStore.getState().seekTickTime('2026-09-25 14:40:00.000');
    usePlaybackStore.getState().setStepMinutes(5);

    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:35:00.000'));

    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:30:00.000'));
  });

  it('steps backward by 15 minutes when stepMinutes is set to 15', () => {
    usePlaybackStore.getState().seekTickTime('2026-09-25 14:45:00.000');
    usePlaybackStore.getState().setStepMinutes(15);

    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:30:00.000'));
  });

  it('aligns to minute boundaries when starting from intermediate timestamp', () => {
    // Paused mid-candle at 14:30:25
    usePlaybackStore.getState().seekTickTime('2026-09-25 14:30:25.000');
    usePlaybackStore.getState().setStepMinutes(1);

    // Forward steps to next 1m boundary: 14:31:00
    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:31:00.000'));

    // Backward from 14:30:25 steps to start of minute: 14:30:00
    usePlaybackStore.getState().seekTickTime('2026-09-25 14:30:25.000');
    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:30:00.000'));
  });

  it('clamps to data boundaries and does not step beyond bounds', () => {
    // At session start, backward does not exceed start
    usePlaybackStore.getState().seekTickTime('2026-09-25 14:30:00.000');
    usePlaybackStore.getState().setStepMinutes(5);
    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:30:00.000'));

    // At session end, forward clamps to last tick
    usePlaybackStore.getState().seekTickTime('2026-09-25 14:55:00.000');
    usePlaybackStore.getState().setStepMinutes(15);
    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 15:00:00.000'));

    // Further step forward stays at max
    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 15:00:00.000'));
  });

  it('falls back to single-tick stepping when stepMinutes is set to 0', () => {
    usePlaybackStore.getState().setStepMinutes(0);
    usePlaybackStore.getState().seekTickIndex(0);

    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTickIndex).toBe(1);
    expect(usePlaybackStore.getState().currentTick?.time).toBe('2026-09-25 14:30:30.000');

    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTickIndex).toBe(0);
    expect(usePlaybackStore.getState().currentTick?.time).toBe('2026-09-25 14:30:00.000');
  });

  it('renders STEP dropdown in PlaybackBar and updates store on selection change', () => {
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

    const stepSelect = screen.getByTestId('playback-step-select') as HTMLSelectElement;
    expect(stepSelect).toBeInTheDocument();
    expect(stepSelect.value).toBe('3');

    // Change to 2m
    fireEvent.change(stepSelect, { target: { value: '2' } });
    expect(usePlaybackStore.getState().stepMinutes).toBe(2);
    expect(screen.getByTestId('step-forward-btn')).toHaveAttribute('title', 'Step 2m Forward');
    expect(screen.getByTestId('step-backward-btn')).toHaveAttribute('title', 'Step 2m Backward');

    // Change to 3m
    fireEvent.change(stepSelect, { target: { value: '3' } });
    expect(usePlaybackStore.getState().stepMinutes).toBe(3);
    expect(screen.getByTestId('step-forward-btn')).toHaveAttribute('title', 'Step 3m Forward');
    expect(screen.getByTestId('step-backward-btn')).toHaveAttribute('title', 'Step 3m Backward');

    // Change to 5m
    fireEvent.change(stepSelect, { target: { value: '5' } });
    expect(usePlaybackStore.getState().stepMinutes).toBe(5);
    expect(screen.getByTestId('step-forward-btn')).toHaveAttribute('title', 'Step 5m Forward');
    expect(screen.getByTestId('step-backward-btn')).toHaveAttribute('title', 'Step 5m Backward');

    // Change to 10m
    fireEvent.change(stepSelect, { target: { value: '10' } });
    expect(usePlaybackStore.getState().stepMinutes).toBe(10);
    expect(screen.getByTestId('step-forward-btn')).toHaveAttribute('title', 'Step 10m Forward');

    // Change to 15m
    fireEvent.change(stepSelect, { target: { value: '15' } });
    expect(usePlaybackStore.getState().stepMinutes).toBe(15);
    expect(screen.getByTestId('step-forward-btn')).toHaveAttribute('title', 'Step 15m Forward');

    // Change to 1 tick (0)
    fireEvent.change(stepSelect, { target: { value: '0' } });
    expect(usePlaybackStore.getState().stepMinutes).toBe(0);
    expect(screen.getByTestId('step-forward-btn')).toHaveAttribute('title', 'Step 1 Tick Forward');
    expect(screen.getByTestId('step-backward-btn')).toHaveAttribute('title', 'Step 1 Tick Backward');
  });

  it('clicking step forward in UI advances currentTime according to selected step', () => {
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

    const stepSelect = screen.getByTestId('playback-step-select');
    fireEvent.change(stepSelect, { target: { value: '5' } });

    const stepForwardBtn = screen.getByTestId('step-forward-btn');
    fireEvent.click(stepForwardBtn);

    expect(usePlaybackStore.getState().currentTime).toBe(isoToMs('2026-09-25 14:35:00.000'));
  });

  it('defaults to 3m step and is not overwritten by chart workspace timeframe', () => {
    usePlaybackStore.setState({ stepMinutes: 3 });
    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="SPY"
        onResetToOpen={vi.fn()}
        minStepMinutes={5}
      />
    );

    const stepSelect = screen.getByTestId('playback-step-select') as HTMLSelectElement;
    expect(stepSelect.value).toBe('3');
    expect(usePlaybackStore.getState().stepMinutes).toBe(3);
  });
});

