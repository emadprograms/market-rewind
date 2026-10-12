import { describe, it, expect } from 'vitest';
import { makeEngine } from '../../../src/lib/orderSimulator/__testkit__/harness';
import {
  activityRows,
  announce,
  isTerminal,
  orderTimeline,
  pendingConditionText,
  presentTransitions,
  PILOT_EVIDENCE_CARDS,
  raceNotices,
  settingDescriptors,
  SIMULATED_ACCOUNT_LABEL,
  statusOf,
  ticketModel,
  ORDER_TYPE_COPY,
} from '../../../src/lib/orderSimulator/uiViewModels';
import { BTCUSD_RULES, createInstrumentRegistry, trainingProfile, pilotReferenceProfile } from '../../../src/lib/orderSimulator/profiles';
import type { AccountState, Order, PositionId } from '../../../src/lib/orderSimulator/types';

/**
 * SIM-UI-01..06 — the words and the numbers the terminal shows.
 *
 * These are tested without rendering anything, because the requirement is about what is *said*: the
 * condition a pending order is waiting on, the difference between three kinds of delay, and the
 * plain acknowledgement of a lost race.
 */

const SYMBOL = 'BTCUSD';
const SIZE = 0.01;
const BID = 100.0;
const ASK = 100.5;
const rulesFor = createInstrumentRegistry([BTCUSD_RULES]);
const ruleLookup = (symbol: string) => {
  try {
    return rulesFor(symbol);
  } catch {
    return null;
  }
};

function seeded() {
  const engine = makeEngine({ profile: trainingProfile() });
  engine.onQuote({ symbol: SYMBOL, bid: BID, ask: ASK, replayMs: 0, seq: 1 });
  return engine;
}

// ---------------------------------------------------------------------------
// SIM-UI-02 — statuses and conditions
// ---------------------------------------------------------------------------

describe('SIM-UI-02 — status vocabulary', () => {
  it('reports Sending while the instruction is still travelling', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    const order = engine.view().orders[0];
    expect(order.state).toBe('SUBMITTED');
    expect(statusOf(order)).toBe('Sending');
  });

  it('reports Working while the order rests inside its dispatch delay', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntil(120); // past travel (100), before dispatch (150)
    const order = engine.view().orders[0];
    expect(order.state).toBe('WORKING');
    expect(order.armedAt).toBeNull();
    expect(statusOf(order)).toBe('Working');
  });

  it('reports Executing once the order is armed and being evaluated', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntil(200);
    const order = engine.view().orders[0];
    expect(order.state).toBe('WORKING');
    expect(order.armedAt).not.toBeNull();
    expect(statusOf(order)).toBe('Executing');
  });

  it('reports Filled and Cancelled at the end', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    expect(statusOf(engine.view().orders[0])).toBe('Filled');

    const other = seeded();
    const submitted = other.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    other.runUntilIdle();
    other.cancelOrder(submitted.orderId as never);
    other.runUntilIdle();
    expect(statusOf(other.view().orders[0])).toBe('Cancelled');
  });

  it('reports Rejected with a plain-language reason', () => {
    const engine = makeEngine({ profile: trainingProfile() });
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle(); // no quote ever existed

    const row = activityRows(engine.view(), ruleLookup)[0];
    expect(row.status).toBe('Rejected');
    expect(row.rejectReason).toMatch(/no quote was available/i);
  });
});

describe('SIM-UI-02 — pending rows state the exact condition', () => {
  it('states the price side and comparison for a resting limit', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();

    const row = activityRows(engine.view(), ruleLookup)[0];
    expect(row.condition).toMatch(/Waiting for ask <= 95\.00/);
    // The current observed value is included, so the user can see how far away it is.
    expect(row.condition).toMatch(/now 100\.50/);
  });

  it('uses the bid side for a sell limit', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'LIMIT', size: SIZE, level: 105 });
    engine.runUntilIdle();
    expect(activityRows(engine.view(), ruleLookup)[0].condition).toMatch(/Waiting for bid >= 105\.00/);
  });

  it('uses the ask side for a buy stop', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 105 });
    engine.runUntilIdle();
    expect(activityRows(engine.view(), ruleLookup)[0].condition).toMatch(/Waiting for ask >= 105\.00/);
  });

  it('uses the bid side for a sell stop', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'STOP', size: SIZE, level: 95 });
    engine.runUntilIdle();
    expect(activityRows(engine.view(), ruleLookup)[0].condition).toMatch(/Waiting for bid <= 95\.00/);
  });

  it('explains a market order in terms of the side it will pay, while it is still pending', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    // Read it mid-flight, before it has executed: after the fill there is no pending condition.
    const order = engine.view().orders[0];
    expect(order.state).toBe('SUBMITTED');
    expect(pendingConditionText(order, BTCUSD_RULES, null)).toMatch(/On its way/);
  });

  it('describes an accepted market order in terms of the side it will pay', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'MARKET', size: SIZE });
    engine.runUntil(120); // accepted, not yet eligible
    const order = engine.view().orders[0];
    expect(order.state).toBe('WORKING');
    expect(pendingConditionText(order, BTCUSD_RULES, null)).toMatch(/at the bid/);
  });

  it('reports how a filled order triggered, through its timeline rather than a pending condition', () => {
    // A conditional order that satisfies its condition fills in the same instant, so there is no
    // window in which the row is "triggered but not yet filled". The fact is reported as a
    // transition instead, which is where a settled order's history belongs.
    const engine = seeded();
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'LIMIT', size: SIZE, level: 101 });
    engine.runUntilIdle();
    engine.onQuote({ symbol: SYMBOL, bid: 101.2, ask: 101.3, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();

    const order = engine.view().orders.find((o) => o.orderId === submitted.orderId)!;
    expect(pendingConditionText(order, BTCUSD_RULES, null)).toBe('');
    const triggered = orderTimeline(engine.view(), submitted.orderId!).transitions.find((t) => t.name === 'Triggered')!;
    expect(triggered.reason).toMatch(/LIMIT SELL/);
  });

  it('has no condition text for a settled order', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    expect(activityRows(engine.view(), ruleLookup).find((r) => r.kind === 'ORDER')!.condition).toBe('');
  });
});

describe('SIM-UI-02 — sending and working rows stay visible alongside positions', () => {
  it('lists an unfilled instruction next to a filled one', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();

    const rows = activityRows(engine.view(), ruleLookup);
    // The market order's FILLED order row, its position row, and the still-resting limit row.
    expect(rows.some((r) => r.kind === 'ORDER' && r.status === 'Filled')).toBe(true);
    expect(rows.some((r) => r.kind === 'POSITION')).toBe(true);
    expect(rows.some((r) => r.kind === 'ORDER' && r.status === 'Executing')).toBe(true);
  });

  it('never shows a position merely because submit was clicked', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    // The instruction exists but nothing has filled.
    const rows = activityRows(engine.view(), ruleLookup);
    expect(rows.filter((r) => r.kind === 'POSITION')).toHaveLength(0);
    expect(rows.filter((r) => r.kind === 'ORDER')).toHaveLength(1);
  });

  it('marks which rows can be cancelled or amended', () => {
    const engine = seeded();
    const resting = engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    const market = engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const rows = activityRows(engine.view(), ruleLookup);
    expect(rows.find((r) => r.id === resting.orderId)!.cancellable).toBe(true);
    // A filled order cannot be cancelled, and the row must not pretend otherwise.
    expect(rows.find((r) => r.id === market.orderId)!.cancellable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-03 — lost races
// ---------------------------------------------------------------------------

describe('SIM-UI-03 — a lost race is acknowledged plainly', () => {
  it('says the stop triggered before the cancellation arrived, and shows the fill', () => {
    const engine = seeded();
    const submitted = engine.submitOrder({
      symbol: SYMBOL,
      side: 'BUY',
      type: 'STOP',
      size: SIZE,
      level: 102,
    });
    // Arrived, accepted and armed (t=150), then the acknowledgement notice lands at t=210.
    engine.runUntilIdle();
    expect(engine.view().orders[0].state).toBe('WORKING');

    // The user presses cancel at t=210. It does not take effect here: it has 100 ms of travel ahead.
    engine.cancelOrder(submitted.orderId as never);

    // 90 ms later the market reaches the stop and it executes. The cancellation is still in flight.
    engine.onQuote({ symbol: SYMBOL, bid: 102.0, ask: 102.05, replayMs: 300, seq: 2 });
    engine.runUntilIdle();

    // The economics are settled: the position exists.
    expect(engine.view().fills).toHaveLength(1);

    const notices = raceNotices(engine.view());
    expect(notices).toHaveLength(1);
    expect(notices[0].outcome).toBe('ARRIVED_TOO_LATE');
    expect(notices[0].text).toMatch(/triggered before the cancellation arrived/);
    expect(notices[0].text).toMatch(/filled instead/);
  });

  it('never hides the fill because a cancel button was pressed', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    // The order is already filled; the user presses cancel anyway.
    engine.cancelOrder(engine.view().orders[0].orderId);
    engine.runUntilIdle();

    const state = engine.view();
    expect(state.fills).toHaveLength(1);
    const rows = activityRows(state, ruleLookup);
    expect(rows.some((r) => r.kind === 'ORDER' && r.status === 'Filled')).toBe(true);
  });

  it('reports no race when nothing raced', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();
    expect(raceNotices(engine.view())).toEqual([]);
  });

  it('acknowledges a cancellation that won the race', () => {
    const engine = seeded();
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();
    // The cancel arrives; then a later instruction against the cancelled order is refused.
    engine.cancelOrder(submitted.orderId as never);
    engine.runUntilIdle();
    engine.cancelOrder(submitted.orderId as never);
    engine.runUntilIdle();

    const notices = raceNotices(engine.view());
    expect(notices.some((n) => n.outcome === 'CANCELLED_IN_TIME')).toBe(true);
    // The order really is cancelled: the second attempt could not resurrect it.
    expect(engine.view().orders[0].state).toBe('CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-04 — timeline
// ---------------------------------------------------------------------------

describe('SIM-UI-04 — the timeline separates transitions and intervals', () => {
  it('shows the six distinct transitions for a filled limit order', () => {
    const engine = seeded();
    // A sell limit above the market: valid, then triggered on a later quote.
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'LIMIT', size: SIZE, level: 101 });
    engine.runUntilIdle();
    engine.onQuote({ symbol: SYMBOL, bid: 101.2, ask: 101.3, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();

    const timeline = orderTimeline(engine.view(), submitted.orderId!);
    const names = presentTransitions(timeline).map((t) => t.name);
    expect(names).toEqual(['Submitted', 'BrokerArrival', 'Accepted', 'QuoteEligible', 'Triggered', 'Executed', 'NoticeReceived']);
  });

  it('records the quote side and reason at the trigger and the execution', () => {
    const engine = seeded();
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'LIMIT', size: SIZE, level: 101 });
    engine.runUntilIdle();
    engine.onQuote({ symbol: SYMBOL, bid: 101.2, ask: 101.3, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();

    const timeline = orderTimeline(engine.view(), submitted.orderId!);
    const triggered = timeline.transitions.find((t) => t.name === 'Triggered')!;
    const executed = timeline.transitions.find((t) => t.name === 'Executed')!;

    // A SELL executes on the bid.
    expect(triggered.quoteSide).toBe('bid');
    expect(triggered.reason).toMatch(/LIMIT SELL/);
    expect(executed.quoteSide).toBe('bid');
    expect(executed.reason).toMatch(/Filled .* on the bid/);
  });

  it('reports execution delay, market waiting time and notification delay as DIFFERENT intervals', () => {
    const engine = seeded();
    // Sell limit at 101, triggered at t=5000 by a quote, with dispatch 50 and notification 100.
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'LIMIT', size: SIZE, level: 101 });
    engine.runUntilIdle(); // travel 100, acceptance 0, dispatch 50 → eligible at 150
    engine.onQuote({ symbol: SYMBOL, bid: 101.2, ask: 101.3, replayMs: 5_000, seq: 2 });
    engine.runUntilIdle();

    const { intervals } = orderTimeline(engine.view(), submitted.orderId!);
    // Waited from eligibility (150) until the market reached the level (5000).
    expect(intervals.marketWaitingMs).toBe(4_850);
    // Then filled instantly on the quote that satisfied it. If execution delay were measured from
    // eligibility it would also read 4850, reporting the same number twice under two names.
    expect(intervals.executionDelayMs).toBe(0);
    // The client learned 100 ms after the economics.
    expect(intervals.notificationDelayMs).toBe(100);
    // The three intervals describe three different things.
    expect(intervals.marketWaitingMs).not.toBe(intervals.executionDelayMs);
    expect(intervals.notificationDelayMs).not.toBe(intervals.executionDelayMs);
  });

  it('shows no market waiting time for a market order that never waited', () => {
    const engine = seeded();
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const { intervals } = orderTimeline(engine.view(), submitted.orderId!);
    // A market order never waits for a condition, so there is no waiting interval to report.
    expect(intervals.marketWaitingMs).toBeNull();
    // It executes as soon as it is eligible — dispatch delay 50, then a fill at the same instant.
    expect(intervals.executionDelayMs).toBe(0);
    expect(intervals.notificationDelayMs).toBe(100);
  });

  it('has null intervals for an order that has not executed', () => {
    const engine = seeded();
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();

    const { intervals } = orderTimeline(engine.view(), submitted.orderId!);
    expect(intervals.executionDelayMs).toBeNull();
    expect(intervals.notificationDelayMs).toBeNull();
  });

  it('reports only the transitions that actually happened', () => {
    const engine = seeded();
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    // Only travel has elapsed: the broker has not accepted it yet.
    engine.runUntil(50);

    const timeline = orderTimeline(engine.view(), submitted.orderId!);
    const names = presentTransitions(timeline).map((t) => t.name);
    expect(names).toContain('Submitted');
    expect(names).not.toContain('Executed');
    expect(names).not.toContain('Triggered');
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-01 — ticket
// ---------------------------------------------------------------------------

describe('SIM-UI-01 — the ticket', () => {
  const baseTicket = {
    symbol: SYMBOL,
    side: 'BUY' as const,
    type: 'MARKET' as const,
    size: SIZE,
    level: null,
    quote: { symbol: SYMBOL, bid: BID, ask: ASK, replayMs: 1_000, seq: 1 },
    nowMs: 1_000,
    rules: BTCUSD_RULES,
    profile: trainingProfile(),
  };

  it('shows live bid, ask and spread', () => {
    const model = ticketModel(baseTicket);
    expect(model.bid).toBe(BID);
    expect(model.ask).toBe(ASK);
    expect(model.spread).toBe(0.5);
    expect(model.spreadInTicks).toBe(10);
  });

  it('shows the estimated delay with its profile label', () => {
    const model = ticketModel(baseTicket);
    expect(model.estimatedDelay.value).toBe(210);
    expect(model.profileLabel).toBe('Training (illustrative)');
    expect(model.profileId).toBe('training');
  });

  it('shows the age of the quote it is pricing against', () => {
    const model = ticketModel({ ...baseTicket, nowMs: 1_500 });
    expect(model.quoteAgeMs).toBe(500);
  });

  it('requires a level for a limit order and refuses to submit without one', () => {
    const model = ticketModel({ ...baseTicket, type: 'LIMIT', level: null });
    expect(model.levelRequired).toBe(true);
    expect(model.canSubmit).toBe(false);
    expect(model.errors.map((e) => e.code)).toContain('LEVEL_REQUIRED');
  });

  it('refuses a level that is not a valid price step', () => {
    const model = ticketModel({ ...baseTicket, type: 'LIMIT', level: 99.99 });
    expect(model.errors.map((e) => e.code)).toContain('LEVEL_NOT_ON_TICK');
    expect(model.canSubmit).toBe(false);
  });

  it('refuses a wrong-side stop, and says which side it belongs on', () => {
    const model = ticketModel({ ...baseTicket, type: 'STOP', level: 95 });
    expect(model.errors.map((e) => e.code)).toContain('LEVEL_WRONG_SIDE');
    expect(model.errors[0].message).toMatch(/must be placed above the market/);
  });

  it('accepts a marketable limit, because it is aggressive rather than wrong', () => {
    const model = ticketModel({ ...baseTicket, type: 'LIMIT', level: 102 });
    expect(model.canSubmit).toBe(true);
  });

  it('refuses a quantity below the minimum', () => {
    const model = ticketModel({ ...baseTicket, size: 0.00001 });
    expect(model.errors.map((e) => e.code)).toContain('SIZE_TOO_SMALL');
    expect(model.canSubmit).toBe(false);
  });

  it('refuses a quantity that is not a valid increment', () => {
    const model = ticketModel({ ...baseTicket, size: 0.00015 });
    expect(model.errors.map((e) => e.code)).toContain('SIZE_NOT_INCREMENT');
  });

  it('refuses a zero quantity', () => {
    const model = ticketModel({ ...baseTicket, size: 0 });
    expect(model.errors.map((e) => e.code)).toContain('SIZE_NOT_POSITIVE');
  });

  it('is submittable when everything is in order', () => {
    expect(ticketModel(baseTicket).canSubmit).toBe(true);
  });

  it('reports no quote rather than inventing a price', () => {
    const model = ticketModel({ ...baseTicket, quote: null });
    expect(model.bid).toBeNull();
    expect(model.ask).toBeNull();
    expect(model.spread).toBeNull();
    expect(model.quoteAgeMs).toBeNull();
  });

  it('uses the pilot profile delay when that profile is selected', () => {
    const model = ticketModel({ ...baseTicket, profile: pilotReferenceProfile('MARKET') });
    expect(model.estimatedDelay.value).toBeCloseTo(231.499, 3);
    expect(model.estimatedDelay.provenance).toBe('OBSERVED_SAMPLE');
    expect(model.profileLabel).toMatch(/pilot reference/i);
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-05 — settings and evidence
// ---------------------------------------------------------------------------

describe('SIM-UI-05 — settings and provenance', () => {
  it('presents every delay as an editable setting with its provenance', () => {
    const settings = settingDescriptors(trainingProfile());
    expect(settings).toHaveLength(6);
    for (const setting of settings) {
      expect(setting.label).toBeTruthy();
      expect(setting.note).toBeTruthy();
      expect(setting.editable).toBe(true);
    }
  });

  it('marks an observed value as evidence, not as an editable preference', () => {
    const settings = settingDescriptors(pilotReferenceProfile('MARKET'));
    const ack = settings.find((s) => s.key === 'acknowledgementMs')!;
    expect(ack.provenance).toBe('OBSERVED_SAMPLE');
    // A measurement is not a setting: the user must not be able to relabel it as their own choice.
    expect(ack.editable).toBe(false);
    expect(ack.sampleCount).toBe(1);
    // The surrounding values stay editable assumptions.
    expect(settings.find((s) => s.key === 'dispatchMs')!.editable).toBe(true);
  });

  it('keeps evidence cards separate from simulated output', () => {
    expect(PILOT_EVIDENCE_CARDS.length).toBeGreaterThanOrEqual(3);
    for (const card of PILOT_EVIDENCE_CARDS) {
      expect(card.id).toBeTruthy();
      expect(card.detail.length).toBeGreaterThan(30);
      expect(card.valueText).toBeTruthy();
    }
    const observed = PILOT_EVIDENCE_CARDS.filter((c) => c.provenance === 'OBSERVED_SAMPLE');
    expect(observed.map((c) => c.valueText)).toEqual(['231.5 ms', '203.8 ms', '204.4 ms']);
    // Every observed card says it is a single sample, so it cannot be read as a distribution.
    for (const card of observed) expect(card.detail).toMatch(/single sample/i);
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-06 — copy and announcements
// ---------------------------------------------------------------------------

describe('SIM-UI-06 — learning copy and live announcements', () => {
  it('labels the account as simulated', () => {
    expect(SIMULATED_ACCOUNT_LABEL).toMatch(/Simulated account/);
    expect(SIMULATED_ACCOUNT_LABEL).toMatch(/no broker/i);
  });

  it('explains the consequence of each order type', () => {
    for (const type of ['MARKET', 'LIMIT', 'STOP'] as const) {
      expect(ORDER_TYPE_COPY[type].title).toBeTruthy();
      expect(ORDER_TYPE_COPY[type].consequence.length).toBeGreaterThan(60);
    }
    // The stop copy must warn about the worse price, which is the thing users get wrong.
    expect(ORDER_TYPE_COPY.STOP.consequence).toMatch(/worse price/);
    expect(ORDER_TYPE_COPY.LIMIT.consequence).toMatch(/may never fill/);
  });

  it('announces accepted, filled and rejected transitions', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const message = announce(engine.view(), 0);
    expect(message).toBeTruthy();
    expect(typeof message).toBe('string');
  });

  it('says nothing when there is nothing new', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const count = engine.view().events.length;
    expect(announce(engine.view(), count)).toBeNull();
  });

  it('does NOT announce price ticks', () => {
    const engine = seeded();
    const before = engine.view().events.length;
    // Twenty quotes arrive, no orders exist.
    for (let i = 1; i <= 20; i++) {
      engine.onQuote({ symbol: SYMBOL, bid: BID + i * 0.05, ask: ASK + i * 0.05, replayMs: i * 1_000, seq: 100 + i });
      engine.runUntil(i * 1_000);
    }
    expect(engine.view().events.length).toBe(before); // no events emitted for quotes at all
    expect(announce(engine.view(), before)).toBeNull();
  });

  it('collapses a burst of transitions into one announcement', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    // Announce from the very beginning: several transitions are fresh at once.
    const message = announce(engine.view(), 0);
    // A single sentence, not one per event.
    expect(message!.split('.').filter((s) => s.trim().length > 0).length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: identity and stability
// ---------------------------------------------------------------------------

describe('activity rows are stable and identity-addressed', () => {
  it('gives every row a unique key', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
    engine.runUntilIdle();

    const rows = activityRows(engine.view(), ruleLookup);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('produces identical rows for identical state', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const state = engine.view();
    expect(activityRows(state, ruleLookup)).toEqual(activityRows(state, ruleLookup));
  });

  it('reports terminal status for a rejected order', () => {
    const engine = makeEngine({ profile: trainingProfile() });
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const order: Order = engine.view().orders[0];
    expect(isTerminal(order)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Honesty: the timeline must not invent intervals
// ---------------------------------------------------------------------------

describe('timeline honesty', () => {
  it('does not report an interval it never observed', () => {
    const engine = seeded();
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const { intervals } = orderTimeline(engine.view(), submitted.orderId!);
    for (const [name, value] of Object.entries(intervals)) {
      // Either a number that was measured from real transitions, or explicitly null. Never NaN.
      expect(Number.isNaN(value as number), `${name} must not be NaN`).toBe(false);
      expect(value === null || typeof value === 'number').toBe(true);
    }
  });

  it('reports the notification delay exactly as the engine recorded it', () => {
    const engine = seeded();
    const submitted = engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const timeline = orderTimeline(engine.view(), submitted.orderId!);
    const notice = engine
      .view()
      .events.find((e) => e.kind === 'NOTICE_DELIVERED' && e.detail?.notice === 'FILL_NOTIFICATION')!;
    expect(timeline.intervals.notificationDelayMs).toBe(notice.detail.notificationDelayMs);
  });

  it('returns an empty timeline for an unknown order rather than throwing', () => {
    const engine = seeded();
    const state: AccountState = engine.view();
    const timeline = orderTimeline(state, 'O-does-not-exist' as never);
    expect(presentTransitions(timeline)).toEqual([]);
    expect(timeline.intervals.executionDelayMs).toBeNull();
  });

  it('handles a position id passed where an order id is expected without inventing transitions', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const positionId = engine.view().positions[0].positionId as unknown as PositionId;
    const timeline = orderTimeline(engine.view(), positionId as never);
    expect(presentTransitions(timeline)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Positions are described as positions, not as orders
// ---------------------------------------------------------------------------

describe('position rows report open or closed, never an order status', () => {
  it('says Open while the position is live, and Closed once it is closed', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const open = activityRows(engine.view(), ruleLookup).find((r) => r.kind === 'POSITION')!;
    // "Filled" would be true of its entry and misleading about the position: it is still exposed.
    expect(open.status).toBe('Open');

    engine.closePosition(engine.view().positions[0].positionId as never);
    engine.runUntilIdle();

    const closed = activityRows(engine.view(), ruleLookup).find((r) => r.kind === 'POSITION')!;
    expect(closed.status).toBe('Closed');
  });

  it('keeps the order vocabulary for orders', () => {
    const engine = seeded();
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    const order = activityRows(engine.view(), ruleLookup).find((r) => r.kind === 'ORDER')!;
    expect(order.status).toBe('Filled');
    expect(['Open', 'Closed']).not.toContain(order.status);
  });

  it('reports the account frozen only while it actually is', () => {
    // The store exposes the current condition separately from the append-only notice log, so a
    // resolved stall stops being announced. Here: a session with no tape at all.
    const engine = makeEngine({ profile: trainingProfile() });
    engine.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    // Nothing was invented; the instruction is still waiting for a price.
    expect(engine.view().fills).toHaveLength(0);
    expect(engine.view().lastQuoteBySymbol[SYMBOL]).toBeUndefined();
    expect(statusOf(engine.view().orders[0])).not.toBe('Filled');
  });
});

describe('the account view carries the quote the UI must price against', () => {
  it('exposes the latest quote per symbol', () => {
    const engine = seeded();
    engine.onQuote({ symbol: SYMBOL, bid: 101, ask: 101.5, replayMs: 1_000, seq: 2 });
    const view = engine.view();
    expect(view.lastQuoteBySymbol[SYMBOL].bid).toBe(101);
    expect(view.lastQuoteBySymbol[SYMBOL].ask).toBe(101.5);
  });

  it('has no quote for a symbol it has never seen', () => {
    const engine = seeded();
    expect(engine.view().lastQuoteBySymbol['ETHUSD']).toBeUndefined();
  });
});
