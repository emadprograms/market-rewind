import { describe, it, expect } from 'vitest';
import { makeEngine } from '../../../src/lib/orderSimulator/__testkit__/harness';
import { closingGroupFor, protectiveGroupIsSound } from '../../../src/lib/orderSimulator/accountProjection';
import { trainingProfile } from '../../../src/lib/orderSimulator/profiles';
import type { PositionId } from '../../../src/lib/orderSimulator/types';

/**
 * SIM-ACCOUNT-03 and SIM-ACCOUNT-04 — the protective group.
 *
 * The requirement in one line: a stop-loss and a take-profit are ONE claim on ONE position size, the
 * claim is reserved by whichever instruction activates first, and a take-profit that is merely
 * eligible (armed, but not yet filled) must not take the stop-loss out of play.
 */

const SYMBOL = 'BTCUSD';
const SIZE = 0.01;
const BID = 100.0;
const ASK = 100.5;

function seeded() {
  const engine = makeEngine({ profile: trainingProfile() });
  engine.onQuote({ symbol: SYMBOL, bid: BID, ask: ASK, replayMs: 0, seq: 1 });
  return engine;
}

// ---------------------------------------------------------------------------
// SIM-ACCOUNT-03 — attachments are opt-in
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-03 — protection is opt-in, never a default', () => {
  it('an entry with no attachments opens a bare position', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const position = engine.openPositions()[0];
    expect(position).toBeDefined();
    expect(position.slOrderId).toBeNull();
    expect(position.tpOrderId).toBeNull();
    expect(engine.view().positions[0].state).toBe('OPEN');
  });

  it('a bare entry creates exactly one order and no exits', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const exits = engine.view().orders.filter((o) => o.purpose === 'STOP_LOSS' || o.purpose === 'TAKE_PROFIT');
    expect(exits).toHaveLength(0);
  });

  it('protection requested explicitly is attached', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0 },
    });
    engine.runUntilIdle();

    const exits = engine.view().orders.filter((o) => o.purpose === 'STOP_LOSS');
    expect(exits).toHaveLength(1);
    // Opting into a stop does NOT drag a take-profit along with it.
    expect(engine.view().orders.filter((o) => o.purpose === 'TAKE_PROFIT')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SIM-ACCOUNT-04 — activation only after the entry fills
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-04 — protection activates only after its entry fills', () => {
  it('no protective order exists while the entry is still working', () => {
    const engine = seeded();
    const submitted = engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'LIMIT',
      size: SIZE,
      level: 95,
      attachments: { stopLoss: 94, takeProfit: 96 },
    });
    // Well before the limit can fill.
    engine.runUntil(200);

    const entry = engine.view().orders.find((o) => o.orderId === submitted.orderId)!;
    expect(entry.state).toBe('WORKING');
    // The position does not exist yet, so neither does its protection.
    expect(engine.openPositions()).toHaveLength(0);
    const exits = engine.view().orders.filter((o) => o.purpose === 'STOP_LOSS' || o.purpose === 'TAKE_PROFIT');
    expect(exits).toHaveLength(0);
  });

  it('the protective orders appear at the moment of the fill', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();

    const fill = engine.view().fills[0];
    const exits = engine.view().orders.filter((o) => o.purpose === 'STOP_LOSS' || o.purpose === 'TAKE_PROFIT');
    expect(exits).toHaveLength(2);
    for (const exit of exits) {
      expect(exit.workingAt).toBe(fill.replayMs);
      expect(exit.positionId).toBe(fill.positionId);
    }
  });

  it('refuses to protect a position that does not exist', () => {
    const engine = seeded();
    const outcome = engine.dispatch({
      kind: 'PROTECT',
      requestId: 'R-x' as never,
      input: { positionId: 'P-nope' as PositionId, stopLoss: 99 },
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.clientError).toMatch(/No position with id P-nope/);
  });

  it('refuses to protect a position that is already closed', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];
    engine.closePosition(position.positionId);
    engine.runUntilIdle();

    const outcome = engine.dispatch({
      kind: 'PROTECT',
      requestId: 'R-y' as never,
      input: { positionId: position.positionId, stopLoss: 99 },
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.clientError).toMatch(/protection attaches only to an open position/);
  });

  it('refuses protection with neither side specified', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];

    const outcome = engine.dispatch({ kind: 'PROTECT', requestId: 'R-z' as never, input: { positionId: position.positionId } });
    expect(outcome.accepted).toBe(false);
    expect(outcome.clientError).toMatch(/at least one of stopLoss or takeProfit/);
  });

  it('attaches protection to an open position after the fact', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];

    const outcome = engine.dispatch({
      kind: 'PROTECT',
      requestId: 'R-late' as never,
      input: { positionId: position.positionId, stopLoss: 99 },
    });
    expect(outcome.accepted).toBe(true);
    engine.runUntilIdle();

    expect(engine.view().positions[0].slOrderId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SIM-ACCOUNT-04 — one claim on one position size
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-04 — the group is a single claim on one position size', () => {
  it('never lets the live claim exceed one position size', () => {
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
    const position = engine.openPositions()[0];
    const group = closingGroupFor(state, position);

    expect(group.claimSize).toBe(SIZE);
    expect(group.members).toHaveLength(2);
    // Each member closes the WHOLE position, so the members' sizes sum to two position sizes. That
    // is the correct shape and not a defect: whoever activates first invalidates the other. What
    // must hold is that no single member over-claims, and that they cannot both act.
    expect(group.maxMemberSize).toBeLessThanOrEqual(SIZE);
    expect(group.memberSizeTotal).toBeCloseTo(SIZE * 2, 9);
    expect(group.sound).toBe(true);
    expect(protectiveGroupIsSound(state, position)).toBe(true);
  });

  it('a filled stop cancels the take-profit so the size is closed once', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();

    engine.onQuote({ symbol: SYMBOL, bid: 98.9, ask: 99.0, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();

    const position = engine.view().positions[0];
    expect(position.state).toBe('CLOSED');
    expect(position.openSize).toBe(0);

    // Exactly one closing fill for one position size.
    const closingFills = engine.view().fills.filter((f) => f.positionId === position.positionId && f.side === 'SELL');
    expect(closingFills).toHaveLength(1);
    expect(closingFills[0].quantity).toBe(SIZE);

    const tp = engine.view().orders.find((o) => o.purpose === 'TAKE_PROFIT')!;
    expect(tp.state).toBe('CANCELLED');
    expect(engine.eventLog().some((e) => e.kind === 'CANCELLED' && e.detail.cause === 'SIBLING_EXIT_FILLED')).toBe(true);
  });

  it('a filled take-profit cancels the stop-loss', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();

    engine.onQuote({ symbol: SYMBOL, bid: 102.0, ask: 102.05, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();

    const sl = engine.view().orders.find((o) => o.purpose === 'STOP_LOSS')!;
    expect(sl.state).toBe('CANCELLED');
    expect(engine.view().positions[0].state).toBe('CLOSED');
  });

  it('refuses to add protection while a close owns the position', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];

    engine.closePosition(position.positionId);
    const outcome = engine.dispatch({
      kind: 'PROTECT',
      requestId: 'R-late2' as never,
      input: { positionId: position.positionId, stopLoss: 99 },
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.clientError).toMatch(/already being closed/);
  });

  it('replacing one side does not disturb the other', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];
    const tpIdBefore = position.tpOrderId;

    // Move the stop only.
    engine.dispatch({
      kind: 'PROTECT',
      requestId: 'R-re' as never,
      input: { positionId: position.positionId, stopLoss: 98.5 },
    });
    engine.runUntilIdle();

    const after = engine.view().positions[0];
    expect(after.tpOrderId).toBe(tpIdBefore);
    const stops = engine.view().orders.filter((o) => o.purpose === 'STOP_LOSS');
    expect(stops).toHaveLength(2); // the replaced one is terminal, not deleted
    // Exactly one stop may be live. Leaving the old one WORKING would let either close the position.
    expect(stops.filter((o) => o.state === 'WORKING')).toHaveLength(1);
    expect(stops.find((o) => o.state === 'WORKING')!.level).toBe(98.5);
    expect(stops.some((o) => o.state === 'CANCELLED')).toBe(true);
    expect(after.slOrderId).toBe(stops.find((o) => o.state === 'WORKING')!.orderId);

    // And the group still satisfies its invariant after the replacement.
    const group = closingGroupFor(engine.view(), after);
    expect(group.sound).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SIM-ACCOUNT-04 — a merely-eligible TP must not disable the SL
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-04 — an armed take-profit does not disable the stop-loss', () => {
  it('keeps the stop live while the take-profit is eligible but unfilled', () => {
    // The take-profit becomes ELIGIBLE (armed) but its condition is not met, so nothing fills.
    // The stop must remain a live instruction throughout.
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 105.0 },
    });
    engine.runUntilIdle();

    // Let the dispatch delay elapse so BOTH exits are armed.
    engine.runUntil(engine.now() + 1_000);
    engine.onQuote({ symbol: SYMBOL, bid: 100.1, ask: 100.6, replayMs: 2_000, seq: 2 });
    engine.runUntil(2_000);

    const sl = engine.view().orders.find((o) => o.purpose === 'STOP_LOSS')!;
    const tp = engine.view().orders.find((o) => o.purpose === 'TAKE_PROFIT')!;
    expect(tp.state).toBe('WORKING'); // eligible, not triggered
    expect(sl.state).toBe('WORKING'); // STILL live
    expect(sl.triggeredAt).toBeNull();

    // And the stop can still act: drop through it.
    engine.onQuote({ symbol: SYMBOL, bid: 98.9, ask: 99.0, replayMs: 5_000, seq: 3 });
    engine.runUntilIdle();
    expect(sl.state).toBe('FILLED');
    expect(engine.view().positions[0].state).toBe('CLOSED');
  });

  it('keeps the take-profit live while the stop-loss is armed but unfilled', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 90.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();
    engine.runUntil(engine.now() + 1_000);
    engine.onQuote({ symbol: SYMBOL, bid: 100.1, ask: 100.6, replayMs: 2_000, seq: 2 });
    engine.runUntil(2_000);

    const sl = engine.view().orders.find((o) => o.purpose === 'STOP_LOSS')!;
    const tp = engine.view().orders.find((o) => o.purpose === 'TAKE_PROFIT')!;
    expect(sl.state).toBe('WORKING');
    expect(tp.state).toBe('WORKING');

    engine.onQuote({ symbol: SYMBOL, bid: 102.0, ask: 102.05, replayMs: 5_000, seq: 3 });
    engine.runUntilIdle();
    expect(tp.state).toBe('FILLED');
  });
});

// ---------------------------------------------------------------------------
// SIM-ACCOUNT-04 — reservation
// ---------------------------------------------------------------------------

describe('SIM-ACCOUNT-04 — a latched exit or an accepted close reserves the position', () => {
  it('an accepted manual close invalidates the protective group', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];

    // The close is accepted now; its arrival is delayed by the travel time.
    const outcome = engine.closePosition(position.positionId);
    expect(outcome.accepted).toBe(true);

    const afterAccept = engine.view();
    const exits = afterAccept.orders.filter((o) => o.purpose === 'STOP_LOSS' || o.purpose === 'TAKE_PROFIT');
    for (const exit of exits) {
      expect(exit.state, `${exit.purpose} must be invalidated by the reserved close`).toBe('CANCELLED');
    }
    expect(
      engine.eventLog().some((e) => e.kind === 'CANCELLED' && e.detail.cause === 'CLOSE_RESERVED'),
    ).toBe(true);
  });

  it('the reservation is recorded on the position', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];

    engine.closePosition(position.positionId);
    const reserved = engine.view().positions[0].closeReservedBy;
    expect(reserved).not.toBeNull();
  });

  it('a latched stop reserves the close so a competing close cannot share the size', () => {
    const engine = seeded();
    engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0 },
    });
    // Run the entry through, but stop before the stop-loss can act.
    engine.runUntilIdle();
    const position = engine.openPositions()[0];
    expect(position.closeReservedBy).toBeNull();

    // The stop latches and fills at 5000. Submit a manual close at the SAME instant and let both
    // race: the stop got there first, so the manual close must be refused, not honoured alongside.
    engine.onQuote({ symbol: SYMBOL, bid: 98.9, ask: 99.0, replayMs: 5_000, seq: 2 });
    engine.closePosition(position.positionId);
    engine.runUntilIdle();

    const closed = engine.view().positions[0];
    expect(closed.state).toBe('CLOSED');
    expect(closed.openSize).toBe(0);

    // Exactly one closing fill: the size was not closed twice.
    const closingFills = engine.view().fills.filter((f) => f.side === 'SELL');
    expect(closingFills).toHaveLength(1);

    // The close was refused. Which stage refuses it depends on how far the stop got: because a
    // trigger fills atomically here, the stop has usually already closed the position by the time
    // the manual close is validated. Either refusal is correct; what matters is that exactly one
    // instruction closed the size, asserted above.
    const refusal = engine
      .eventLog()
      .find((e) => e.kind === 'REJECTED' && e.positionId === position.positionId);
    expect(refusal).toBeDefined();
    expect(String(refusal!.detail.reason)).toMatch(/already being closed|CLOSED|cannot be closed/);
  });

  it('refuses a second close while one is in flight and leaves the size untouched', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];

    expect(engine.closePosition(position.positionId).accepted).toBe(true);
    const second = engine.closePosition(position.positionId);
    expect(second.accepted).toBe(false);
    expect(second.clientError).toMatch(/already has a close in flight/);

    engine.runUntilIdle();
    const closingFills = engine.view().fills.filter((f) => f.side === 'SELL');
    expect(closingFills).toHaveLength(1);
    expect(engine.view().positions[0].openSize).toBe(0);
  });

  it('the reservation is released once the close fills', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];
    engine.closePosition(position.positionId);
    engine.runUntilIdle();
    expect(engine.view().positions[0].closeReservedBy).toBeNull();
  });
});
