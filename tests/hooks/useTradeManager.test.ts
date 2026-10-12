import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTradeManager } from '../../src/hooks/useTradeManager';
import { useAccountStore } from '../../src/store/useAccountStore';
import { BTCUSD_RULES, trainingProfile } from '../../src/lib/orderSimulator/profiles';
import type { ChartBar } from '../../src/types';
import type { Quote } from '../../src/lib/orderSimulator/types';

/**
 * `useTradeManager` is a VIEW over the shared account.
 *
 * This file previously asserted netting: a second order averaged into the entry price, a larger
 * opposite order flipped the position, and an equal opposite order closed it. SIM-ACCOUNT-03 removes
 * that model deliberately — two entries are two positions — so these tests now assert the honest
 * behaviour instead of the behaviour that was removed.
 */

const SYMBOL = 'BTCUSD';

const mockChartData: ChartBar[] = [{ time: 1600000000, open: 100, high: 105, low: 95, close: 100, volume: 1000 }];

function tape(count = 40): Quote[] {
  return Array.from({ length: count }, (_, i) => {
    const bid = Math.round((100 + i * 0.25) * 100) / 100;
    return { symbol: SYMBOL, bid, ask: Math.round((bid + 0.5) * 100) / 100, replayMs: i * 1_000, seq: i + 1 };
  });
}

function seedAccount() {
  useAccountStore.getState().configure({ instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'hook-account' });
  useAccountStore.getState().registerTape(SYMBOL, tape());
  useAccountStore.getState().advanceTo(1_000, 'PLAY');
}

function renderTradeManager() {
  return renderHook(() => useTradeManager({ chartData: mockChartData, ticker: SYMBOL }));
}

beforeEach(() => {
  seedAccount();
});

describe('useTradeManager — placing orders', () => {
  it('places a long order that becomes an open LONG position', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    expect(result.current.activeTrade).not.toBeNull();
    expect(result.current.activeTrade?.type).toBe('long');
    expect(result.current.activeTrade?.size).toBe(1);
    // Filled at the ask of the quote available when the instruction ARRIVED (t=1100), not at the
    // chart's fallback price and not at some later frame's quote. The tape drifts 0.25/s, so the
    // quote at 1 s is 100.25/100.75.
    expect(result.current.activeTrade?.entryPrice).toBe(100.75);
  });

  it('places a short order that becomes an open SHORT position', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('short');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    expect(result.current.activeTrade?.type).toBe('short');
    // A SELL fills at the bid of the quote available at arrival (t=1100).
    expect(result.current.activeTrade?.entryPrice).toBe(100.25);
  });

  it('freezes rather than inventing a price when the exposed symbol has no tape', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });
    expect(useAccountStore.getState().state.positions).toHaveLength(1);

    // Now the tape for this symbol is gone, so a new order has nothing to execute against.
    act(() => {
      useAccountStore.getState().registerTape('BTCUSD', []);
      const second = result.current.placeOrder('long');
      // Accepted at the client: whether it can fill is the broker's judgement, not the ticket's.
      expect(second.ok).toBe(true);
    });
    act(() => {
      useAccountStore.getState().advanceTo(9_000, 'PLAY');
    });

    // The account FROZE rather than filling against a price it does not have. That is the correct
    // outcome: no phantom fill, no second position, and the reason is reported.
    expect(useAccountStore.getState().state.positions).toHaveLength(1);
    expect(useAccountStore.getState().session.nowMs).toBeLessThan(9_000);
    const freezeNotice = useAccountStore.getState().notices.find((n) => /frozen|exhausted|no tape/i.test(n));
    expect(freezeNotice ?? useAccountStore.getState().session.notices.find((n) => /frozen/i.test(n))).toBeTruthy();
  });
});

describe('useTradeManager — entries are independent (SIM-ACCOUNT-03)', () => {
  it('a second same-side order opens a SECOND position instead of averaging in', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });
    const first = useAccountStore.getState().state.positions[0];

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });

    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(2);
    // The original position is untouched: no cumulative entry price, no merged size.
    const stillFirst = positions.find((p) => p.positionId === first.positionId)!;
    expect(stillFirst.entryPrice).toBe(first.entryPrice);
    expect(stillFirst.size).toBe(first.size);
    expect(new Set(positions.map((p) => p.positionId)).size).toBe(2);
  });

  it('an opposite order opens another position instead of flipping', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });
    act(() => {
      result.current.setTradeSize(5);
      result.current.placeOrder('short');
    });
    act(() => {
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });

    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(2);
    expect(positions.map((p) => p.direction).sort()).toEqual(['LONG', 'SHORT']);
    // The long is STILL OPEN. There is no flip and no leftover net position.
    expect(positions.find((p) => p.direction === 'LONG')!.state).toBe('OPEN');
    expect(positions.find((p) => p.direction === 'LONG')!.openSize).toBe(1);
    expect(useAccountStore.getState().state.realizedPnl).toBe(0);
  });

  it('an opposite order matching the size does not close the position', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });
    act(() => {
      result.current.placeOrder('short');
    });
    act(() => {
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });

    expect(useAccountStore.getState().state.positions).toHaveLength(2);
    expect(result.current.activeTrade).not.toBeNull();
  });
});

describe('useTradeManager — closing and protecting', () => {
  it('closes by position id through an engine command', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });
    const positionId = useAccountStore.getState().state.positions[0].positionId;

    act(() => {
      result.current.closePosition(positionId);
    });
    act(() => {
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });

    const position = useAccountStore.getState().state.positions[0];
    expect(position.state).toBe('CLOSED');
    expect(result.current.activeTrade).toBeNull();
    // Exactly one closing fill: the size was not closed twice.
    expect(useAccountStore.getState().state.fills.filter((f) => f.side === 'SELL')).toHaveLength(1);
  });

  it('reports an error when asked to close with nothing open', () => {
    const { result } = renderTradeManager();
    let outcome: { ok: boolean; error: string | null } | null = null;
    act(() => {
      outcome = result.current.closePosition();
    });
    expect(outcome!.ok).toBe(false);
    expect(outcome!.error).toMatch(/no open position/i);
  });

  it('exposes every open position on the symbol, not just the latest', () => {
    const { result } = renderTradeManager();

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

    expect(result.current.openPositions).toHaveLength(2);
  });

  it('opens a bare position with no protection, and attaches it only on request', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    // Default attachments are OFF.
    const position = useAccountStore.getState().state.positions[0];
    expect(position.slOrderId).toBeNull();
    expect(result.current.activeTrade?.slPrice).toBe(0);

    act(() => {
      useAccountStore.getState().protect(position.positionId, { stopLoss: 95 });
    });
    expect(useAccountStore.getState().state.positions[0].slOrderId).not.toBeNull();
    expect(result.current.activeTrade?.slPrice).toBe(95);
  });

  it('refuses to amend protection that does not exist', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    let outcome: { ok: boolean; error: string | null } | null = null;
    act(() => {
      outcome = result.current.amendProtection('sl', 95);
    });
    expect(outcome!.ok).toBe(false);
    expect(outcome!.error).toMatch(/no stop-loss/i);
  });

  it('amends a stop through the engine, bumping its version', () => {
    const { result } = renderTradeManager();

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      const position = useAccountStore.getState().state.positions[0];
      useAccountStore.getState().protect(position.positionId, { stopLoss: 95 });
    });

    act(() => {
      result.current.amendProtection('sl', 96);
    });
    // An amendment is an instruction too: it needs travel time before the broker applies it.
    act(() => {
      useAccountStore.getState().advanceTo(12_000, 'PLAY');
    });

    const stops = useAccountStore.getState().state.orders.filter((o) => o.purpose === 'STOP_LOSS');
    const live = stops.find((o) => o.state === 'WORKING');
    expect(live!.level).toBe(96);
    expect(live!.version).toBe(1);
  });
});

describe('useTradeManager — it is a view, not an owner', () => {
  it('reports the ACCOUNT PnL, identical for every chart', () => {
    const chartA = renderTradeManager();
    const chartB = renderTradeManager();

    act(() => {
      chartA.result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      const position = useAccountStore.getState().state.positions[0];
      useAccountStore.getState().closePosition(position.positionId);
    });
    act(() => {
      useAccountStore.getState().advanceTo(25_000, 'PLAY');
    });

    expect(chartA.result.current.realizedPnL).toBe(chartB.result.current.realizedPnL);
    expect(chartA.result.current.realizedPnL).toBe(useAccountStore.getState().totals.realizedPnl);
  });

  it('unmounting a chart does not disturb the account', () => {
    const chartA = renderTradeManager();
    const chartB = renderTradeManager();

    act(() => {
      chartA.result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });
    const before = useAccountStore.getState().totals;

    chartB.unmount();

    expect(useAccountStore.getState().totals).toEqual(before);
    expect(useAccountStore.getState().state.positions).toHaveLength(1);
  });

  it('both charts see the same position id', () => {
    const chartA = renderTradeManager();
    const chartB = renderTradeManager();

    act(() => {
      chartA.result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });

    expect(chartA.result.current.openPositions[0].positionId).toBe(chartB.result.current.openPositions[0].positionId);
  });
});
