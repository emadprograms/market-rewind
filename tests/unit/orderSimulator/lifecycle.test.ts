import { describe, it, expect } from 'vitest';
import { makeEngine } from '../../../src/lib/orderSimulator/__testkit__/harness';
import { trainingProfile } from '../../../src/lib/orderSimulator/profiles';
import type { PositionId, OrderId } from '../../../src/lib/orderSimulator/types';

/**
 * Order lifecycles: latency staging, fills, positions, attached exits, and closing.
 *
 * Timing assertions use the documented training profile (travel 100, acceptance 0, acknowledgement
 * envelope 210, dispatch 50, notification 100). Those are disclosed training assumptions, so the
 * tests pin the ENGINE's staging, not a claim about a real broker.
 */

const SIZE = 0.01;
const BID = 100.0;
const ASK = 100.5;

function seededAtZero() {
  const engine = makeEngine({ profile: trainingProfile() });
  engine.onQuote({ symbol: 'BTCUSD', bid: BID, ask: ASK, replayMs: 0, seq: 1 });
  return engine;
}

describe('order simulator — latency staging', () => {
  it('stages submit → arrive → accept → eligible → fill at the documented times', () => {
    const engine = seededAtZero();
    const submitted = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    expect(submitted.accepted).toBe(true);

    engine.runUntil(200);

    const stages = engine
      .eventLog()
      .filter((e) => ['COMMAND_SUBMITTED', 'COMMAND_ARRIVED', 'ACCEPTED', 'ELIGIBLE', 'FILLED'].includes(e.kind))
      .map((e) => `${e.kind}@${e.replayMs}`);
    expect(stages).toEqual([
      'COMMAND_SUBMITTED@0',
      'COMMAND_ARRIVED@100', // travel
      'ACCEPTED@100', // acceptance 0
      'ELIGIBLE@150', // dispatch 50
      'FILLED@150',
    ]);
  });

  it('fills a BUY at the ask and a SELL at the bid', () => {
    const buy = seededAtZero();
    buy.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    buy.runUntilIdle();
    expect(buy.view().fills[0].price).toBe(ASK);

    const sell = seededAtZero();
    sell.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'MARKET', size: SIZE });
    sell.runUntilIdle();
    expect(sell.view().fills[0].price).toBe(BID);
  });

  it('delivers the fill notification after the economics, with the delay visible', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const notices = engine.eventLog().filter((e) => e.kind === 'NOTICE_DELIVERED' && e.detail.notice === 'FILL_NOTIFICATION');
    expect(notices).toHaveLength(1);
    expect(notices[0].detail.economicsAtMs).toBe(150);
    expect(notices[0].replayMs).toBe(250); // fill 150 + notification 100
    expect(notices[0].detail.notificationDelayMs).toBe(100);
  });

  it('an acceptance notice can arrive after the fill already happened', () => {
    // Acknowledgement is measured as an envelope from submission (210), while eligibility is
    // acceptance + dispatch (150). Real systems show this inversion; the engine models it rather
    // than pretending the ack always precedes execution.
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const ack = engine.eventLog().find((e) => e.kind === 'NOTICE_DELIVERED' && e.detail.notice === 'ORDER_UPDATE');
    expect(ack?.replayMs).toBe(210);
    const fill = engine.view().fills[0];
    expect(fill.replayMs).toBe(150);
    expect(ack!.replayMs).toBeGreaterThan(fill.replayMs);
  });

  it('waits instead of filling against a quote older than the freshness limit', () => {
    const engine = makeEngine({
      profile: { ...trainingProfile(), maxQuoteAgeMs: { value: 50, provenance: 'TRAINING_ASSUMPTION' } },
    });
    // The order is accepted at t=100 against a quote from t=0 — 100 ms old, beyond the 50 ms limit.
    engine.onQuote({ symbol: 'BTCUSD', bid: BID, ask: ASK, replayMs: 0, seq: 1 });
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntil(200);
    expect(engine.view().fills).toHaveLength(0);
    expect(engine.view().orders[0].state).toBe('REJECTED');
    expect(engine.view().orders[0].rejectReason).toBe('STALE_QUOTE');
  });

  it('fills against a fresh quote once one is inside the freshness limit', () => {
    // travel 100 means the order is accepted 100 ms after submission, so the limit must accommodate
    // that for the fill to happen at all. 200 ms is comfortably inside a 250 ms allowance.
    const engine = makeEngine({
      profile: { ...trainingProfile(), maxQuoteAgeMs: { value: 250, provenance: 'TRAINING_ASSUMPTION' } },
    });
    engine.onQuote({ symbol: 'BTCUSD', bid: BID, ask: ASK, replayMs: 1_000, seq: 1 });
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntil(1_400);
    expect(engine.view().fills).toHaveLength(1);
    expect(engine.view().fills[0].price).toBe(ASK);
  });
});

describe('order simulator — positions', () => {
  it('opens a LONG position from a BUY with the full entry size', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const positions = engine.openPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].direction).toBe('LONG');
    expect(positions[0].entryPrice).toBe(ASK);
    expect(positions[0].size).toBe(SIZE);
    expect(positions[0].openSize).toBe(SIZE);
    expect(positions[0].state).toBe('OPEN');
  });

  it('opens a SHORT position from a SELL', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    expect(engine.openPositions()[0].direction).toBe('SHORT');
    expect(engine.openPositions()[0].entryPrice).toBe(BID);
  });

  it('keeps two positions independent rather than netting them (no netting model)', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    engine.onQuote({ symbol: 'BTCUSD', bid: 101.0, ask: 101.5, replayMs: 1000, seq: 2 });
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const positions = engine.openPositions();
    expect(positions).toHaveLength(2);
    // Distinct position ids and distinct entry prices: nothing was merged.
    expect(new Set(positions.map((p) => p.positionId)).size).toBe(2);
    expect(positions.map((p) => p.entryPrice).sort()).toEqual([ASK, 101.5]);
  });
});

describe('order simulator — attached exits', () => {
  it('attaches a stop-loss and a take-profit on the opposite side to the position', () => {
    const engine = seededAtZero();
    engine.submitOrder({
      symbol: 'BTCUSD',
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();

    const position = engine.openPositions()[0];
    expect(position.slOrderId).not.toBeNull();
    expect(position.tpOrderId).not.toBeNull();

    const exits = engine.view().orders.filter((o) => o.purpose === 'STOP_LOSS' || o.purpose === 'TAKE_PROFIT');
    expect(exits).toHaveLength(2);
    for (const exit of exits) {
      expect(exit.side).toBe('SELL'); // opposite of LONG
      expect(exit.positionId).toBe(position.positionId);
    }
    expect(exits.find((o) => o.purpose === 'STOP_LOSS')!.type).toBe('STOP');
    expect(exits.find((o) => o.purpose === 'TAKE_PROFIT')!.type).toBe('LIMIT');
  });

  it('closes the position when the stop-loss triggers and cancels the take-profit', () => {
    const engine = seededAtZero();
    engine.submitOrder({
      symbol: 'BTCUSD',
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();

    // Drop through the stop: SELL STOP fires on the bid <= 99.
    engine.onQuote({ symbol: 'BTCUSD', bid: 98.9, ask: 99.0, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();

    expect(engine.openPositions()).toHaveLength(0);
    const position = engine.view().positions[0];
    expect(position.state).toBe('CLOSED');
    expect(position.openSize).toBe(0);

    // Realised loss: sold at the bid 98.9 against an entry of 100.5.
    expect(position.realizedPnl).toBeCloseTo((98.9 - ASK) * SIZE, 6);

    const cancelled = engine.eventLog().filter((e) => e.kind === 'CANCELLED' && e.detail.cause === 'SIBLING_EXIT_FILLED');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].detail.note).toMatch(/no longer meaningful/);
  });

  it('closes the position when the take-profit fills', () => {
    const engine = seededAtZero();
    engine.submitOrder({
      symbol: 'BTCUSD',
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { takeProfit: 102.0 },
    });
    engine.runUntilIdle();

    engine.onQuote({ symbol: 'BTCUSD', bid: 102.0, ask: 102.05, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();

    const position = engine.view().positions[0];
    expect(position.state).toBe('CLOSED');
    expect(position.realizedPnl).toBeCloseTo((102.0 - ASK) * SIZE, 6);
  });

  it('refuses an exit attached on the wrong side', () => {
    const engine = seededAtZero();
    engine.submitOrder({
      symbol: 'BTCUSD',
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 101.0 }, // a LONG stop-loss must sit BELOW the market
    });
    engine.runUntilIdle();

    const rejected = engine.eventLog().filter((e) => e.kind === 'REJECTED' && e.detail.stage === 'ATTACHMENT');
    expect(rejected).toHaveLength(1);
    expect(engine.openPositions()[0].slOrderId).toBeNull();
  });

  it('turns a SELL position’s exits the other way round', () => {
    const engine = seededAtZero();
    engine.submitOrder({
      symbol: 'BTCUSD',
      side: 'SELL',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 102.0, takeProfit: 99.0 },
    });
    engine.runUntilIdle();

    const exits = engine.view().orders.filter((o) => o.purpose === 'STOP_LOSS' || o.purpose === 'TAKE_PROFIT');
    for (const exit of exits) expect(exit.side).toBe('BUY');
    expect(exits.find((o) => o.purpose === 'STOP_LOSS')!.level).toBe(102.0);
  });
});

describe('order simulator — closing', () => {
  it('closes by POSITION id and realizes the correct PnL', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const position = engine.openPositions()[0];
    engine.onQuote({ symbol: 'BTCUSD', bid: 101.0, ask: 101.5, replayMs: 5_000, seq: 2 });
    const close = engine.closePosition(position.positionId);
    expect(close.accepted).toBe(true);
    engine.runUntilIdle();

    expect(engine.openPositions()).toHaveLength(0);
    const closed = engine.view().positions[0];
    expect(closed.state).toBe('CLOSED');
    // Closed at the bid 101.0 against an entry of 100.5.
    expect(closed.realizedPnl).toBeCloseTo((101.0 - ASK) * SIZE, 6);
    expect(engine.view().realizedPnl).toBeCloseTo((101.0 - ASK) * SIZE, 6);
  });

  it('REFUSES a close that targets an ORDER id — the exact defect from the pilot', () => {
    // The pilot's cleanup sent DELETE /positions/<submission deal id> and got
    // 404 error.not-found.dealId, leaving two positions open while the manifest claimed a clean run.
    const engine = seededAtZero();
    const submitted = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const asPositionId = submitted.orderId as unknown as PositionId;
    const attempt = engine.closePosition(asPositionId);
    expect(attempt.accepted).toBe(false);
    expect(attempt.clientError).toMatch(/No position with id O-1/);

    // The real position is untouched and still open.
    expect(engine.openPositions()).toHaveLength(1);
  });

  it('refuses a second close while one is already in flight', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];

    expect(engine.closePosition(position.positionId).accepted).toBe(true);
    const second = engine.closePosition(position.positionId);
    expect(second.accepted).toBe(false);
    expect(second.clientError).toMatch(/already has a close in flight/);
  });

  it('refuses to close a position that is already closed', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];
    engine.closePosition(position.positionId);
    engine.runUntilIdle();

    const again = engine.closePosition(position.positionId);
    expect(again.accepted).toBe(false);
    expect(again.clientError).toMatch(/is CLOSED and cannot be closed again/);
  });

  it('refuses to close an unknown position id', () => {
    const engine = seededAtZero();
    const attempt = engine.closePosition('P-does-not-exist' as PositionId);
    expect(attempt.clientError).toMatch(/No position with id P-does-not-exist/);
  });
});

describe('order simulator — cancelling', () => {
  it('cancels a resting limit and removes it from the working set', () => {
    const engine = seededAtZero();
    const submitted = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();
    expect(engine.view().orders[0].state).toBe('WORKING');

    engine.cancelOrder(submitted.orderId as OrderId);
    engine.runUntilIdle();
    expect(engine.view().orders[0].state).toBe('CANCELLED');
    expect(engine.view().orders[0].terminalAt).not.toBeNull();
  });

  it('refuses to cancel an order that has already filled', () => {
    const engine = seededAtZero();
    const submitted = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const attempt = engine.cancelOrder(submitted.orderId as OrderId);
    expect(attempt.accepted).toBe(false);
    expect(attempt.clientError).toMatch(/is FILLED and can no longer be cancelled/);
  });

  it('refuses to cancel an unknown order', () => {
    const engine = seededAtZero();
    expect(engine.cancelOrder('O-nope' as OrderId).clientError).toMatch(/No order with id O-nope/);
  });
});

describe('order simulator — amendments', () => {
  it('amends a resting order and bumps its version', () => {
    const engine = seededAtZero();
    const submitted = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();
    expect(engine.view().orders[0].version).toBe(0);

    engine.amendOrder(submitted.orderId as OrderId, 0, 95.5);
    engine.runUntilIdle();
    const order = engine.view().orders[0];
    expect(order.level).toBe(95.5);
    expect(order.version).toBe(1);
  });

  it('refuses a stale amendment so a lost race cannot overwrite newer state', () => {
    const engine = seededAtZero();
    const submitted = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();
    engine.amendOrder(submitted.orderId as OrderId, 0, 95.5);
    engine.runUntilIdle();

    const stale = engine.amendOrder(submitted.orderId as OrderId, 0, 96);
    expect(stale.accepted).toBe(false);
    expect(stale.clientError).toMatch(/stale: instruction targets version 0 but order is at version 1/);
    expect(engine.view().orders[0].level).toBe(95.5);
  });

  it('re-arms the trigger after an amendment because the level genuinely changed', () => {
    const engine = seededAtZero();
    const submitted = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();
    engine.amendOrder(submitted.orderId as OrderId, 0, 96);
    engine.runUntilIdle();

    const order = engine.view().orders[0];
    expect(order.state).toBe('WORKING');
    expect(order.triggeredAt).toBeNull();

    // The new level is reached, so it must be live again.
    // A buy limit at 96 fills when the ASK falls to 96.
    engine.onQuote({ symbol: 'BTCUSD', bid: 95.9, ask: 96.0, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();
    expect(engine.view().fills).toHaveLength(1);
    expect(engine.view().fills[0].price).toBe(96.0);
  });
});

describe('order simulator — accounting identity', () => {
  it('counts realized PnL once for a full round trip', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const position = engine.openPositions()[0];
    engine.onQuote({ symbol: 'BTCUSD', bid: 103.0, ask: 103.5, replayMs: 5_000, seq: 2 });
    engine.closePosition(position.positionId);
    engine.runUntilIdle();

    const expected = (103.0 - ASK) * SIZE;
    expect(engine.view().realizedPnl).toBeCloseTo(expected, 6);
    // Account realized PnL equals the sum over positions: nothing is double-counted.
    const fromPositions = engine.view().positions.reduce((sum, p) => sum + p.realizedPnl, 0);
    expect(engine.view().realizedPnl).toBeCloseTo(fromPositions, 6);
  });

  it('never reports a negative open size after an exit', () => {
    const engine = seededAtZero();
    engine.submitOrder({
      symbol: 'BTCUSD',
      side: 'BUY',
      type: 'MARKET',
      size: SIZE,
      attachments: { stopLoss: 99.0, takeProfit: 102.0 },
    });
    engine.runUntilIdle();
    engine.onQuote({ symbol: 'BTCUSD', bid: 98.9, ask: 99.0, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();
    engine.onQuote({ symbol: 'BTCUSD', bid: 102.0, ask: 102.05, replayMs: 6_000, seq: 3 });
    engine.runUntilIdle();

    for (const position of engine.view().positions) {
      expect(position.openSize).toBeGreaterThanOrEqual(0);
    }
    // The take-profit must NOT have fired after the position was already closed.
    expect(engine.view().fills).toHaveLength(2); // the entry and the stop
  });

  it('reports unrealized PnL from the close side of the spread', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    // A LONG is valued at the bid, never the ask.
    engine.onQuote({ symbol: 'BTCUSD', bid: 101.0, ask: 101.5, replayMs: 5_000, seq: 2 });
    expect(engine.view().unrealizedPnl).toBeCloseTo((101.0 - ASK) * SIZE, 6);
  });

  it('counts realized PnL exactly once across two independent positions', () => {
    const engine = seededAtZero();
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    engine.onQuote({ symbol: 'BTCUSD', bid: 101.0, ask: 101.5, replayMs: 1_000, seq: 2 });
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const [first, second] = engine.openPositions();
    engine.closePosition(first.positionId);
    engine.runUntilIdle();
    engine.closePosition(second.positionId);
    engine.runUntilIdle();

    const expected = (101.0 - ASK) * SIZE + (101.0 - 101.5) * SIZE;
    expect(engine.view().realizedPnl).toBeCloseTo(expected, 6);
  });
});
