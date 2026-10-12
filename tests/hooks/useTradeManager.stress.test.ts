import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTradeManager } from '../../src/hooks/useTradeManager';
import { useAccountStore } from '../../src/store/useAccountStore';
import { BTCUSD_RULES, trainingProfile } from '../../src/lib/orderSimulator/profiles';
import type { ChartBar } from '../../src/types';
import type { Quote } from '../../src/lib/orderSimulator/types';

/**
 * Stress behaviour under the independent-positions model.
 *
 * The old version of this file asserted netting: five rapid orders produced one position of size 5,
 * and two orders averaged their entry prices. SIM-ACCOUNT-03 removes netting, so five rapid orders
 * now produce five positions — which is a stricter thing to get right, because each one needs its own
 * identity and its own accounting without any of them interfering.
 */

const SYMBOL = 'BTCUSD';

const mockChartData: ChartBar[] = [{ time: 1600000000, open: 100, high: 105, low: 95, close: 100, volume: 1000 }];

function tape(count = 40): Quote[] {
  return Array.from({ length: count }, (_, i) => {
    const bid = Math.round((100 + i * 0.25) * 100) / 100;
    return { symbol: SYMBOL, bid, ask: Math.round((bid + 0.5) * 100) / 100, replayMs: i * 1_000, seq: i + 1 };
  });
}

function seed() {
  useAccountStore.getState().configure({ instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'stress' });
  useAccountStore.getState().registerTape(SYMBOL, tape());
  useAccountStore.getState().advanceTo(1_000, 'PLAY');
}

function renderTm() {
  return renderHook(() => useTradeManager({ chartData: mockChartData, ticker: SYMBOL }));
}

beforeEach(() => {
  seed();
});

describe('useTradeManager STRESS TESTS', () => {
  it('keeps exact accounting for positions opened at nearly identical prices', () => {
    // The tape is uniform so both entries fill at the same ask; the point is that each position
    // keeps its OWN entry price and size rather than being averaged into a shared one.
    const { result } = renderTm();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });

    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(2);
    // No averaging: each position keeps its own entry price, whatever it filled at, and its own
    // full size. The two fills happened at different times, so their prices legitimately differ.
    for (const position of positions) {
      expect(position.size).toBe(1);
      expect(position.openSize).toBe(1);
      const fill = useAccountStore.getState().state.fills.find((f) => f.positionId === position.positionId)!;
      expect(position.entryPrice).toBe(fill.price);
    }
    expect(positions[0].entryPrice).not.toBe(positions[1].entryPrice);
    // Realized PnL is still zero: two entries are not a round trip.
    expect(useAccountStore.getState().state.realizedPnl).toBe(0);
  });

  it('refuses a zero or negative size instead of opening an empty position', () => {
    const { result } = renderTm();

    act(() => {
      result.current.setTradeSize(0);
    });

    let outcome: { ok: boolean; error: string | null } | null = null;
    act(() => {
      outcome = result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    // The ticket is refused by the engine, with a reason, and nothing is opened.
    expect(outcome!.ok).toBe(false);
    expect(outcome!.error).toMatch(/positive number/);
    expect(useAccountStore.getState().state.positions).toHaveLength(0);
    expect(useAccountStore.getState().state.fills).toHaveLength(0);
  });

  it('places five rapid-fire orders as five independent positions', () => {
    const { result } = renderTm();

    for (let i = 0; i < 5; i++) {
      act(() => {
        result.current.placeOrder('long');
      });
    }
    act(() => {
      useAccountStore.getState().advanceTo(20_000, 'PLAY');
    });

    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(5);
    // Every position has a distinct identity, and none of them absorbed another.
    expect(new Set(positions.map((p) => p.positionId)).size).toBe(5);
    expect(positions.every((p) => p.size === 1 && p.openSize === 1)).toBe(true);

    // And five fills, one per order: nothing was merged or dropped.
    expect(useAccountStore.getState().state.fills).toHaveLength(5);
    expect(new Set(useAccountStore.getState().state.fills.map((f) => f.orderId)).size).toBe(5);
  });

  it('resolves same-instant orders in submission order', () => {
    const { result } = renderTm();

    // All five submitted at the same replay instant, so they all arrive together. The engine breaks
    // the tie on insertion order, so the fills must come out in the order they were placed.
    for (let i = 0; i < 5; i++) {
      act(() => {
        result.current.placeOrder('long');
      });
    }
    act(() => {
      useAccountStore.getState().advanceTo(20_000, 'PLAY');
    });

    const fills = useAccountStore.getState().state.fills;
    const orderIds = fills.map((f) => Number(String(f.orderId).replace('O-', '')));
    expect(orderIds).toEqual([...orderIds].sort((a, b) => a - b));
    expect(fills.map((f) => f.fillId)).toEqual(['F-1', 'F-2', 'F-3', 'F-4', 'F-5']);
  });

  it('closing one of many positions leaves the rest untouched', () => {
    const { result } = renderTm();

    for (let i = 0; i < 3; i++) {
      act(() => {
        result.current.placeOrder('long');
      });
    }
    act(() => {
      useAccountStore.getState().advanceTo(20_000, 'PLAY');
    });

    const positions = useAccountStore.getState().state.positions;
    const target = positions[1].positionId;

    act(() => {
      result.current.closePosition(target);
    });
    act(() => {
      useAccountStore.getState().advanceTo(30_000, 'PLAY');
    });

    const after = useAccountStore.getState().state.positions;
    expect(after.find((p) => p.positionId === target)!.state).toBe('CLOSED');
    // The other two are untouched.
    expect(after.filter((p) => p.state === 'OPEN')).toHaveLength(2);
    // One closing fill, not three.
    expect(useAccountStore.getState().state.fills.filter((f) => f.side === 'SELL')).toHaveLength(1);
  });

  it('survives a long burst without drifting the account total', () => {
    const { result } = renderTm();

    for (let i = 0; i < 20; i++) {
      act(() => {
        result.current.placeOrder('long');
      });
    }
    act(() => {
      useAccountStore.getState().advanceTo(39_000, 'PLAY');
    });

    const state = useAccountStore.getState().state;
    expect(state.positions).toHaveLength(20);
    expect(state.fills).toHaveLength(20);

    // The projection and the engine agree exactly: no accumulation drift from 20 reads.
    const totals = useAccountStore.getState().totals;
    expect(totals.realizedPnl).toBe(state.realizedPnl);
    expect(totals.openPositionCount).toBe(20);
  });
});
