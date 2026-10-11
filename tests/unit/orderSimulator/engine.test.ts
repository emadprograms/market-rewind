import { describe, it, expect } from 'vitest';
import { makeEngine } from '../../../src/lib/orderSimulator/__testkit__/harness';
import { TRIGGER_MATRIX, triggerConditionMet } from '../../../src/lib/orderSimulator/triggers';
import { BTCUSD_RULES, createInstrumentRegistry, UnsupportedSymbolError } from '../../../src/lib/orderSimulator/profiles';

/**
 * Core engine behaviour: quote validity, instrument rules, tick validity, and trigger semantics.
 * Trigger semantics are the highest-risk area in this milestone (Pitfall P1).
 */

const BID = 100.0;
const ASK = 100.5;

function seedQuote(engine: ReturnType<typeof makeEngine>, bid = BID, ask = ASK, replayMs = 0): void {
  engine.onQuote({ symbol: 'BTCUSD', bid, ask, replayMs, seq: 1 });
}

// ---------------------------------------------------------------------------
// Quote validity
// ---------------------------------------------------------------------------

describe('order simulator — quote validity', () => {
  it('refuses a non-finite quote rather than propagating NaN', () => {
    const engine = makeEngine();
    expect(() => engine.onQuote({ symbol: 'BTCUSD', bid: NaN, ask: 100, replayMs: 0, seq: 1 })).toThrow(/non-finite/);
  });

  it('refuses a crossed quote and records it as missing data', () => {
    const engine = makeEngine();
    engine.onQuote({ symbol: 'BTCUSD', bid: 101, ask: 100, replayMs: 0, seq: 1 });
    const crossed = engine.eventLog().filter((e) => e.kind === 'WAITING_FOR_DATA');
    expect(crossed).toHaveLength(1);
    expect(crossed[0].detail.reason).toBe('CROSSED_QUOTE');
  });

  it('refuses an out-of-order quote instead of rewinding the tape', () => {
    const engine = makeEngine();
    engine.onQuote({ symbol: 'BTCUSD', bid: 100, ask: 101, replayMs: 5_000, seq: 1 });
    expect(() => engine.onQuote({ symbol: 'BTCUSD', bid: 100, ask: 101, replayMs: 4_000, seq: 2 })).toThrow(
      /before engine time/,
    );
  });
});

// ---------------------------------------------------------------------------
// Instrument rules are never defaulted
// ---------------------------------------------------------------------------

describe('order simulator — instrument rules are never defaulted', () => {
  it('throws for an unconfigured symbol rather than guessing a tick size', () => {
    const registry = createInstrumentRegistry([BTCUSD_RULES]);
    expect(() => registry('EURUSD')).toThrow(UnsupportedSymbolError);
    expect(registry('btcusd')).toBe(BTCUSD_RULES);
  });

  it('rejects a submission for an unknown symbol at the client', () => {
    const engine = makeEngine();
    const outcome = engine.submitOrder({ symbol: 'EURUSD', side: 'BUY', type: 'MARKET', size: 0.1 });
    expect(outcome.accepted).toBe(false);
    expect(outcome.clientError).toMatch(/Unsupported symbol/);
  });
});

// ---------------------------------------------------------------------------
// P1: stop and touch semantics are INVERTED. Both directions are pinned.
// ---------------------------------------------------------------------------

describe('order simulator — trigger matrix (Pitfall P1)', () => {
  it('a BUY STOP above the market fires on the ASK crossing up through it', () => {
    expect(triggerConditionMet('STOP', 'BUY', 101, { bid: 100.9, ask: 100.95 })).toBe(false);
    expect(triggerConditionMet('STOP', 'BUY', 101, { bid: 100.95, ask: 101.0 })).toBe(true);
  });

  it('a BUY STOP does NOT fire when only the bid has reached the level', () => {
    // A buy fills at the ask, so a bid-led cross is not sufficient. This is the "accepts wrong-side
    // triggers" half of the documented inversion bug.
    expect(triggerConditionMet('STOP', 'BUY', 101, { bid: 101.2, ask: 100.98 })).toBe(false);
  });

  it('a SELL STOP below the market fires on the BID crossing down through it', () => {
    expect(triggerConditionMet('STOP', 'SELL', 99, { bid: 99.05, ask: 99.1 })).toBe(false);
    expect(triggerConditionMet('STOP', 'SELL', 99, { bid: 99.0, ask: 99.05 })).toBe(true);
  });

  it('a SELL STOP does NOT fire when only the ask has fallen through the level', () => {
    expect(triggerConditionMet('STOP', 'SELL', 99, { bid: 99.5, ask: 98.9 })).toBe(false);
  });

  it('a BUY LIMIT below the market fills on the ASK crossing down through it', () => {
    expect(triggerConditionMet('LIMIT', 'BUY', 99, { bid: 99.05, ask: 99.1 })).toBe(false);
    expect(triggerConditionMet('LIMIT', 'BUY', 99, { bid: 98.9, ask: 99.0 })).toBe(true);
  });

  it('a SELL LIMIT above the market fills on the BID crossing up through it', () => {
    expect(triggerConditionMet('LIMIT', 'SELL', 101, { bid: 100.95, ask: 101.0 })).toBe(false);
    expect(triggerConditionMet('LIMIT', 'SELL', 101, { bid: 101.0, ask: 101.05 })).toBe(true);
  });

  it('the STOP and LIMIT rules for the same side are exact inverses', () => {
    // Reusing the touch check for a stop accepts wrong-side triggers AND rejects valid ones, so
    // both halves are asserted: the direction and the placement requirement must differ.
    for (const [type, side] of [
      ['STOP', 'BUY'],
      ['STOP', 'SELL'],
      ['LIMIT', 'BUY'],
      ['LIMIT', 'SELL'],
    ] as const) {
      const rule = TRIGGER_MATRIX[type][side];
      const inverse = TRIGGER_MATRIX[type === 'STOP' ? 'LIMIT' : 'STOP'][side];
      expect(inverse.direction, `${type} ${side} vs its inverse`).not.toBe(rule.direction);
      expect(inverse.placement, `${type} ${side} placement`).not.toBe(rule.placement);
      // Both legs of the same side quote the same field, because both fill at the same price.
      expect(inverse.field).toBe(rule.field);
    }
  });

  it('evaluates a level inside the spread against the correct leg', () => {
    // 100.2 lies between bid 100.0 and ask 100.25.
    const spread = { bid: 100.0, ask: 100.25 };
    expect(triggerConditionMet('STOP', 'BUY', 100.2, spread)).toBe(true); // ask 100.25 >= 100.2
    expect(triggerConditionMet('STOP', 'SELL', 100.2, spread)).toBe(true); // bid 100.0 <= 100.2
    // A buy limit at 100.2 needs ask <= 100.2, and the ask is 100.25: not yet.
    expect(triggerConditionMet('LIMIT', 'BUY', 100.2, spread)).toBe(false);
  });

  it('treats a level exactly at the touch as satisfied', () => {
    expect(triggerConditionMet('LIMIT', 'BUY', 100, { bid: 99.9, ask: 100.0 })).toBe(true);
    expect(triggerConditionMet('STOP', 'BUY', 100, { bid: 99.9, ask: 100.0 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wrong-side stops must be refused, at both the client and the broker
// ---------------------------------------------------------------------------

describe('order simulator — wrong-side stops are refused', () => {
  it('accepts a submission made before any quote exists, deferring validation to the broker', () => {
    const engine = makeEngine();
    const outcome = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'STOP', size: 0.01, level: 90 });
    // Nothing to validate against yet, so the client accepts it. The broker will reject it.
    expect(outcome.clientError).toBeNull();
    engine.onQuote({ symbol: 'BTCUSD', bid: 100.0, ask: 100.5, replayMs: 100, seq: 1 });
    engine.runUntilIdle();
    const order = engine.view().orders[0];
    expect(order.state).toBe('REJECTED');
    expect(order.rejectReason).toBe('INVALID_PLACEMENT');
  });

  it('rejects a wrong-side BUY STOP once a quote is known', () => {
    const engine = makeEngine();
    seedQuote(engine);
    const wrongSide = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'STOP', size: 0.01, level: 95 });
    expect(wrongSide.accepted).toBe(false);
    expect(wrongSide.clientError).toMatch(/is normally placed above the market/);
  });

  it('rejects a wrong-side SELL STOP (below-market requirement)', () => {
    const engine = makeEngine();
    seedQuote(engine);
    const wrongSide = engine.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'STOP', size: 0.01, level: 105 });
    expect(wrongSide.accepted).toBe(false);
    expect(wrongSide.clientError).toMatch(/is normally placed below the market/);
  });

  it('accepts correctly placed stops on both sides', () => {
    const engine = makeEngine();
    seedQuote(engine);
    expect(engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'STOP', size: 0.01, level: 105 }).accepted).toBe(true);
    expect(engine.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'STOP', size: 0.01, level: 95 }).accepted).toBe(true);
  });

  it('ACCEPTS a marketable SELL LIMIT (below the market) rather than refusing it', () => {
    // A limit on the far side of the market is aggressive, not wrong: it is valid and fills at once.
    // Only STOPS are refused, because a wrong-side stop inverts its meaning.
    const engine = makeEngine();
    seedQuote(engine);
    const order = engine.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'LIMIT', size: 0.01, level: 99 });
    expect(order.accepted).toBe(true);
    engine.runUntilIdle();
    expect(engine.view().fills).toHaveLength(1);
  });

  it('ACCEPTS a marketable BUY LIMIT (above the market) rather than refusing it', () => {
    const engine = makeEngine();
    seedQuote(engine);
    const order = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'LIMIT', size: 0.01, level: 102 });
    expect(order.accepted).toBe(true);
    engine.runUntilIdle();
    const fills = engine.view().fills;
    expect(fills).toHaveLength(1);
    // Fills at the ask, never at the (unreachable) limit level.
    expect(fills[0].price).toBe(ASK);
  });

  it('still refuses a wrong-side STOP, which would invert its meaning', () => {
    const engine = makeEngine();
    seedQuote(engine);
    expect(
      engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'STOP', size: 0.01, level: 99 }).clientError,
    ).toMatch(/is normally placed above the market/);
    expect(
      engine.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'STOP', size: 0.01, level: 102 }).clientError,
    ).toMatch(/is normally placed below the market/);
  });
});

// ---------------------------------------------------------------------------
// P7: trigger conditions latch
// ---------------------------------------------------------------------------

describe('order simulator — a trigger condition latches (Pitfall P7)', () => {
  it('emits exactly one TRIGGERED event even when many quotes satisfy the condition', () => {
    const engine = makeEngine();
    seedQuote(engine, 100.0, 100.5, 0);

    // A sell limit at 101 is above the market: valid, and not yet satisfied.
    const submitted = engine.submitOrder({
      symbol: 'BTCUSD',
      side: 'SELL',
      type: 'LIMIT',
      size: 0.01,
      level: 101,
    });
    expect(submitted.accepted).toBe(true);
    expect(submitted.orderId).not.toBeNull();

    // Five consecutive quotes at or above the level.
    for (let i = 1; i <= 5; i++) {
      engine.onQuote({ symbol: 'BTCUSD', bid: 101.0 + i * 0.05, ask: 101.1 + i * 0.05, replayMs: i * 1000, seq: 100 + i });
      engine.runUntil(i * 1000);
    }
    engine.runUntilIdle();

    const triggered = engine.eventLog().filter((e) => e.kind === 'TRIGGERED');
    expect(triggered).toHaveLength(1);

    const fills = engine.view().fills;
    expect(fills).toHaveLength(1);
    expect(engine.openPositions()).toHaveLength(1);
  });

  it('does not fire an order whose condition was never met', () => {
    const engine = makeEngine();
    seedQuote(engine, 100.0, 100.5, 0);
    engine.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'LIMIT', size: 0.01, level: 200 });
    for (let i = 1; i <= 4; i++) {
      engine.onQuote({ symbol: 'BTCUSD', bid: 100.0, ask: 100.5, replayMs: i * 1000, seq: 100 + i });
      engine.runUntil(i * 1000);
    }
    engine.runUntilIdle();
    expect(engine.view().fills).toHaveLength(0);
    expect(engine.view().orders[0].state).not.toBe('FILLED');
  });
});

// ---------------------------------------------------------------------------
// Tick validity
// ---------------------------------------------------------------------------

describe('order simulator — price arithmetic', () => {
  it('rejects a level that is not an exact multiple of the tick', () => {
    const engine = makeEngine();
    seedQuote(engine);
    const bad = engine.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'LIMIT', size: 0.01, level: 100.3333 });
    expect(bad.accepted).toBe(false);
    expect(bad.clientError).toMatch(/not an exact multiple of tick size/);
  });

  it('accepts a level exactly on the tick', () => {
    const engine = makeEngine();
    seedQuote(engine);
    const ok = engine.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'LIMIT', size: 0.01, level: 100.55 });
    expect(ok.accepted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Size validity
// ---------------------------------------------------------------------------

describe('order simulator — size validation', () => {
  it('rejects a size below the instrument minimum', () => {
    const engine = makeEngine();
    const bad = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: 0.00001 });
    expect(bad.accepted).toBe(false);
    expect(bad.clientError).toMatch(/below the minimum size/);
  });

  it('rejects a size that is not a multiple of the size increment', () => {
    const engine = makeEngine();
    const bad = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: 0.00015 });
    expect(bad.accepted).toBe(false);
    expect(bad.clientError).toMatch(/not a multiple of the size increment/);
  });

  it('rejects a non-positive size', () => {
    const engine = makeEngine();
    expect(engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: 0 }).clientError).toMatch(
      /positive number/,
    );
  });
});
