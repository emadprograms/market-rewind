import { describe, it, expect, beforeEach } from 'vitest';
import { useAccountStore, selectRealizedPnl, selectTotalPnl, selectSessionId } from '../../../src/store/useAccountStore';
import { BTCUSD_RULES, trainingProfile } from '../../../src/lib/orderSimulator/profiles';
import { projectForSymbol } from '../../../src/lib/orderSimulator/accountProjection';
import type { PositionId, Quote } from '../../../src/lib/orderSimulator/types';

/**
 * SIM-ACCOUNT-01 / -02 / -03 — the shared account store.
 *
 * The store is the only thing in the app that may change economic state, and it may only do so by
 * dispatching an engine command. These tests attack that claim from the outside: they read the store
 * repeatedly, poke at it the way a React selector or a chart effect would, and assert nothing moves.
 */

const SYMBOL = 'BTCUSD';
const SIZE = 0.01;

function tape(count = 40, startMs = 0): Quote[] {
  return Array.from({ length: count }, (_, i) => {
    const bid = Math.round((100 + Math.sin(i / 5) * 3) * 100) / 100;
    return { symbol: SYMBOL, bid, ask: Math.round((bid + 0.5) * 100) / 100, replayMs: startMs + i * 1_000, seq: i + 1 };
  });
}

function freshStore(quotes = tape()) {
  const store = useAccountStore.getState();
  store.configure({ instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: `store-test-${Math.random()}` });
  useAccountStore.getState().registerTape(SYMBOL, quotes);
  return useAccountStore.getState();
}

beforeEach(() => {
  freshStore();
});

// ---------------------------------------------------------------------------
// SIM-ACCOUNT-01 — engine-authoritative trading
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-01 — only engine commands change economics', () => {
  it('opens a position through the store and records it as a fill', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    const result = store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    expect(result.ok).toBe(true);
    expect(result.orderId).not.toBeNull();

    useAccountStore.getState().advanceTo(5_000, 'PLAY');
    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(1);
    expect(positions[0].direction).toBe('LONG');
  });

  it('exposes no way to set a position or a PnL total directly', () => {
    const store = useAccountStore.getState();
    const mutatorNames = Object.keys(store).filter((key) => typeof (store as Record<string, unknown>)[key] === 'function');
    // Every mutator is a command or a transport operation; none of them is a setter for economics.
    for (const name of mutatorNames) {
      expect(name, `${name} looks like a direct economic setter`).not.toMatch(
        /^set(Position|Pnl|PnL|Realized|Unrealized|Balance|Fill)/,
      );
    }
    expect(mutatorNames).toContain('openPosition');
    expect(mutatorNames).toContain('closePosition');
  });

  it('a refused command changes nothing', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    const before = store.state.fills.length;

    const refused = store.openPosition({ symbol: 'NOT_A_SYMBOL', side: 'BUY', size: SIZE });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/Unsupported symbol/);
    expect(useAccountStore.getState().state.fills.length).toBe(before);
    expect(useAccountStore.getState().state.orders).toHaveLength(0);
  });

  it('repeated refreshes never manufacture economics', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');

    const fillsBefore = useAccountStore.getState().state.fills.length;
    const pnlBefore = useAccountStore.getState().totals.realizedPnl;
    const positionsBefore = useAccountStore.getState().state.positions.length;

    // A selector-heavy render, a Strict Mode double effect, a badge re-measuring itself: all reads.
    for (let i = 0; i < 25; i++) useAccountStore.getState().refresh();

    expect(useAccountStore.getState().state.fills.length).toBe(fillsBefore);
    expect(useAccountStore.getState().state.positions.length).toBe(positionsBefore);
    expect(useAccountStore.getState().totals.realizedPnl).toBe(pnlBefore);
  });

  it('a revision counter moves so views can re-render without mutating anything', () => {
    const before = useAccountStore.getState().revision;
    useAccountStore.getState().refresh();
    expect(useAccountStore.getState().revision).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// SIM-ACCOUNT-02 — one account regardless of charts
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-02 — one account, however many charts look at it', () => {
  it('two charts on the same symbol see one position and one total', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');

    const state = useAccountStore.getState().state;
    // Chart A and chart B both project the same symbol.
    const chartA = projectForSymbol(state, SYMBOL);
    const chartB = projectForSymbol(state, SYMBOL);

    expect(chartA.positions).toHaveLength(1);
    expect(chartB.positions).toHaveLength(1);
    // The same position id, not two positions that happen to look alike.
    expect(chartA.positions[0].positionId).toBe(chartB.positions[0].positionId);

    // And one portfolio total, independent of chart count.
    const total = selectTotalPnl(useAccountStore.getState());
    const projectedTotal = selectTotalPnl(useAccountStore.getState());
    expect(projectedTotal).toBe(total);
  });

  it('closing once closes it for every chart', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');

    const position = useAccountStore.getState().state.positions[0];
    useAccountStore.getState().closePosition(position.positionId);
    useAccountStore.getState().advanceTo(9_000, 'PLAY');

    expect(projectForSymbol(useAccountStore.getState().state, SYMBOL).openPositions).toHaveLength(0);
    // One closing fill, so the size was closed once even though two charts showed it.
    const closing = useAccountStore.getState().state.fills.filter((f) => f.side === 'SELL');
    expect(closing).toHaveLength(1);
  });

  it('a chart switching symbols cannot alter an existing position', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');

    const before = useAccountStore.getState().state.positions[0];
    // The chart now looks at ETHUSD instead. That is a read of a different symbol.
    projectForSymbol(useAccountStore.getState().state, 'ETHUSD');
    const after = useAccountStore.getState().state.positions[0];

    expect(after.positionId).toBe(before.positionId);
    expect(after.symbol).toBe(before.symbol);
    expect(after.entryPrice).toBe(before.entryPrice);
    expect(selectRealizedPnl(useAccountStore.getState())).toBe(0);
  });

  it('reports the same realized PnL to every reader', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');
    const position = useAccountStore.getState().state.positions[0];
    useAccountStore.getState().closePosition(position.positionId);
    useAccountStore.getState().advanceTo(9_000, 'PLAY');

    const reads = Array.from({ length: 5 }, () => selectRealizedPnl(useAccountStore.getState()));
    expect(new Set(reads).size).toBe(1);
    expect(reads[0]).not.toBe(0);
    // The engine and the projection agree.
    expect(reads[0]).toBeCloseTo(useAccountStore.getState().state.realizedPnl, 9);
  });
});

// ---------------------------------------------------------------------------
// SIM-ACCOUNT-03 — independent positions, no netting
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-03 — entries open independent positions', () => {
  it('a second same-side entry opens a second position instead of averaging in', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');
    useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(9_000, 'PLAY');

    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(2);
    expect(new Set(positions.map((p) => p.positionId)).size).toBe(2);
    // No averaging: each keeps its own entry price.
    expect(positions[0].entryPrice).not.toBe(positions[1].entryPrice);
    expect(positions.every((p) => p.size === SIZE)).toBe(true);
  });

  it('an opposite entry opens another position; it does not close or flip the first', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');
    useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'SELL', size: SIZE });
    useAccountStore.getState().advanceTo(9_000, 'PLAY');

    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(2);
    expect(positions.map((p) => p.direction).sort()).toEqual(['LONG', 'SHORT']);
    // The long is still open: a counter-order is a new position, not an implicit close.
    expect(positions.every((p) => p.state === 'OPEN')).toBe(true);
    expect(useAccountStore.getState().state.realizedPnl).toBe(0);
  });

  it('a larger opposite entry does not flip anything', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');
    useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'SELL', size: SIZE * 5 });
    useAccountStore.getState().advanceTo(9_000, 'PLAY');

    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(2);
    // The short is five times the size and the long is untouched — no netting, no leftover.
    expect(positions.find((p) => p.direction === 'SHORT')!.size).toBeCloseTo(SIZE * 5, 9);
    expect(positions.find((p) => p.direction === 'LONG')!.size).toBeCloseTo(SIZE, 9);
  });

  it('opens bare positions: no default stop-loss or take-profit', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');

    const position = useAccountStore.getState().state.positions[0];
    expect(position.slOrderId).toBeNull();
    expect(position.tpOrderId).toBeNull();
    const exits = useAccountStore.getState().state.orders.filter(
      (o) => o.purpose === 'STOP_LOSS' || o.purpose === 'TAKE_PROFIT',
    );
    expect(exits).toHaveLength(0);
  });

  it('attaches protection only when it is explicitly asked for', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE, stopLoss: 95 });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');

    const position = useAccountStore.getState().state.positions[0];
    expect(position.slOrderId).not.toBeNull();
    // Asking for a stop does not silently add a take-profit.
    expect(position.tpOrderId).toBeNull();
  });

  it('protects an open position after the fact', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');

    const position = useAccountStore.getState().state.positions[0];
    expect(position.slOrderId).toBeNull();

    useAccountStore.getState().protect(position.positionId, { stopLoss: 95 });
    expect(useAccountStore.getState().state.positions[0].slOrderId).not.toBeNull();
  });

  it('refuses to protect a position that is not open', () => {
    useAccountStore.getState().protect('P-nope' as PositionId, { stopLoss: 95 });
    expect(useAccountStore.getState().notices.at(-1)).toMatch(/Cannot protect P-nope/);
    expect(useAccountStore.getState().state.orders).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Session lifecycle through the store
// ---------------------------------------------------------------------------

describe('account store — session lifecycle', () => {
  it('a reset drops positions without inventing a closing fill or PnL', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');
    expect(useAccountStore.getState().state.positions).toHaveLength(1);

    const sessionBefore = selectSessionId(useAccountStore.getState());
    useAccountStore.getState().reset();
    const after = useAccountStore.getState();

    expect(selectSessionId(after)).not.toBe(sessionBefore);
    expect(after.state.fills).toHaveLength(0);
    expect(after.state.positions).toHaveLength(0);
    expect(after.totals.realizedPnl).toBe(0);
    expect(after.totals.unrealizedPnl).toBe(0);
  });

  it('rewinding branches rather than replaying abandoned submissions', () => {
    const store = useAccountStore.getState();
    store.advanceTo(1_000, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(20_000, 'PLAY');
    expect(useAccountStore.getState().state.fills.length).toBeGreaterThan(0);

    // Rewind to before the submission.
    useAccountStore.getState().seekTo(500);
    expect(useAccountStore.getState().state.orders).toHaveLength(0);

    // Playing forward again must not resurrect it.
    useAccountStore.getState().advanceTo(30_000, 'PLAY');
    expect(useAccountStore.getState().state.orders).toHaveLength(0);
    expect(useAccountStore.getState().state.fills).toHaveLength(0);
  });
});
