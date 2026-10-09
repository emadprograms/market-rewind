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

  it('renders visual timestamp marks along the seek track including 08:30 start, 16:00 close, and 09:30 marks', () => {
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

    // 08:30 start, 09:30 open, and 16:00 close marks must be present (09:27 removed)
    expect(marksContainer.textContent).toContain('08:30');
    expect(marksContainer.textContent).toContain('09:30');
    expect(marksContainer.textContent).toContain('16:00');
    expect(marksContainer.textContent).not.toContain('09:27');

    // Intermediate hour marks should also be present (10:00, 11:00, 12:00, etc.)
    expect(marksContainer.textContent).toContain('10:00');
    expect(marksContainer.textContent).toContain('11:00');
    expect(marksContainer.textContent).toContain('12:00');
    expect(marksContainer.textContent).toContain('13:00');
    expect(marksContainer.textContent).toContain('14:00');
    expect(marksContainer.textContent).toContain('15:00');
  });

  it('anchors seek start at 08:30 and ends at market close 16:00 even with post-market ticks', () => {
    const t0830 = isoToMs('2026-09-25 12:30:00.000');
    const t0910 = isoToMs('2026-09-25 13:10:00.000');
    const t1600 = isoToMs('2026-09-25 20:00:00.000');
    const postMarketTicks: MarketTick[] = [
      { time: '2026-09-25 13:10:00.000', symbol: 'SPY', price: 500.0, volume: 100 },
      { time: '2026-09-25 20:00:00.000', symbol: 'SPY', price: 505.0, volume: 2000 },
      // Post-market ticks at 17:30 ET (21:30 UTC)
      { time: '2026-09-25 21:30:00.000', symbol: 'SPY', price: 506.0, volume: 100 },
    ];
    usePlaybackStore.getState().setBufferedTicks(postMarketTicks);
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

    const slider = screen.getByTestId('playback-time-slider') as HTMLInputElement;
    // Seek domain starts at 08:30 (allows backing up from default 09:10 load)
    expect(Number(slider.min)).toBe(t0830);
    // Seek domain ends at market close 16:00 (not post-market 17:30)
    expect(Number(slider.max)).toBe(t1600);
    // Value remains anchored at 09:10 load in time
    expect(Number(slider.value)).toBe(t0910);
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
    // 50% between 08:30 and 16:00 is ~12:15 ET
    expect(hoverBadge.textContent).toContain('12:15');

    // Mouse leave removes the hover preview
    fireEvent.mouseLeave(scrubberWrapper);
    expect(screen.queryByTestId('playback-hover-timestamp')).toBeNull();
  });

  it('adapts timestamp mark intervals for short sessions on non-equity tickers', () => {
    // 15-minute session: 09:30 to 09:45 on 24/7 crypto ticker BTC
    const shortStart = isoToMs('2026-09-25 13:30:00.000');
    const shortEnd = isoToMs('2026-09-25 13:45:00.000');
    const shortTicks: MarketTick[] = [
      { time: '2026-09-25 13:30:00.000', symbol: 'BTC', price: 60000.0, volume: 1 },
      { time: '2026-09-25 13:45:00.000', symbol: 'BTC', price: 60100.0, volume: 5 },
    ];
    usePlaybackStore.getState().setBufferedTicks(shortTicks);
    usePlaybackStore.getState().setCurrentTime(shortStart);
    usePlaybackStore.getState().seekTickTime(shortStart);

    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="BTC"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    const marksContainer = screen.getByTestId('playback-timeline-marks');
    expect(marksContainer).toBeInTheDocument();
    expect(marksContainer.textContent).toContain('13:30');
    expect(marksContainer.textContent).toContain('13:45');
    // For 15 mins, 2-minute interval yields intermediate marks like 13:32, 13:34, etc.
    expect(marksContainer.textContent).toContain('13:32');
  });
});
