import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlaybackBar } from '../../src/components/PlaybackBar';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('Tick Replay Integration Tests', () => {
  const sampleTicks: MarketTick[] = [
    { time: '2026-09-25 14:30:00.100', symbol: 'NVDA', price: 180.0, volume: 10, bid: 179.9, ask: 180.1 },
    { time: '2026-09-25 14:30:00.350', symbol: 'NVDA', price: 180.25, volume: 5, bid: 180.2, ask: 180.3 },
    { time: '2026-09-25 14:30:01.000', symbol: 'NVDA', price: 179.9, volume: 20, bid: 179.8, ask: 180.0 },
  ];

  beforeEach(() => {
    usePlaybackStore.getState().reset();
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);
    usePlaybackStore.getState().setReplayMode('tick');
  });

  it('should render pure tick replay controls without TICK/BAR mode toggle', () => {
    render(
      <PlaybackBar
        totalRealized={150.5}
        totalUnrealized={-25.0}
        isDbLoaded={true}
        sessionTicker="NVDA"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    expect(screen.queryByText('BAR')).not.toBeInTheDocument();
    expect(screen.queryByText('$180.00')).not.toBeInTheDocument();
  });

  it('should step forward on clicking step forward button in tick mode', () => {
    usePlaybackStore.getState().setStepMinutes(0);
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

    const stepForwardBtn = screen.getByTestId('step-forward-btn');
    fireEvent.click(stepForwardBtn);

    expect(usePlaybackStore.getState().currentTickIndex).toBe(1);
    expect(usePlaybackStore.getState().currentTick?.price).toBe(180.25);
  });

  it('should step backward on clicking step backward button', () => {
    usePlaybackStore.getState().setStepMinutes(0);
    usePlaybackStore.getState().seekTickIndex(2);

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

    const stepBackwardBtn = screen.getByTestId('step-backward-btn');
    fireEvent.click(stepBackwardBtn);

    expect(usePlaybackStore.getState().currentTickIndex).toBe(1);
  });

  it('should toggle Time & Sales tape when TAPE button is clicked', () => {
    const onToggleTape = vi.fn();
    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="NVDA"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
        isTapeOpen={false}
        onToggleTape={onToggleTape}
      />
    );

    const tapeBtn = screen.getByTitle('Toggle Time & Sales Order Flow Tape');
    fireEvent.click(tapeBtn);

    expect(onToggleTape).toHaveBeenCalledTimes(1);
  });

  it('should update playback speed from dropdown', () => {
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

    const selects = screen.getAllByRole('combobox');
    const speedSelect = selects[selects.length - 1];
    fireEvent.change(speedSelect, { target: { value: '10' } });

    expect(usePlaybackStore.getState().playbackSpeed).toBe(10);
  });
});
