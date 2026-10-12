import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useAccountPlaybackSync } from '../../src/hooks/useAccountPlaybackSync';
import { useAccountStore } from '../../src/store/useAccountStore';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { BTCUSD_RULES, trainingProfile } from '../../src/lib/orderSimulator/profiles';
import type { Quote } from '../../src/lib/orderSimulator/types';

/**
 * The account must follow the chart playhead.
 *
 * This suite exists because nothing did. The account store and the playback store are independent,
 * and the only thing that ever advanced a session from the playhead — `useOrderSimulator` — had no
 * call site in the application. Every other test in this repository drives the engine directly, so
 * all of them passed while the running app never moved the account's clock: orders were accepted and
 * left unfilled, no position ever opened, the trade badge never appeared, and the ticket never had a
 * quote to price against. A browser found this; nothing here could.
 *
 * So these tests deliberately do NOT touch the engine. They move the playhead the way `PlaybackManager`
 * does and then ask the account whether anything happened.
 */

const SYMBOL = 'BTCUSD';
const SIZE = 1;

function tape(count = 30): Quote[] {
  return Array.from({ length: count }, (_, i) => {
    const bid = Math.round((100 + i * 0.1) * 100) / 100;
    return {
      symbol: SYMBOL,
      bid,
      ask: Math.round((bid + 0.5) * 100) / 100,
      replayMs: i * 1_000,
      seq: i + 1,
    };
  });
}

/** The wire under test, mounted the way the application mounts it. */
function Harness() {
  useAccountPlaybackSync();
  return null;
}

/** Move the playhead exactly as a frame of playback does. */
function playheadTo(ms: number, overrides: Record<string, unknown> = {}) {
  act(() => {
    usePlaybackStore.setState({
      currentTime: ms,
      currentTickIndex: Math.floor(ms / 1_000),
      isPaused: false,
      ...overrides,
    });
  });
}

beforeEach(() => {
  useAccountStore.getState().configure({
    instruments: [BTCUSD_RULES],
    profile: trainingProfile(),
    sessionId: 'sync-test',
  });
  useAccountStore.getState().registerTape(SYMBOL, tape());
  usePlaybackStore.setState({
    currentTime: 0,
    currentTickIndex: 0,
    currentTick: null,
    bufferedTicks: [],
    isPaused: true,
    seekEpoch: 0,
  });
  // A fresh store per test, with no conversation between the two clocks.
  useAccountStore.setState({ revision: 0 });
});

describe('the account follows the playhead', () => {
  it('fills an order that was accepted while the playhead was still', () => {
    render(<Harness />);

    const result = useAccountStore.getState().openPosition({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
    });
    expect(result.ok).toBe(true);

    // Nothing has moved yet: an accepted instruction is not a fill, and the engine's clock is still.
    expect(useAccountStore.getState().state.fills).toHaveLength(0);

    playheadTo(5_000);

    // The playhead crossed the execution window, so the account had to execute.
    expect(useAccountStore.getState().state.fills.length).toBeGreaterThan(0);
  });

  it('opens a position once the playhead reaches the fill', () => {
    render(<Harness />);

    useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    expect(useAccountStore.getState().state.positions).toHaveLength(0);

    playheadTo(5_000);

    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(1);
    // The badge and the ticket both key off this: an OPEN position is what makes a trade visible.
    expect(positions[0].state).toBe('OPEN');
  });

  it('prices the ticket from the quote the playhead is standing on', () => {
    render(<Harness />);

    // The ticket reads `lastQuoteBySymbol`. At the anchor that is the tape's first quote, at t=0.
    expect(useAccountStore.getState().state.lastQuoteBySymbol?.[SYMBOL]?.bid).toBe(100);

    playheadTo(1_000);

    // One second later it must be the next quote, not a stale one and not an invention.
    expect(useAccountStore.getState().state.lastQuoteBySymbol?.[SYMBOL]?.bid).toBe(100.1);
  });

  it('keeps the session clock in step with the playhead', () => {
    render(<Harness />);

    playheadTo(7_000);
    expect(useAccountStore.getState().state.nowMs).toBe(7_000);

    playheadTo(9_000);
    expect(useAccountStore.getState().state.nowMs).toBe(9_000);
  });

  it('does not re-render the tree for a playhead that moved without crossing a quote', () => {
    render(<Harness />);
    playheadTo(5_000);

    const before = useAccountStore.getState().revision;
    // One millisecond of ordinary playback: the session advances, but nothing about the account
    // changed, so React must not be told. This is what keeps 25x playback from re-rendering per frame.
    playheadTo(5_001);

    expect(useAccountStore.getState().revision).toBe(before);
  });

  it('rewinds the account with the playhead, through a rebranch rather than a reversal', () => {
    render(<Harness />);

    useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    playheadTo(5_000);
    const filled = useAccountStore.getState().state.fills.length;
    expect(filled).toBeGreaterThan(0);

    // Seeking back to before the fill is a branch, not a rewind of the same history: the branch no
    // longer contains the execution, so the fill must be gone rather than carried over.
    act(() => {
      usePlaybackStore.setState({ currentTime: 100, currentTickIndex: 0, isPaused: true, seekEpoch: 1 });
    });

    const state = useAccountStore.getState().state;
    expect(state.nowMs).toBe(100);
    expect(state.fills).toHaveLength(0);
  });
});
