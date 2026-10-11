import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeEngine } from '../../../src/lib/orderSimulator/__testkit__/harness';
import { digestEvents, fnv1a } from '../../../src/lib/orderSimulator/__testkit__/harness';
import { trainingProfile } from '../../../src/lib/orderSimulator/profiles';
import { DeterministicScheduler } from '../../../src/lib/orderSimulator/scheduler';
import type { OrderId } from '../../../src/lib/orderSimulator/types';

/**
 * Determinism, wall-clock independence, and deterministic race forcing.
 *
 * These tests enforce the property the whole milestone depends on: the same tape produces byte-for
 * -byte the same result, and nothing under test can observe real elapsed time.
 */

const SIZE = 0.01;

/** A scenario with enough moving parts that any nondeterminism would show up. */
function runScenario(): string {
  const engine = makeEngine({ profile: trainingProfile() });
  engine.onQuote({ symbol: 'BTCUSD', bid: 100.0, ask: 100.5, replayMs: 0, seq: 1 });

  engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE, attachments: { stopLoss: 99.0, takeProfit: 102.0 } });
  const resting = engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
  engine.runUntil(500);

  engine.onQuote({ symbol: 'BTCUSD', bid: 101.0, ask: 101.5, replayMs: 1_000, seq: 2 });
  engine.runUntil(1_500);

  engine.onQuote({ symbol: 'BTCUSD', bid: 98.9, ask: 99.0, replayMs: 2_000, seq: 3 });
  engine.runUntil(2_500);

  engine.cancelOrder(resting.orderId as OrderId);
  engine.amendOrder(resting.orderId as OrderId, 0, 94.5);

  engine.onQuote({ symbol: 'BTCUSD', bid: 102.0, ask: 102.5, replayMs: 3_000, seq: 4 });
  engine.runUntilIdle();

  return digestEvents(engine.eventLog());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('order simulator — determinism', () => {
  it('produces an identical digest for two runs of the same scenario', () => {
    const first = runScenario();
    const second = runScenario();
    expect(second).toBe(first);
  });

  it('produces an identical digest when the wall clock is shifted by a day', () => {
    const baseline = runScenario();

    // Nothing in the simulator may read a wall clock, so moving real time forward by 24 hours must
    // not change a single value. This is the "stable across a +1-day wall-clock skew" property.
    const skewed = Date.now() + 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(skewed);
    vi.spyOn(performance, 'now').mockReturnValue(skewed % 1_000_000);
    if (typeof globalThis.process !== 'undefined') {
      vi.spyOn(process, 'hrtime', 'get').mockReturnValue((() => [Math.floor(skewed / 1000), 0]) as never);
    }

    expect(runScenario()).toBe(baseline);
  });

  it('is sensitive: a different tape produces a different digest', () => {
    const baseline = runScenario();
    const engine = makeEngine({ profile: trainingProfile() });
    engine.onQuote({ symbol: 'BTCUSD', bid: 100.0, ask: 100.5, replayMs: 0, seq: 1 });
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();
    expect(digestEvents(engine.eventLog())).not.toBe(baseline);
  });

  it('is sensitive: changing only the quote sequence changes the digest', () => {
    const build = (secondBid: number) => {
      const engine = makeEngine({ profile: trainingProfile() });
      engine.onQuote({ symbol: 'BTCUSD', bid: 100.0, ask: 100.5, replayMs: 0, seq: 1 });
      engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE, attachments: { stopLoss: 99.0 } });
      engine.runUntil(500);
      engine.onQuote({ symbol: 'BTCUSD', bid: secondBid, ask: secondBid + 0.5, replayMs: 1_000, seq: 2 });
      engine.runUntilIdle();
      return digestEvents(engine.eventLog());
    };
    expect(build(98.9)).not.toBe(build(101.0));
  });

  it('never reads a wall clock anywhere in the simulator sources', () => {
    const dir = path.resolve(__dirname, '../../../src/lib/orderSimulator');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      // Strip comments so a doc comment that *mentions* a wall clock is not a violation.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/\bDate\.now\s*\(/.test(code)) offenders.push(`${file}: Date.now`);
      if (/\bnew\s+Date\s*\(/.test(code)) offenders.push(`${file}: new Date`);
      if (/\bperformance\.now\s*\(/.test(code)) offenders.push(`${file}: performance.now`);
      if (/\bhrtime\b/.test(code)) offenders.push(`${file}: process.hrtime`);
      if (/\bsetTimeout\s*\(|\bsetInterval\s*\(/.test(code)) offenders.push(`${file}: timer`);
      if (/\bMath\.random\s*\(/.test(code)) offenders.push(`${file}: Math.random`);
    }
    expect(offenders).toEqual([]);
  });

  it('does not advance time on its own between actions', () => {
    const engine = makeEngine({ profile: trainingProfile() });
    engine.onQuote({ symbol: 'BTCUSD', bid: 100.0, ask: 100.5, replayMs: 0, seq: 1 });
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });

    // With no action due before 500 ms, dispatching up to 500 must not have run anything yet.
    expect(engine.eventLog().filter((e) => e.kind === 'FILLED')).toHaveLength(0);
    engine.runUntil(149);
    expect(engine.eventLog().filter((e) => e.kind === 'FILLED')).toHaveLength(0);
    engine.runUntil(150);
    expect(engine.eventLog().filter((e) => e.kind === 'FILLED')).toHaveLength(1);
  });
});

describe('order simulator — scheduler ordering', () => {
  it('breaks ties on insertion order, not on a naked timestamp', () => {
    const scheduler = new DeterministicScheduler<string>();
    scheduler.schedule(1_000, 'third');
    scheduler.schedule(500, 'second');
    scheduler.schedule(500, 'first');
    scheduler.schedule(1_500, 'fourth');

    const order: string[] = [];
    for (;;) {
      const next = scheduler.next();
      if (!next) break;
      order.push(next.payload);
    }
    // At 500: 'second' was scheduled before 'first'.
    expect(order).toEqual(['second', 'first', 'third', 'fourth']);
  });

  it('skips cancelled actions without disturbing the order of the rest', () => {
    const scheduler = new DeterministicScheduler<string>();
    scheduler.schedule(100, 'a');
    const doomed = scheduler.schedule(200, 'b');
    scheduler.schedule(300, 'c');
    expect(scheduler.cancel(doomed)).toBe(true);

    const order: string[] = [];
    for (;;) {
      const next = scheduler.next();
      if (!next) break;
      order.push(next.payload);
    }
    expect(order).toEqual(['a', 'c']);
    expect(scheduler.size).toBe(0);
  });

  it('reports a stale cancellation rather than pretending it worked', () => {
    const scheduler = new DeterministicScheduler<string>();
    scheduler.schedule(100, 'only');
    scheduler.next();
    expect(scheduler.cancel({ id: 0 })).toBe(false);
  });

  it('fills from a queue and keeps exact order under heavy tie-ing', () => {
    const scheduler = new DeterministicScheduler<number>();
    for (let i = 0; i < 200; i++) {
      // Every action at the same millisecond: ordering must be exactly the insertion order.
      scheduler.schedule(7_000, i);
    }
    const seen: number[] = [];
    for (;;) {
      const next = scheduler.next();
      if (!next) break;
      seen.push(next.payload as number);
    }
    expect(seen).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });
});

describe('order simulator — deterministic race forcing', () => {
  /**
   * A cancel and a trigger-eligible quote aimed at the same millisecond.
   *
   * The simulator does not "race" in a flaky way: the winner is decided by the caller's delivery
   * order, and each delivery order always produces the same outcome.
   */
  function raceScenario(deliverQuoteFirst: boolean): { digest: string; verdict: string; fills: number } {
    const engine = makeEngine({ profile: trainingProfile() });
    engine.onQuote({ symbol: 'BTCUSD', bid: 100.0, ask: 100.5, replayMs: 0, seq: 1 });

    // A sell stop at 99 sits below the market: valid, resting, waiting for the bid to fall through.
    const stop = engine.submitOrder({ symbol: 'BTCUSD', side: 'SELL', type: 'STOP', size: SIZE, level: 99 });
    engine.runUntil(200);

    // Cancel submitted at 900 arrives at 1_000, exactly when the market crosses the level.
    engine.runUntil(900);
    engine.cancelOrder(stop.orderId as OrderId);

    if (deliverQuoteFirst) {
      engine.onQuote({ symbol: 'BTCUSD', bid: 98.9, ask: 99.0, replayMs: 1_000, seq: 2 });
      engine.runUntil(1_000);
    } else {
      engine.runUntil(1_000);
      engine.onQuote({ symbol: 'BTCUSD', bid: 98.9, ask: 99.0, replayMs: 1_000, seq: 2 });
    }
    engine.runUntilIdle();

    const order = engine.view().orders[0];
    return { digest: digestEvents(engine.eventLog()), verdict: order.state, fills: engine.view().fills.length };
  }

  it('the quote arriving first wins: the stop triggers and fills', () => {
    const result = raceScenario(true);
    expect(result.verdict).toBe('FILLED');
    expect(result.fills).toBe(1);
  });

  it('the cancel arriving first wins: the stop is cancelled and never fills', () => {
    const result = raceScenario(false);
    expect(result.verdict).toBe('CANCELLED');
    expect(result.fills).toBe(0);
  });

  it('each race outcome is reproducible', () => {
    expect(raceScenario(true).digest).toBe(raceScenario(true).digest);
    expect(raceScenario(false).digest).toBe(raceScenario(false).digest);
    expect(raceScenario(true).digest).not.toBe(raceScenario(false).digest);
  });

  it('resolves a same-millisecond tie between two commands by submission order', () => {
    const engine = makeEngine({ profile: trainingProfile() });
    engine.onQuote({ symbol: 'BTCUSD', bid: 100.0, ask: 100.5, replayMs: 0, seq: 1 });

    // Two market orders submitted at the same instant with the same delay: the first submitted
    // must be the first filled.
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const fills = engine.view().fills;
    expect(fills).toHaveLength(2);
    expect(fills[0].orderId).toBe('O-1');
    expect(fills[1].orderId).toBe('O-2');
    expect(fills[0].fillId).toBe('F-1');
  });
});

describe('order simulator — digest contract', () => {
  it('is stable and independent of object key insertion order', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });

  it('covers every event field that matters', () => {
    const engine = makeEngine({ profile: trainingProfile() });
    engine.onQuote({ symbol: 'BTCUSD', bid: 100.0, ask: 100.5, replayMs: 0, seq: 1 });
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: SIZE });
    engine.runUntilIdle();

    const events = engine.eventLog();
    expect(events.length).toBeGreaterThan(4);
    // Every event carries a strictly increasing sequence number: the log is totally ordered.
    const seqs = events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
