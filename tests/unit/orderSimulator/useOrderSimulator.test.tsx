import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOrderSimulator } from '../../../src/hooks/useOrderSimulator';
import { usePlaybackStore } from '../../../src/store/usePlaybackStore';
import { BTCUSD_RULES, trainingProfile } from '../../../src/lib/orderSimulator/profiles';
import type { MarketTick } from '../../../src/types';

/**
 * The React binding. The economics are already covered by the replay suite; what matters here is
 * that the hook subscribes to the playhead's own buffer (so no tick is dropped) and that a command
 * issued from a component is reflected in the returned state.
 */

const SYMBOL = 'BTCUSD';

function makeTicks(count: number, startMs = Date.UTC(2026, 0, 5, 14, 30, 0)): MarketTick[] {
  return Array.from({ length: count }, (_, i) => ({
    time: new Date(startMs + i * 1_000).toISOString(),
    symbol: SYMBOL,
    price: Math.round((82_900 + i * 0.5) * 100) / 100,
    volume: 1,
    session: 'REG' as const,
  }));
}

beforeEach(() => {
  usePlaybackStore.getState().reset();
});

describe('useOrderSimulator', () => {
  it('creates a session and exposes an empty account', () => {
    const { result } = renderHook(() =>
      useOrderSimulator({ symbols: [SYMBOL], instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'hook-1' }),
    );
    expect(result.current.session).toBeDefined();
    expect(result.current.state.positions).toHaveLength(0);
    expect(result.current.state.fills).toHaveLength(0);
    expect(result.current.exposedSymbols).toEqual([]);
  });

  it('consumes the playhead buffer and advances with it', () => {
    const ticks = makeTicks(30);
    const { result } = renderHook(() =>
      useOrderSimulator({ symbols: [SYMBOL], instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'hook-2' }),
    );

    act(() => {
      usePlaybackStore.getState().setBufferedTicks(ticks);
      usePlaybackStore.getState().addSymbolTicks(SYMBOL, ticks);
    });

    // The tape is registered from the playhead's own buffer, not from a single "latest tick".
    // The assertion is against the store itself, because `addSymbolTicks` also appends to
    // `bufferedTicks`; what matters is that the session consumed exactly what the playhead holds.
    const storeBuffered = usePlaybackStore.getState().bufferedTicks.length;
    expect(result.current.session.quoteCount).toBe(storeBuffered);
    expect(storeBuffered).toBeGreaterThan(0);
  });

  it('reflects a submitted order in the returned state after refresh', () => {
    const ticks = makeTicks(30);
    const { result } = renderHook(() =>
      useOrderSimulator({ symbols: [SYMBOL], instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'hook-3' }),
    );

    act(() => {
      usePlaybackStore.getState().setBufferedTicks(ticks);
      usePlaybackStore.getState().addSymbolTicks(SYMBOL, ticks);
      usePlaybackStore.getState().advanceSimulationTime(new Date(ticks[5].time).getTime());
    });

    act(() => {
      result.current.session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: 0.01 });
      result.current.session.advanceTo(new Date(ticks[20].time).getTime(), 'PLAY');
      result.current.refresh();
    });

    expect(result.current.state.orders).toHaveLength(1);
    expect(result.current.state.fills).toHaveLength(1);
    expect(result.current.exposedSymbols).toContain(SYMBOL);
  });

  it('ignores a symbol it has no instrument rules for', () => {
    const ticks = makeTicks(5).map((t) => ({ ...t, symbol: 'EURUSD' }));
    const { result } = renderHook(() =>
      useOrderSimulator({ symbols: ['EURUSD'], instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'hook-4' }),
    );

    act(() => {
      usePlaybackStore.getState().setBufferedTicks(ticks);
      usePlaybackStore.getState().addSymbolTicks('EURUSD', ticks);
    });

    // No rules means no tape: the simulator never invents a tick size for an unknown instrument.
    expect(result.current.session.quoteCount).toBe(0);
  });

  it('survives a store reset without leaking the previous session', () => {
    const ticks = makeTicks(10);
    const { result } = renderHook(() =>
      useOrderSimulator({ symbols: [SYMBOL], instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'hook-5' }),
    );

    // Two acts, because tape registration is an effect: in a real session the data arrives, React
    // re-renders, the effect registers the tape, and only then does the user trade. Collapsing the
    // data load and the trade into one synchronous block would be testing a situation that cannot
    // happen in the app.
    act(() => {
      usePlaybackStore.getState().setBufferedTicks(ticks);
      usePlaybackStore.getState().addSymbolTicks(SYMBOL, ticks);
      usePlaybackStore.getState().advanceSimulationTime(new Date(ticks[5].time).getTime());
    });
    act(() => {
      result.current.session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: 0.01 });
      result.current.session.advanceTo(new Date(ticks[9].time).getTime(), 'PLAY');
      result.current.refresh();
    });
    expect(result.current.state.fills).toHaveLength(1);

    act(() => {
      usePlaybackStore.getState().reset();
    });

    // The playhead reset does not by itself wipe the account: an explicit session reset does, so
    // that a chart reset cannot silently erase realised PnL.
    const before = result.current.session.currentSessionId;
    act(() => {
      result.current.session.reset();
      result.current.refresh();
    });
    expect(result.current.session.currentSessionId).not.toBe(before);
    expect(result.current.state.fills).toHaveLength(0);
    expect(result.current.state.realizedPnl).toBe(0);
  });
});
