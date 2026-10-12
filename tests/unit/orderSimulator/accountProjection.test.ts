import { describe, it, expect } from 'vitest';
import { makeEngine } from '../../../src/lib/orderSimulator/__testkit__/harness';
import {
  closingGroupFor,
  projectAccountTotals,
  projectForSymbol,
  projectGroupedMarkers,
  projectMarkers,
} from '../../../src/lib/orderSimulator/accountProjection';
import { trainingProfile } from '../../../src/lib/orderSimulator/profiles';
import type { AccountState } from '../../../src/lib/orderSimulator/types';

/**
 * SIM-ACCOUNT-02 and SIM-ACCOUNT-05 — projections.
 *
 * The property under test is that a projection is a pure READ. It cannot mutate the account, it
 * cannot accumulate, and calling it from one chart or five charts gives the same answer. Anything
 * that could double-count has to be ruled out here, because a chart cannot be trusted to be the only
 * one looking at the account.
 */

const SYMBOL = 'BTCUSD';
const OTHER = 'ETHUSD';
const SIZE = 0.01;

function seeded() {
  const engine = makeEngine({ profile: trainingProfile() });
  engine.onQuote({ symbol: SYMBOL, bid: 100.0, ask: 100.5, replayMs: 0, seq: 1 });
  return engine;
}

/** A frozen snapshot: `Object.freeze` on the state so a mutating projection throws. */
function frozenState(engine: ReturnType<typeof seeded>): AccountState {
  const state = engine.view();
  return Object.freeze({
    ...state,
    positions: Object.freeze(state.positions.map((p) => Object.freeze({ ...p }))),
    orders: Object.freeze(state.orders.map((o) => Object.freeze({ ...o }))),
    fills: Object.freeze(state.fills.map((f) => Object.freeze({ ...f }))),
  }) as AccountState;
}

// ---------------------------------------------------------------------------
// Purity and idempotence
// ---------------------------------------------------------------------------

describe('projections are reads, not operations', () => {
  it('a projection is idempotent: repeating it changes nothing', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE, attachments: { stopLoss: 99, takeProfit: 102 } });
    engine.runUntilIdle();

    const state = engine.view();
    const first = projectAccountTotals(state);
    const second = projectAccountTotals(state);
    const third = projectAccountTotals(state);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // The engine itself is untouched by having been read.
    expect(engine.view().fills).toHaveLength(state.fills.length);
  });

  it('a projection cannot mutate a frozen account state', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const frozen = frozenState(engine);
    // These all throw if they attempt to write, and return sensible values if they do not.
    expect(() => projectForSymbol(frozen, SYMBOL)).not.toThrow();
    expect(() => projectAccountTotals(frozen)).not.toThrow();
    expect(() => projectMarkers(frozen, SYMBOL)).not.toThrow();
    expect(() => projectGroupedMarkers(frozen, SYMBOL)).not.toThrow();
  });

  it('survives a Strict Mode style double invocation', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const state = engine.view();

    // React renders effects twice in development Strict Mode. A projection that accumulated would
    // visibly differ on the second pass.
    const totals = [0, 1].map(() => projectAccountTotals(state));
    expect(totals[1]).toEqual(totals[0]);
    const markers = [0, 1].map(() => projectMarkers(state, SYMBOL));
    expect(markers[1]).toEqual(markers[0]);
  });

  it('does not depend on how many times a symbol is projected', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const state = engine.view();

    const once = projectAccountTotals(state).realizedPnl;
    // Simulate ten charts all reading the same account.
    const tenReads = Array.from({ length: 10 }, () => projectAccountTotals(state).realizedPnl);
    expect(new Set(tenReads).size).toBe(1);
    expect(tenReads[0]).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// Single source of PnL
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-02 — PnL is counted once per account entity', () => {
  it('counts a closed position exactly once', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];
    engine.onQuote({ symbol: SYMBOL, bid: 103.0, ask: 103.5, replayMs: 5_000, seq: 2 });
    engine.closePosition(position.positionId);
    engine.runUntilIdle();

    const totals = projectAccountTotals(engine.view());
    expect(totals.realizedPnl).toBeCloseTo((103.0 - 100.5) * SIZE, 9);
    // Exactly one contributing entity, named.
    expect(totals.countedPositionIds).toEqual([position.positionId]);
    expect(totals.openPositionCount).toBe(0);
  });

  it('sums two independent positions without merging them', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    engine.onQuote({ symbol: SYMBOL, bid: 101.0, ask: 101.5, replayMs: 1_000, seq: 2 });
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const [first, second] = engine.openPositions();
    expect(first.positionId).not.toBe(second.positionId);

    engine.closePosition(first.positionId);
    engine.runUntilIdle();
    engine.closePosition(second.positionId);
    engine.runUntilIdle();

    const totals = projectAccountTotals(engine.view());
    const expected = (101.0 - 100.5) * SIZE + (101.0 - 101.5) * SIZE;
    expect(totals.realizedPnl).toBeCloseTo(expected, 9);
    expect(totals.countedPositionIds).toHaveLength(2);
    // No duplicate ids, which is what a double count would look like.
    expect(new Set(totals.countedPositionIds).size).toBe(2);
    // The account total agrees with the engine's own figure.
    expect(totals.realizedPnl).toBeCloseTo(engine.view().realizedPnl, 9);
  });

  it('reports total = realized + unrealized', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    engine.onQuote({ symbol: SYMBOL, bid: 101.0, ask: 101.5, replayMs: 5_000, seq: 2 });

    const totals = projectAccountTotals(engine.view());
    expect(totals.unrealizedPnl).toBeCloseTo((101.0 - 100.5) * SIZE, 9);
    expect(totals.totalPnl).toBeCloseTo(totals.realizedPnl + totals.unrealizedPnl, 9);
  });
});

// ---------------------------------------------------------------------------
// Per-symbol projection
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-02 — a chart’s symbol is a filter, never a rewrite', () => {
  it('projects only the symbol asked for', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    expect(projectForSymbol(engine.view(), SYMBOL).positions).toHaveLength(1);
    expect(projectForSymbol(engine.view(), OTHER).positions).toHaveLength(0);
    expect(projectForSymbol(engine.view(), OTHER).hasExposure).toBe(false);
  });

  it('switching a chart’s symbol does not change the position’s symbol or price', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const before = projectForSymbol(engine.view(), SYMBOL).positions[0];

    // The chart "switches" to another symbol: it simply projects something else.
    projectForSymbol(engine.view(), OTHER);

    const after = projectForSymbol(engine.view(), SYMBOL).positions[0];
    expect(after.symbol).toBe(before.symbol);
    expect(after.entryPrice).toBe(before.entryPrice);
    expect(after.positionId).toBe(before.positionId);
  });

  it('the account total is unchanged by which symbol a chart displays', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const state = engine.view();

    // Neither read may influence the other.
    const viewingBtc = projectAccountTotals(state);
    projectAccountTotals(state);
    const viewingEth = projectAccountTotals(state);
    expect(viewingEth).toEqual(viewingBtc);
  });

  it('exposure is reported for a symbol that has live instructions', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();

    const view = projectForSymbol(engine.view(), SYMBOL);
    expect(view.workingOrders).toHaveLength(1);
    expect(view.hasExposure).toBe(true);
    expect(view.openPositions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SIM-ACCOUNT-05 — markers by identity
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-05 — markers are bound by identity', () => {
  it('produces a marker for a position, its protection and its fill', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();

    const markers = projectMarkers(engine.view(), SYMBOL);
    const kinds = markers.map((m) => m.kind);
    expect(kinds).toContain('POSITION');
    expect(kinds).toContain('STOP_LOSS');
    expect(kinds).toContain('TAKE_PROFIT');
    expect(kinds).toContain('FILL');

    // Every marker carries the engine's own id and the symbol it belongs to.
    for (const marker of markers) {
      expect(marker.id).toBeTruthy();
      expect(marker.symbol).toBe(SYMBOL);
      expect(marker.key).toMatch(/^(position|order|fill):/);
    }
  });

  it('is deterministic, so a remounted chart rebuilds the identical picture', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0 },
    });
    engine.runUntilIdle();
    const state = engine.view();

    const first = projectMarkers(state, SYMBOL);
    // A remount is just another projection of the same account.
    const afterRemount = projectMarkers(state, SYMBOL);
    expect(afterRemount).toEqual(first);
    expect(afterRemount.map((m) => m.key)).toEqual(first.map((m) => m.key));
  });

  it('keys are unique, so two charts cannot collide on one primitive', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    engine.onQuote({ symbol: SYMBOL, bid: 101.0, ask: 101.5, replayMs: 1_000, seq: 2 });
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const keys = projectMarkers(engine.view(), SYMBOL).map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('projects no markers for a symbol the account has nothing on', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    expect(projectMarkers(engine.view(), OTHER)).toEqual([]);
  });

  it('marks the reservation holder and only the reservation holder', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];
    engine.closePosition(position.positionId);

    const markers = projectMarkers(engine.view(), SYMBOL);
    const reserved = markers.filter((m) => m.reserved);
    // The manual close order is the reservation holder; the position reports as reserved.
    expect(reserved.length).toBeGreaterThan(0);
    const positionMarker = markers.find((m) => m.kind === 'POSITION')!;
    expect(positionMarker.reserved).toBe(true);
  });

  it('groups a position with its protective members', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();

    const groups = projectGroupedMarkers(engine.view(), SYMBOL);
    expect(groups).toHaveLength(1);
    expect(groups[0].position?.kind).toBe('POSITION');
    expect(groups[0].group.map((m) => m.kind).sort()).toEqual(['STOP_LOSS', 'TAKE_PROFIT']);
    // The entry market order filled, so it is not a working order; its fill arrow is neither a
    // position nor a protective member, so it lands with the orphans.
    expect(groups[0].orphanOrders.map((m) => m.kind)).toContain('FILL');
  });

  it('draws a group for a position with no protection', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const groups = projectGroupedMarkers(engine.view(), SYMBOL);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toEqual([]);
    expect(groups[0].position).not.toBeNull();
  });

  it('returns an orphan bucket when there are no positions at all', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();

    const groups = projectGroupedMarkers(engine.view(), SYMBOL);
    expect(groups).toHaveLength(1);
    expect(groups[0].position).toBeNull();
    expect(groups[0].orphanOrders).toHaveLength(1);
  });

  it('agrees with closingGroupFor about membership', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();

    const state = engine.view();
    const position = state.positions[0];
    const group = closingGroupFor(state, position);
    const grouped = projectGroupedMarkers(state, SYMBOL)[0];

    expect(grouped.group.map((m) => String(m.id)).sort()).toEqual(
      group.members.map((m) => String(m.orderId)).sort(),
    );
  });
});
