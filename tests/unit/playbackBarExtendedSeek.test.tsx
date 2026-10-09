import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlaybackBar } from '../../src/components/PlaybackBar';
import { usePlaybackStore, isoToMs } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('Extended Playback Seek Bar & Marked Timestamps', () => {
  // Session: 09:20 ET (13:20 UTC) to 16:00 ET (20:00 UTC) on 2026-09-25
  const t0920 = isoToMs('2026-09-25 13:20:00.000');
  const t1600 = isoToMs('2026-09-25 20:00:00.000');

  const sampleTicks: MarketTick[] = [
    { time: '2026-09-25 13:20:00.000', symbol: 'SPY', price: 500.0, volume: 100 },
    { time: '2026-09-25 13:30:00.000', symbol: 'SPY', price: 501.0, volume: 5000 },
    { time: '2026-09-25 20:00:00.000', symbol: 'SPY', price: 505.0, volume: 2000 },
  ];

  beforeEach(() => {
    usePlaybackStore.getState().reset();
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);
    usePlaybackStore.getState().setCurrentTime(t0920);
    usePlaybackStore.getState().seekTickTime(t0920);
  });

  it('renders extended seek container without restrictive maxWidth 420px', () => {
    const { container } = render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="SPY"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const seekContainer = container.querySelector('.playback-seek-container') as HTMLElement;
    expect(seekContainer).toBeInTheDocument();
    // Verify it is not capped to 420px
    expect(seekContainer.style.maxWidth).toBe('');
    expect(seekContainer.style.flexGrow || seekContainer.style.flex).toMatch(/^1/);
  });

  it('renders datalist with options for browser native tick marks', () => {
    const { container } = render(
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
    expect(slider.getAttribute('list')).toBe('playback-time-markers');

    const datalist = container.querySelector('datalist#playback-time-markers');
    expect(datalist).toBeInTheDocument();
    const options = datalist?.querySelectorAll('option');
    expect(options && options.length).toBeGreaterThan(2);
  });

  it('renders visual timestamp marks along the seek track including start, end, 09:20, and 09:30 marks', () => {
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

    const marksContainer = screen.getByTestId('playback-timeline-marks');
    expect(marksContainer).toBeInTheDocument();

    // Both 09:20 and 09:30 marks must be present in America/New_York
    expect(marksContainer.textContent).toContain('09:20');
    expect(marksContainer.textContent).toContain('09:30');
    expect(marksContainer.textContent).toContain('16:00');

    // Intermediate hour marks should also be present (10:00, 11:00, 12:00, etc.)
    expect(marksContainer.textContent).toContain('10:00');
    expect(marksContainer.textContent).toContain('11:00');
    expect(marksContainer.textContent).toContain('12:00');
    expect(marksContainer.textContent).toContain('13:00');
    expect(marksContainer.textContent).toContain('14:00');
    expect(marksContainer.textContent).toContain('15:00');
  });

  it('explicitly marks both 09:20 and 09:30 when session starts before 09:20 (e.g. 09:10)', () => {
    const t0910 = isoToMs('2026-09-25 13:10:00.000');
    const earlyTicks: MarketTick[] = [
      { time: '2026-09-25 13:10:00.000', symbol: 'SPY', price: 499.0, volume: 10 },
      { time: '2026-09-25 13:20:00.000', symbol: 'SPY', price: 500.0, volume: 100 },
      { time: '2026-09-25 13:30:00.000', symbol: 'SPY', price: 501.0, volume: 5000 },
      { time: '2026-09-25 20:00:00.000', symbol: 'SPY', price: 505.0, volume: 2000 },
    ];
    usePlaybackStore.getState().setBufferedTicks(earlyTicks);
    usePlaybackStore.getState().setCurrentTime(t0910);
    usePlaybackStore.getState().seekTickTime(t0910);

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

    const marksContainer = screen.getByTestId('playback-timeline-marks');
    expect(marksContainer).toBeInTheDocument();
    expect(marksContainer.textContent).toContain('09:10');
    expect(marksContainer.textContent).toContain('09:20');
    expect(marksContainer.textContent).toContain('09:30');
    expect(marksContainer.textContent).toContain('16:00');
  });

  it('displays hover timestamp preview on mouse move over scrubber wrapper', () => {
    const { container } = render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="SPY"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const scrubberWrapper = container.querySelector('.playback-scrubber-wrapper') as HTMLElement;
    expect(scrubberWrapper).toBeInTheDocument();

    // Mock getBoundingClientRect
    vi.spyOn(scrubberWrapper, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 0,
      width: 1000,
      height: 40,
      right: 1100,
      bottom: 40,
      x: 100,
      y: 0,
      toJSON: () => {},
    });

    // Hover over 50% of the bar (clientX = 600)
    fireEvent.mouseEnter(scrubberWrapper);
    fireEvent.mouseMove(scrubberWrapper, { clientX: 600 });

    const hoverBadge = screen.getByTestId('playback-hover-timestamp');
    expect(hoverBadge).toBeInTheDocument();
    // 50% between 09:20 and 16:00 is ~12:40 ET
    expect(hoverBadge.textContent).toContain('12:40');

    // Mouse leave removes the hover preview
    fireEvent.mouseLeave(scrubberWrapper);
    expect(screen.queryByTestId('playback-hover-timestamp')).toBeNull();
  });

  it('adapts timestamp mark intervals for short sessions', () => {
    // 15-minute session: 09:30 to 09:45
    const shortStart = isoToMs('2026-09-25 13:30:00.000');
    const shortEnd = isoToMs('2026-09-25 13:45:00.000');
    const shortTicks: MarketTick[] = [
      { time: '2026-09-25 13:30:00.000', symbol: 'SPY', price: 500.0, volume: 100 },
      { time: '2026-09-25 13:45:00.000', symbol: 'SPY', price: 502.0, volume: 500 },
    ];
    usePlaybackStore.getState().setBufferedTicks(shortTicks);
    usePlaybackStore.getState().setCurrentTime(shortStart);
    usePlaybackStore.getState().seekTickTime(shortStart);

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

    const marksContainer = screen.getByTestId('playback-timeline-marks');
    expect(marksContainer).toBeInTheDocument();
    expect(marksContainer.textContent).toContain('09:30');
    expect(marksContainer.textContent).toContain('09:45');
    // For 15 mins, 2-minute interval yields intermediate marks like 09:32, 09:34, etc.
    expect(marksContainer.textContent).toContain('09:32');
  });
});
