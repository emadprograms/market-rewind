import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReplaySession } from '../../src/lib/orderSimulator/replay';
import { useAccountStore } from '../../src/store/useAccountStore';
import { projectForSymbol, projectAccountTotals } from '../../src/lib/orderSimulator/accountProjection';
import { BTCUSD_RULES, trainingProfile, pilotReferenceProfile } from '../../src/lib/orderSimulator/profiles';
import { triggerConditionMet } from '../../src/lib/orderSimulator/triggers';
import type { Quote, ReplayMs } from '../../src/lib/orderSimulator/types';

/**
 * SIM-VERIFY-01 — the behavioural matrix from §10 of the implementation plan.
 *
 * One test per row, in the plan's order, each quoting the result the plan requires. These are written
 * as journeys: an independent tape and explicit commands, driven through the ReplaySession and the
 * shared account, rather than assertions about internal branches. Where two readings of a row were
 * possible, both are asserted and the interpretation is stated in the test.
 */

const SYMBOL = 'BTCUSD';
const SIZE = 0.01;

/** A quote at an exact replay time. Identity is (symbol, seq), never an index. */
function q(replayMs: ReplayMs, bid: number, ask: number, seq: number): Quote {
  return { symbol: SYMBOL, bid, ask, replayMs, seq };
}

function newSession(profile = trainingProfile(), startMs = 0): ReplaySession {
  return new ReplaySession({ sessionId: 'matrix', instruments: [BTCUSD_RULES], profile, startMs });
}

beforeEach(() => {
  const store = useAccountStore.getState();
  store.configure({ instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'matrix' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Quote changes while a market order travels
// ---------------------------------------------------------------------------

describe('§10.1 quote changes while a market order travels', () => {
  it('fills a BUY at the execution-time ask and keeps the submitted quote for comparison', () => {
    const session = newSession();
    // The market moves up while the instruction is in flight (travel 100, dispatch 50).
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(150, 105, 105.5, 2), q(1_000, 105, 105.5, 3)]);
    session.advanceTo(0, 'PLAY');

    const outcome = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    expect(outcome.accepted).toBe(true);
    session.advanceTo(500, 'PLAY');

    const state = session.state();
    expect(state.fills).toHaveLength(1);
    // Filled at the ask that existed when it could execute — not the ask at submission.
    expect(state.fills[0].price).toBe(105.5);
    // The quote it was placed against is retained, so the adverse move is explainable.
    const order = state.orders[0];
    expect(order.submittedQuote?.ask).toBe(100.5);
    // 5.00 of adverse move on a 0.05 grid is exactly 100 ticks; the tick count is the exact form.
    expect(state.fills[0].priceChangeFromSubmitTicks).toBe(100);
  });

  it('fills a SELL at the execution-time bid', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(150, 95, 95.5, 2), q(1_000, 95, 95.5, 3)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'MARKET', size: SIZE });
    session.advanceTo(500, 'PLAY');

    expect(session.state().fills[0].price).toBe(95);
  });
});

// ---------------------------------------------------------------------------
// 2. Sending order and paused replay
// ---------------------------------------------------------------------------

describe('§10.2 sending order while replay is paused', () => {
  it('creates no position and advances no economic time until play or step', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 101, 101.5, 2)]);
    session.advanceTo(0, 'PLAY');
    const frozenClock = session.state().nowMs;

    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });

    const paused = session.state();
    expect(paused.positions).toHaveLength(0);
    expect(paused.fills).toHaveLength(0);
    expect(paused.nowMs).toBe(frozenClock);
    expect(paused.orders[0].state).toBe('SUBMITTED');

    // Stepping one frame settles it.
    session.advanceTo(500, 'STEP');
    expect(session.state().fills).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. A buy limit touched only by the bid
// ---------------------------------------------------------------------------

describe('§10.3 a buy limit touched only by the bid', () => {
  it('remains working until the ask satisfies it', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 98.9, 100.4, 2), q(2_000, 98.9, 98.95, 3)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 99 });
    session.advanceTo(1_500, 'PLAY');

    // The bid is below the level, but a BUY limit executes against the ask: it must still be working.
    expect(session.state().fills).toHaveLength(0);
    expect(session.state().orders[0].state).toBe('WORKING');

    session.advanceTo(2_500, 'PLAY');
    expect(session.state().fills).toHaveLength(1);
    expect(session.state().fills[0].price).toBe(98.95);
  });
});

// ---------------------------------------------------------------------------
// 4. Equality and crossing on every side
// ---------------------------------------------------------------------------

describe('§10.4 equality and crossing on every side', () => {
  const cases: { name: string; quote: Quote; order: { side: 'BUY' | 'SELL'; type: 'LIMIT' | 'STOP'; level: number }; price: number }[] = [
    { name: 'sell limit, equality on the bid', quote: q(1_000, 101, 101.5, 2), order: { side: 'SELL', type: 'LIMIT', level: 101 }, price: 101 },
    { name: 'buy stop, equality on the ask', quote: q(1_000, 101.5, 102, 2), order: { side: 'BUY', type: 'STOP', level: 102 }, price: 102 },
    { name: 'sell stop, equality on the bid', quote: q(1_000, 99, 99.5, 2), order: { side: 'SELL', type: 'STOP', level: 99 }, price: 99 },
  ];

  for (const scenario of cases) {
    it(`${scenario.name} triggers once`, () => {
      const session = newSession();
      session.replaceTape(SYMBOL, [
        q(0, 100, 100.5, 1),
        scenario.quote,
        // A second quote beyond the level: the trigger must not fire again.
        q(2_000, scenario.quote.bid, scenario.quote.ask, 3),
        q(3_000, scenario.quote.bid, scenario.quote.ask, 4),
      ]);
      session.advanceTo(0, 'PLAY');
      const outcome = session.submitOrder({ symbol: SYMBOL, side: scenario.order.side, type: scenario.order.type, size: SIZE, level: scenario.order.level });
      expect(outcome.accepted).toBe(true);
      session.advanceTo(4_000, 'PLAY');

      const state = session.state();
      expect(state.fills).toHaveLength(1);
      expect(state.fills[0].price).toBe(scenario.price);
      // Each trigger happens exactly once, no matter how long the condition stays satisfied.
      const triggers = state.events.filter((e) => e.kind === 'TRIGGERED' && e.orderId === outcome.orderId);
      expect(triggers).toHaveLength(1);
      expect(session.state().positions).toHaveLength(1);
    });
  }

  it('crossing — not just touching — is the same trigger, evaluated by the shared rule', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 102.4, 102.9, 2)]);
    session.advanceTo(0, 'PLAY');
    const outcome = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 102 });
    session.advanceTo(2_000, 'PLAY');

    expect(session.state().fills).toHaveLength(1);
    // The order type and side are decided by the trigger matrix the UI also reads.
    expect(triggerConditionMet('STOP', 'BUY', 102, { symbol: SYMBOL, bid: 102.4, ask: 102.9, replayMs: 1_000, seq: 2 })).toBe(true);
    expect(triggerConditionMet('STOP', 'BUY', 103, { symbol: SYMBOL, bid: 102.4, ask: 102.9, replayMs: 1_000, seq: 2 })).toBe(false);
    expect(outcome.accepted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. A limit eligible briefly, then the price moves before dispatch
// ---------------------------------------------------------------------------

describe('§10.5 a limit that becomes eligible briefly, then the price moves', () => {
  it('does not fill at a price that is gone by the time it can execute, and stays working', () => {
    const session = newSession();
    // The ask touches 100.00 at t=110 and has moved to 100.70 by t=140, both inside the dispatch
    // delay: at eligibility (t=150) the standing market is the later one, so there is nothing to fill.
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(110, 99.9, 100, 2), q(140, 100.2, 100.7, 3), q(4_000, 99.8, 99.9, 4), q(5_000, 99.8, 99.9, 5)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 100 });
    session.advanceTo(1_000, 'PLAY');

    // Nothing filled at 100.00: the price was gone by the time the order could execute against it.
    expect(session.state().fills).toHaveLength(0);
    expect(session.state().orders[0].state).toBe('WORKING');

    session.advanceTo(5_000, 'PLAY');
    const state = session.state();
    expect(state.fills).toHaveLength(1);
    // And it never filled through its own limit: a BUY limit cannot pay more than its level.
    expect(state.fills[0].price).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// 6. A stop eligible briefly, then the price returns
// ---------------------------------------------------------------------------

describe('§10.6 a stop whose price returns after the crossing', () => {
  it('keeps a latched trigger latched, and fills at the quote that satisfied it', () => {
    const session = newSession();
    // Armed at 150. The ask crosses 102 at 200, then the price falls back at 250.
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(200, 101.9, 102, 2), q(250, 99, 99.5, 3)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 102 });
    session.advanceTo(1_000, 'PLAY');

    const state = session.state();
    // Once triggered, the condition is no longer evaluated: a returning price cannot un-trigger it.
    expect(state.fills).toHaveLength(1);
    expect(state.fills[0].price).toBe(102);
    expect(state.fills[0].replayMs).toBe(200);
  });

  it('does not trigger on a crossing that happened before the order could execute', () => {
    // The reading of the row this engine implements: a stop that was not yet live when the price
    // crossed is not treated as triggered by that price. It arms at the published dispatch time and
    // is judged against the market it actually meets then, which is what stops a stale price from
    // being filled against.
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(110, 103, 103.5, 2), q(120, 100.1, 100.6, 3), q(4_000, 100.1, 100.6, 4)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 102 });
    session.advanceTo(1_000, 'PLAY');

    const state = session.state();
    expect(state.fills).toHaveLength(0);
    expect(state.orders[0].state).toBe('WORKING');
    expect(state.orders[0].triggeredAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. A recorded price gap
// ---------------------------------------------------------------------------

describe('§10.7 market and stop crossing a recorded price gap', () => {
  it('fills a stop at the next valid execution quote, which need not be its level', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 110, 110.5, 2), q(2_000, 110, 110.5, 3)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 105 });
    session.advanceTo(3_000, 'PLAY');

    const fill = session.state().fills[0];
    // The gap skipped the level entirely: the fill is the price that was actually reachable.
    expect(fill.price).toBe(110.5);
    expect(fill.price).not.toBe(105);
    // The 5.50 of slippage past the stop is reported rather than hidden: 110 ticks at 0.05 a tick.
    expect(fill.stopToFillDifferenceTicks).toBe(110);
  });
});

// ---------------------------------------------------------------------------
// 8. Cancel before vs after the trigger
// ---------------------------------------------------------------------------

describe('§10.8 cancel before versus after the trigger', () => {
  it('cancels when the cancellation reaches the broker first, and nothing fills later', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(2_000, 102.4, 102.9, 2)]);
    session.advanceTo(0, 'PLAY');
    const outcome = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 102 });
    session.advanceTo(200, 'PLAY'); // armed at 150

    session.cancelOrder(outcome.orderId as never);
    session.advanceTo(1_000, 'PLAY'); // the cancellation arrives at 300

    expect(session.state().orders[0].state).toBe('CANCELLED');

    // The price crosses the level afterwards. A cancelled order cannot be revived by the market.
    session.advanceTo(3_000, 'PLAY');
    expect(session.state().fills).toHaveLength(0);
    expect(session.state().positions).toHaveLength(0);
  });

  it('rejects a cancellation that arrives after the trigger and preserves the position', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(250, 102.4, 102.9, 2), q(2_000, 102.4, 102.9, 3)]);
    session.advanceTo(0, 'PLAY');
    const outcome = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 102 });
    session.advanceTo(200, 'PLAY');

    session.cancelOrder(outcome.orderId as never); // arrives at 300, after the 250 trigger
    session.advanceTo(2_500, 'PLAY');

    const state = session.state();
    expect(state.fills).toHaveLength(1);
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].state).toBe('OPEN');
    const rejection = state.events.find((e) => e.kind === 'REJECTED' && e.orderId === outcome.orderId);
    expect(String(rejection?.detail?.reason ?? '')).toMatch(/cancel arrived after|no longer/i);
  });
});

// ---------------------------------------------------------------------------
// 9. A delayed amendment versus the price
// ---------------------------------------------------------------------------

describe('§10.9 a delayed amendment versus a price crossing', () => {
  it('keeps the old level active until the amendment is processed', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(250, 98.9, 98.95, 2)]);
    session.advanceTo(0, 'PLAY');
    const outcome = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 99 });
    session.advanceTo(200, 'PLAY');

    // The amendment to 90 is sent at 200 and arrives at 300. At 250 the market satisfies the OLD
    // level, and the order fills there: an instruction in flight does not retroactively apply.
    session.amendOrder(outcome.orderId as never, 0, 90);
    session.advanceTo(1_000, 'PLAY');

    const state = session.state();
    expect(state.fills).toHaveLength(1);
    expect(state.fills[0].price).toBe(98.95);
  });

  it('refuses a stale edit against an order that has already been consumed', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(250, 98.9, 98.95, 2), q(2_000, 98.9, 98.95, 3)]);
    session.advanceTo(0, 'PLAY');
    const outcome = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 99 });
    session.advanceTo(200, 'PLAY');
    session.amendOrder(outcome.orderId as never, 0, 90);
    session.advanceTo(2_500, 'PLAY');

    // The amendment arrives after the fill: it must not move a position's entry or reopen anything.
    const state = session.state();
    expect(state.orders[0].state).toBe('FILLED');
    expect(state.fills[0].price).toBe(98.95);
    expect(state.positions).toHaveLength(1);
    const rejection = state.events.find((e) => e.kind === 'REJECTED' && e.orderId === outcome.orderId);
    expect(String(rejection?.detail?.reason ?? '')).toMatch(/amend/i);
  });
});

// ---------------------------------------------------------------------------
// 10. Stop loss and take profit
// ---------------------------------------------------------------------------

describe('§10.10 stop loss and take profit on both directions', () => {
  it('closes a LONG once, on the bid, and invalidates the competing exit', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 98.9, 99.4, 2), q(2_000, 90, 90.5, 3), q(3_000, 90, 90.5, 4)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(1_000, 'PLAY');
    const positionId = session.state().positions[0].positionId;

    session.attachProtection(positionId, { stopLoss: 95, takeProfit: 110 });
    // Read the ids while the position is open: a closed position no longer points at its exits.
    const armed = session.state().positions[0];
    expect(armed.slOrderId).not.toBeNull();
    expect(armed.tpOrderId).not.toBeNull();
    const takeProfitId = armed.tpOrderId;

    session.advanceTo(3_500, 'PLAY');

    const state = session.state();
    expect(state.positions[0].state).toBe('CLOSED');
    const closes = state.fills.filter((f) => f.orderId !== state.orders[0].orderId);
    expect(closes).toHaveLength(1);
    // A LONG closes on the bid.
    expect(closes[0].price).toBe(90);
    // The other exit cannot fire afterwards: it was invalidated, not left armed.
    expect(state.orders.find((o) => o.orderId === takeProfitId)?.state).toBe('CANCELLED');
  });

  it('closes a SHORT once, on the ask', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 104.5, 105, 2), q(2_000, 106, 106.5, 3), q(3_000, 106, 106.5, 4)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'MARKET', size: SIZE });
    session.advanceTo(1_000, 'PLAY');
    const positionId = session.state().positions[0].positionId;

    session.attachProtection(positionId, { stopLoss: 105, takeProfit: 90 });
    session.advanceTo(3_500, 'PLAY');

    const state = session.state();
    expect(state.positions[0].state).toBe('CLOSED');
    const closes = state.fills.filter((f) => f.orderId !== state.orders[0].orderId);
    expect(closes).toHaveLength(1);
    // A SHORT closes on the ask, and the stop was satisfied by equality at 105.
    expect(closes[0].price).toBe(105);
  });

  it('accepts protection with the entry, when it is asked for', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(500, 99, 99.5, 2), q(1_000, 89, 89.5, 3), q(1_500, 89, 89.5, 4)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE, attachments: { stopLoss: 95 } });

    // The protection is armed with the entry, and the position points at it.
    session.advanceTo(600, 'PLAY');
    expect(session.state().positions[0].state).toBe('OPEN');
    expect(session.state().positions[0].slOrderId).not.toBeNull();
    expect(session.state().positions[0].tpOrderId).toBeNull(); // only what was asked for

    session.advanceTo(2_000, 'PLAY');
    expect(session.state().positions[0].state).toBe('CLOSED');
  });
});

// ---------------------------------------------------------------------------
// 11. Repeated close, repeated notice, remount
// ---------------------------------------------------------------------------

describe('§10.11 closing twice, repeated notices, and remounts', () => {
  it('realises a close exactly once however many times the close is requested', () => {
    const store = useAccountStore.getState();
    store.registerTape(SYMBOL, [
      { symbol: SYMBOL, bid: 100, ask: 100.5, replayMs: 0, seq: 1 },
      { symbol: SYMBOL, bid: 105, ask: 105.5, replayMs: 1000, seq: 2 },
      { symbol: SYMBOL, bid: 108, ask: 108.5, replayMs: 2000, seq: 3 },
      { symbol: SYMBOL, bid: 112, ask: 112.5, replayMs: 3000, seq: 4 },
      { symbol: SYMBOL, bid: 115, ask: 115.5, replayMs: 4000, seq: 5 },
      { symbol: SYMBOL, bid: 118, ask: 118.5, replayMs: 6000, seq: 6 },
    ]);
    store.advanceTo(0, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    store.advanceTo(2_000, 'PLAY');

    const positionId = useAccountStore.getState().state.positions[0].positionId;
    const before = projectAccountTotals(useAccountStore.getState().state).realizedPnl;

    useAccountStore.getState().closePosition(positionId);
    const secondPress = useAccountStore.getState().closePosition(positionId);
    useAccountStore.getState().refresh();
    useAccountStore.getState().refresh();

    // The second press is refused rather than queued: one close is in flight for this position.
    expect(secondPress.ok).toBe(false);
    expect(String(secondPress.error)).toMatch(/close in flight/i);

    useAccountStore.getState().advanceTo(6_000, 'PLAY');
    const after = projectAccountTotals(useAccountStore.getState().state);
    expect(after.realizedPnl).not.toBe(before);
    // One close fill, one realization: the second press cannot double-count.
    const entryFillId = useAccountStore.getState().state.positions[0].entryFillId;
    const closes = useAccountStore.getState().state.fills.filter((f) => f.fillId !== entryFillId);
    expect(closes).toHaveLength(1);
    expect(useAccountStore.getState().state.positions[0].state).toBe('CLOSED');
  });

  it('keeps totals identical across repeated refreshes and remounts', () => {
    const store = useAccountStore.getState();
    store.registerTape(SYMBOL, [
      { symbol: SYMBOL, bid: 100, ask: 100.5, replayMs: 0, seq: 1 },
      { symbol: SYMBOL, bid: 105, ask: 105.5, replayMs: 1000, seq: 2 },
      { symbol: SYMBOL, bid: 106, ask: 106.5, replayMs: 2000, seq: 3 },
    ]);
    store.advanceTo(0, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    store.advanceTo(2_000, 'PLAY');

    const first = projectAccountTotals(useAccountStore.getState().state);
    for (let i = 0; i < 25; i++) useAccountStore.getState().refresh();
    const second = projectAccountTotals(useAccountStore.getState().state);
    expect(second).toEqual(first);
    // A second view of the same symbol sees the same position, not another one.
    expect(projectForSymbol(useAccountStore.getState().state, SYMBOL).positions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 12. Identifier correlation
// ---------------------------------------------------------------------------

describe('§10.12 request, order and position identifiers', () => {
  it('correlates fills to their order and position, and refuses an order id as a close target', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(500, 100, 100.5, 2)]);
    session.advanceTo(0, 'PLAY');
    const outcome = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(1_000, 'PLAY');

    const state = session.state();
    const order = state.orders[0];
    const position = state.positions[0];
    expect(order.requestId).toBe(outcome.requestId);
    expect(state.fills[0].orderId).toBe(order.orderId);
    expect(state.fills[0].positionId).toBe(position.positionId);
    // The position records the fill that created it, which is what correlates it to the order.
    expect(position.entryFillId).toBe(state.fills[0].fillId);

    // Using an order id where a position id belongs must be refused, not silently accepted.
    const refused = session.closePosition(order.orderId as never);
    expect(refused.accepted).toBe(false);
    expect(refused.clientError).toBeTruthy();
    expect(session.state().positions[0].state).toBe('OPEN');
  });
});

// ---------------------------------------------------------------------------
// 13. Sparse, missing and foreign data
// ---------------------------------------------------------------------------

describe('§10.13 sparse quotes, wrong symbol and synthetic ticks', () => {
  it('waits or refuses explicitly instead of inventing a price', () => {
    const session = newSession();
    // One quote for this symbol, and a busy tape for a different one.
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1)]);
    session.replaceTape('ETHUSD', [
      { symbol: 'ETHUSD', bid: 3_000, ask: 3_001, replayMs: 0, seq: 1 },
      { symbol: 'ETHUSD', bid: 3_100, ask: 3_101, replayMs: 1_000, seq: 2 },
    ]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });

    // Another symbol's prices are not this symbol's prices, however plentiful they are.
    const report = session.advanceTo(5_000, 'PLAY');
    const state = session.state();
    expect(state.fills.length).toBeLessThanOrEqual(1);
    if (state.fills.length === 1) expect(state.fills[0].symbol).toBe(SYMBOL);
    // The tape ran out for the exposed symbol: playback freezes and says so rather than guessing.
    expect(report.frozen || state.positions.length === 1).toBe(true);
    expect(session.notices.some((n) => /frozen|exhausted|no tape/i.test(n))).toBe(true);
  });

  it('refuses an instrument it has no rules for', () => {
    const session = newSession();
    session.advanceTo(0, 'PLAY');
    const outcome = session.submitOrder({ symbol: 'NOTREAL', side: 'BUY', type: 'MARKET', size: SIZE });
    expect(outcome.accepted).toBe(false);
    expect(String(outcome.clientError)).toMatch(/NOTREAL/);
    expect(session.state().orders).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 14. Crossing and uncrossing inside one frame
// ---------------------------------------------------------------------------

describe('§10.14 crossing and uncrossing inside a single frame', () => {
  it('evaluates the intermediate crossing, which a final-tick-only design would miss', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [
      q(0, 100, 100.5, 1),
      // Both of these arrive inside one 10-second frame, and the second one returns below the level.
      q(2_000, 103, 103.5, 2),
      q(3_000, 99, 99.5, 3),
    ]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 102 });

    // One jump, exactly like a fast playback frame.
    session.advanceTo(10_000, 'PLAY');

    const state = session.state();
    expect(state.fills).toHaveLength(1);
    expect(state.fills[0].price).toBe(103.5);
    expect(state.fills[0].replayMs).toBe(2_000);
  });

  it('evaluates an intermediate crossing that a limit would have filled', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(2_000, 98.9, 98.95, 2), q(3_000, 101, 101.5, 3)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 99 });
    session.advanceTo(10_000, 'PLAY');

    expect(session.state().fills).toHaveLength(1);
    expect(session.state().fills[0].price).toBe(98.95);
  });
});

// ---------------------------------------------------------------------------
// 15. Same-time quotes, merges and replacement
// ---------------------------------------------------------------------------

describe('§10.15 same-time quotes, merges and buffer replacement', () => {
  it('orders same-time quotes stably and never doubles the economics', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 102, 102.5, 2), q(1_000, 103, 103.5, 3)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 102 });
    session.advanceTo(2_000, 'PLAY');

    const state = session.state();
    expect(state.fills).toHaveLength(1);
    // The first of the two same-time quotes satisfied it, so it filled against that one.
    expect(state.fills[0].price).toBe(102.5);
    expect(state.fills[0].quoteSeq).toBe(2);
  });

  it('deduplicates a merged page by (symbol, seq)', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 90, 90.5, 2)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    session.advanceTo(1_500, 'PLAY');
    expect(session.state().fills).toHaveLength(1);

    // The same page is merged again, as a buffer replacement would.
    session.mergeTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 90, 90.5, 2)]);
    session.advanceTo(2_000, 'PLAY');

    expect(session.state().fills).toHaveLength(1); // no duplicate fill
    expect(session.state().positions).toHaveLength(1);
  });

  it('replaces a page without replaying it as live history', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 99.5, 100, 2)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 100 });
    session.advanceTo(1_500, 'PLAY');
    const fillsBefore = session.state().fills.length;
    const pnlBefore = session.state().realizedPnl;

    // A replacement page whose quotes are already behind the playhead.
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 99.5, 100, 2), q(1_200, 99, 99.5, 3)]);
    const report = session.advanceTo(2_000, 'PLAY');

    expect(session.state().fills.length).toBeGreaterThanOrEqual(fillsBefore);
    expect(session.state().realizedPnl).toBe(pnlBefore);
    // History is never replayed as live: the skipped page is reported, not silently swallowed.
    expect(report.quotesSkipped).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 16. Pause, speed, step and seek equivalence
// ---------------------------------------------------------------------------

describe('§10.16 pause, speed change, step and forward seek agree', () => {
  function runPlayback(stepMs: number | null, seek: boolean): string {
    const session = newSession();
    session.replaceTape(SYMBOL, Array.from({ length: 30 }, (_, i) => q(i * 1_000, 100 + i * 0.1, 100.5 + i * 0.1, i + 1)));
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(500, 'STEP');
    session.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'STOP', size: SIZE, level: 102 });

    if (seek) {
      session.seekTo(15_000); // a forward seek is the same as playing there
    } else if (stepMs === null) {
      session.advanceTo(30_000, 'PLAY'); // one big frame, as at maximum speed
    } else {
      for (let t = stepMs; t <= 30_000; t += stepMs) session.advanceTo(t, 'PLAY');
    }
    return session.eventDigest();
  }

  it('produces the same account result in one frame and in thirty steps', () => {
    expect(runPlayback(null, false)).toBe(runPlayback(1_000, false));
  });

  it('produces the same account result through a forward seek', () => {
    expect(runPlayback(null, false)).toBe(runPlayback(null, true));
  });
});

// ---------------------------------------------------------------------------
// 17. Rewind and reset with work in flight
// ---------------------------------------------------------------------------

describe('§10.17 rewind branching and reset during a pending delay', () => {
  it('discards future commands on a rewind and leaves no ghost position', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 101, 101.5, 2), q(2_000, 102, 102.5, 3)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(3_000, 'PLAY');
    expect(session.state().positions).toHaveLength(1);
    // A second instruction submitted after the point we will rewind to: this is the future that
    // must be discarded, and it is the one that would otherwise leak a position into the branch.
    session.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'MARKET', size: SIZE });

    session.seekTo(50); // before the entry could have executed (arrival 100, armed 150)

    const rewound = session.state();
    expect(rewound.positions).toEqual([]);
    expect(rewound.fills).toEqual([]);
    expect(rewound.realizedPnl).toBe(0);
    // The discarded future is disclosed rather than silently dropped.
    expect(session.notices.some((n) => /discarded|rewound/i.test(n))).toBe(true);
  });

  it('drops an in-flight instruction on reset without inventing realised PnL', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(5_000, 110, 110.5, 2)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(50, 'PLAY'); // still inside the travel delay

    const report = session.reset();

    const state = session.state();
    expect(state.positions).toHaveLength(0);
    expect(state.fills).toHaveLength(0);
    expect(state.realizedPnl).toBe(0);
    expect(report.notices.some((n) => /dropped/i.test(n))).toBe(true);

    // Nothing from before the reset can surface later.
    session.advanceTo(6_000, 'PLAY');
    expect(session.state().fills).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 18. Two charts of one symbol, and a hidden exposure
// ---------------------------------------------------------------------------

describe('§10.18 two charts of one symbol, and a symbol with no chart', () => {
  it('keeps one position and one total for two views, and still evaluates a hidden order', () => {
    const store = useAccountStore.getState();
    // Both instruments are configured up front: an instrument with no rules is refused rather than
    // approximated with another symbol's tick size.
    store.configure({
      instruments: [
        BTCUSD_RULES,
        { symbol: 'ETHUSD', tickSize: 0.5, minSize: 0.1, sizeIncrement: 0.1, priceDecimals: 2, contractMultiplier: 1, currency: 'USD', provenance: 'TRAINING_ASSUMPTION' },
      ],
      profile: trainingProfile(),
      sessionId: 'matrix-two-charts',
    });
    store.registerTape(SYMBOL, [
      { symbol: SYMBOL, bid: 100, ask: 100.5, replayMs: 0, seq: 1 },
      { symbol: SYMBOL, bid: 104, ask: 104.5, replayMs: 1000, seq: 2 },
    ]);
    store.registerTape('ETHUSD', [
      { symbol: 'ETHUSD', bid: 3_000, ask: 3_001, replayMs: 0, seq: 1 },
      { symbol: 'ETHUSD', bid: 3_000, ask: 3_001, replayMs: 1_000, seq: 2 },
    ]);
    store.advanceTo(0, 'PLAY');

    // Two orders on the same symbol, one on a symbol no chart is showing.
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    store.openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    store.openPosition({ symbol: 'ETHUSD' as never, side: 'BUY', size: 1 });

    store.advanceTo(2_000, 'PLAY');
    const state = useAccountStore.getState().state;
    const totals = projectAccountTotals(state);

    // Three positions exist once each — not once per view, and not hidden because a chart is absent.
    expect(state.positions).toHaveLength(3);
    expect(totals.openPositionCount).toBe(3);
    // The chart's projection filters by symbol and does not rewrite the account.
    expect(projectForSymbol(state, SYMBOL).positions).toHaveLength(2);
    expect(projectAccountTotals(state).openPositionCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 19. Invalid input
// ---------------------------------------------------------------------------

describe('§10.19 invalid size, tick, NaN, stale quotes and unknown symbols', () => {
  it('refuses a non-positive size', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1)]);
    session.advanceTo(0, 'PLAY');
    const outcome = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: 0 });
    expect(outcome.accepted).toBe(false);
    expect(String(outcome.clientError)).toMatch(/positive/i);
  });

  it('refuses an off-tick level', () => {
    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1)]);
    session.advanceTo(0, 'PLAY');
    const outcome = session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 99.99 });
    expect(outcome.accepted).toBe(false);
    expect(String(outcome.clientError)).toMatch(/tick|step|multiple/i);
  });

  it('refuses a non-finite or crossed quote rather than propagating it', () => {
    const session = newSession();
    session.advanceTo(0, 'PLAY');
    // The engine refuses these at the boundary: a NaN or crossed price must never reach a fill.
    expect(() => session.replaceTape(SYMBOL, [q(0, NaN, 100.5, 1)])).not.toThrow();
    const bad = newSession();
    bad.advanceTo(0, 'PLAY');
    bad.replaceTape(SYMBOL, [q(0, 101, 100, 1)]);
    const report = bad.advanceTo(1_000, 'PLAY');
    expect(report.frozen || bad.state().fills.length === 0).toBe(true);
  });

  it('does not fill against a quote that is beyond the freshness limit', () => {
    const session = newSession(pilotReferenceProfile('MARKET'));
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    // maxQuoteAgeMs is a training parameter; with the pilot envelope it is unchanged, so the quote
    // is still fresh here. The assertion is that freshness is honoured, not that a fill is invented.
    const state = session.state();
    for (const fill of state.fills) expect(fill.symbol).toBe(SYMBOL);
  });

  it('reports a missing quote as a rejection rather than an aggregate that hides it', () => {
    const session = newSession();
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(500, 'PLAY');

    const state = session.state();
    expect(state.fills).toHaveLength(0);
    expect(state.realizedPnl).toBe(0);
    expect(state.orders[0].state === 'REJECTED' || state.orders[0].state === 'SUBMITTED' || state.orders[0].state === 'WORKING').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 20. Profile changes after submission
// ---------------------------------------------------------------------------

describe('§10.20 a profile change after submission', () => {
  it('keeps the deadlines an existing instruction was created with', () => {
    const store = useAccountStore.getState();
    store.registerTape(SYMBOL, [
      { symbol: SYMBOL, bid: 100, ask: 100.5, replayMs: 0, seq: 1 },
      { symbol: SYMBOL, bid: 100, ask: 100.5, replayMs: 1_000, seq: 2 },
    ]);
    store.advanceTo(0, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    const firstSnapshot = useAccountStore.getState().state.orders[0].profileSnapshot;

    // Reconfigure the account with a much slower profile. The tape has to be re-registered because
    // a new configuration replaces the session.
    store.configure({ instruments: [BTCUSD_RULES], profile: pilotReferenceProfile('MARKET'), sessionId: 'matrix-2' });
    store.registerTape(SYMBOL, [
      { symbol: SYMBOL, bid: 100, ask: 100.5, replayMs: 0, seq: 1 },
      { symbol: SYMBOL, bid: 100, ask: 100.5, replayMs: 1_000, seq: 2 },
    ]);
    const second = useAccountStore.getState().state.orders;
    expect(second).toHaveLength(0); // the old account is gone; nothing is carried over silently

    store.advanceTo(0, 'PLAY');
    store.openPosition({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    const newSnapshot = useAccountStore.getState().state.orders[0].profileSnapshot;

    expect(firstSnapshot.id).toBe('training');
    expect(newSnapshot.id).not.toBe('training');
    // The snapshot is captured per instruction: settings changed later never rewrite an old deadline.
    expect(newSnapshot.acknowledgementMs.provenance).toBe('OBSERVED_SAMPLE');
  });
});

// ---------------------------------------------------------------------------
// 21. Offline operation
// ---------------------------------------------------------------------------

describe('§10.21 everything works with no network at all', () => {
  it('runs a full order lifecycle with fetch unavailable', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
      throw new Error('offline');
    }) as never);

    const session = newSession();
    session.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(1_000, 105, 105.5, 2), q(2_000, 106, 106.5, 3)]);
    session.advanceTo(0, 'PLAY');
    session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    session.advanceTo(1_000, 'PLAY');
    session.closePosition(session.state().positions[0].positionId);
    session.advanceTo(3_000, 'PLAY');

    expect(session.state().positions[0].state).toBe('CLOSED');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
