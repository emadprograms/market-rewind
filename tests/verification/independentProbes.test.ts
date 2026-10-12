import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ReplaySession } from '../../src/lib/orderSimulator/replay';
import { useAccountStore } from '../../src/store/useAccountStore';
import { projectAccountTotals, projectForSymbol } from '../../src/lib/orderSimulator/accountProjection';
import { BTCUSD_RULES, trainingProfile } from '../../src/lib/orderSimulator/profiles';
import type { Quote } from '../../src/lib/orderSimulator/types';

/**
 * INDEPENDENT PROBES — expected values are derived from the documented rules, not from the code.
 *
 * These exist so an external verifier can falsify the simulator's central claims with numbers it can
 * check by hand. Every expectation below is stated in a comment with its arithmetic, and each probe
 * prints one JSON line so the observations can be pasted back verbatim.
 *
 * Read `docs/order-simulator.md` §3 for the rules being tested:
 *   - travel, acceptance, dispatch and notification delays come from the ACTIVE PROFILE
 *     (training: travel 100 ms, acceptance 0 ms, dispatch 50 ms, notification 100 ms, freshness 2000 ms);
 *   - an order fills at the execution-time side: a BUY pays the ask, a SELL receives the bid;
 *   - a limit waits for the ask (BUY) or bid (SELL) to reach its level, equality included;
 *   - a stop waits for the ask (BUY) or bid (SELL), equality included, and latches once triggered;
 *   - a position can be closed exactly once, and a close takes travel time to reach the broker.
 *
 * Do not "fix" an expectation to match the output. A mismatch is the finding.
 */

const SYMBOL = 'BTCUSD';
const SIZE = 0.01;

function q(replayMs: number, bid: number, ask: number, seq: number): Quote {
  return { symbol: SYMBOL, bid, ask, replayMs, seq };
}

/** A fresh session with its own tape. Identity is (symbol, seq), never an array index. */
function session(tape: Quote[], startMs = 0): ReplaySession {
  const s = new ReplaySession({ sessionId: 'probe', instruments: [BTCUSD_RULES], profile: trainingProfile(), startMs });
  s.replaceTape(SYMBOL, tape);
  return s;
}

/** The account store, configured for this instrument, with a tape re-registered afterwards. */
function account(tape: Quote[]): void {
  const store = useAccountStore.getState();
  store.configure({ instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'probe-store' });
  // NOTE: configure() replaces the session and drops every registered tape. Re-register after it.
  useAccountStore.getState().registerTape(SYMBOL, tape);
  useAccountStore.getState().advanceTo(0, 'PLAY');
}

function emit(label: string, values: Record<string, unknown>): void {
  // One line per probe: paste-ready, machine-diffable.
  console.log(`PROBE ${label} ${JSON.stringify(values)}`);
}

describe('P1 a market order fills at the execution-time ask, not the submitted ask', () => {
  it('matches the hand-derived price and instants', () => {
    // Tape: q0 at t=0 (100.00/100.50), q1 at t=1000 (101.00/101.50). Submit a BUY MARKET at t=0.
    //   arrival  = 0 + travel 100      = 100
    //   accepted = 100 + acceptance 0  = 100
    //   eligible = 100 + dispatch 50   = 150
    // At t=150 only q0 has been delivered, so the fill must use q0's ASK = 100.50.
    //   notification = 150 + 100 = 250
    const s = session([q(0, 100, 100.5, 1), q(1_000, 101, 101.5, 2)]);
    s.advanceTo(0, 'PLAY');
    s.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
    s.advanceTo(2_000, 'PLAY');

    const state = s.state();
    const fill = state.fills[0];
    const order = state.orders[0];
    const notice = state.events.find((e) => e.kind === 'NOTICE_DELIVERED' && e.detail?.notice === 'FILL_NOTIFICATION');

    emit('P1', {
      state: order.state,
      fillPrice: fill?.price,
      fillReplayMs: fill?.replayMs,
      quoteSeq: fill?.quoteSeq,
      submittedAsk: order.submittedQuote?.ask,
      adverseTicks: fill?.priceChangeFromSubmitTicks,
      notificationMs: notice?.detail?.notificationDelayMs,
    });

    expect(order.state).toBe('FILLED');
    expect(fill.price).toBe(100.5); // execution-time ask, NOT the 101.50 that arrives later
    expect(fill.replayMs).toBe(150); // eligible instant
    expect(fill.quoteSeq).toBe(1); // the quote that actually satisfied it
    expect(fill.priceChangeFromSubmitTicks).toBe(0);
    expect(notice?.detail?.notificationDelayMs).toBe(100);
  });
});

describe('P2 a BUY STOP triggers on the ASK and reports its slippage', () => {
  it('matches the hand-derived price, instant and tick distance', () => {
    // Tape: q0 t=0 (100.00/100.50), q1 t=1000 (102.00/102.05). BUY STOP at 101.50, submitted t=0.
    //   armed at 150. At 150 the ask is 100.50 < 101.50  -> no trigger.
    //   at 1000 the ask is 102.05 >= 101.50              -> trigger, fill at the ask 102.05.
    //   slippage past the stop = (102.05 - 101.50) / 0.05 = 11 ticks.
    const s = session([q(0, 100, 100.5, 1), q(1_000, 102, 102.05, 2)]);
    s.advanceTo(0, 'PLAY');
    s.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 101.5 });
    s.advanceTo(2_000, 'PLAY');

    const state = s.state();
    const fill = state.fills[0];
    emit('P2', {
      state: state.orders[0].state,
      triggeredAt: state.orders[0].triggeredAt,
      fillPrice: fill?.price,
      fillReplayMs: fill?.replayMs,
      stopToFillTicks: fill?.stopToFillDifferenceTicks,
      triggerEvents: state.events.filter((e) => e.kind === 'TRIGGERED').length,
    });

    expect(state.orders[0].state).toBe('FILLED');
    expect(fill.price).toBe(102.05);
    expect(fill.replayMs).toBe(1_000);
    expect(fill.stopToFillDifferenceTicks).toBe(11);
    expect(state.events.filter((e) => e.kind === 'TRIGGERED')).toHaveLength(1); // latched, fires once
  });
});

describe('P3 a BUY LIMIT triggers on the ASK, equality included', () => {
  it('fills when the ask equals the level, and never above it', () => {
    // Tape: q0 t=0 (100.00/100.50), q1 t=1000 (99.00/99.50). BUY LIMIT at 99.50, submitted t=0.
    //   at 150 the ask is 100.50 > 99.50 -> still working.
    //   at 1000 the ask is 99.50 == 99.50 -> equality satisfies it; fill at the ask 99.50.
    //   move from the submitted ask = (99.50 - 100.50) / 0.05 = -20 ticks (favourable).
    const s = session([q(0, 100, 100.5, 1), q(1_000, 99, 99.5, 2)]);
    s.advanceTo(0, 'PLAY');
    s.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 99.5 });
    s.advanceTo(2_000, 'PLAY');

    const state = s.state();
    const fill = state.fills[0];
    emit('P3', {
      state: state.orders[0].state,
      fillPrice: fill?.price,
      fillReplayMs: fill?.replayMs,
      priceChangeTicks: fill?.priceChangeFromSubmitTicks,
      fillAtOrBelowLevel: fill ? fill.price <= 99.5 : null,
    });

    expect(state.orders[0].state).toBe('FILLED');
    expect(fill.price).toBe(99.5);
    expect(fill.replayMs).toBe(1_000);
    expect(fill.priceChangeFromSubmitTicks).toBe(-20);
    expect(fill.price).toBeLessThanOrEqual(99.5); // a BUY limit never pays through its level
  });
});

describe('P4 a position closes exactly once, however many times it is asked', () => {
  it('refuses the second close and realises the PnL once', () => {
    // Entry: BUY MARKET at t=0 -> fills at 100.50 at t=150 (see P1 reasoning).
    // Close: requested at t=2000, travels 100 ms, arrives 2100, then dispatch 50 -> 2150.
    // The tape must still have a quote at/after 2150 or the close would wait.
    account([q(0, 100, 100.5, 1), q(2_000, 105, 105.5, 2), q(3_000, 106, 106.5, 3)]);

    useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(2_000, 'PLAY');

    const positionId = useAccountStore.getState().state.positions[0].positionId;
    const first = useAccountStore.getState().closePosition(positionId);
    const second = useAccountStore.getState().closePosition(positionId);
    useAccountStore.getState().advanceTo(4_000, 'PLAY');

    const state = useAccountStore.getState().state;
    const position = state.positions[0];
    const entryFillId = position.entryFillId;
    const closeFills = state.fills.filter((f) => f.fillId !== entryFillId);
    const totals = projectAccountTotals(state);

    emit('P4', {
      firstOk: first.ok,
      secondOk: second.ok,
      secondError: second.error,
      positionState: position.state,
      closeFillCount: closeFills.length,
      realizedPnl: totals.realizedPnl,
      openCount: totals.openPositionCount,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false); // a competing close is refused, not queued
    expect(String(second.error)).toMatch(/close in flight/i);
    expect(closeFills).toHaveLength(1); // one close fill, therefore one realization
    expect(position.state).toBe('CLOSED');
    expect(totals.openPositionCount).toBe(0);
  });
});

describe('P5 an instruction is not judged against a price from its own future', () => {
  it('accepts and fills a validly placed stop when a later quote was delivered early', () => {
    // The phase-48 defect: a quote delivered ahead of the scheduler advanced the engine clock, and an
    // instruction that had not yet arrived was judged against it. Here the tape is REPLACED with a
    // page whose first new quote (t=300) postdates the order's arrival (t=100), and the whole page is
    // handed over before the arrival deadline is drained. A naive implementation validates the stop
    // against ask 102.05 and refuses it as "below the market"; correct behaviour is to judge it
    // against the market it was placed into (100.50), accept it, and fill it on the quote that
    // satisfies it.
    const s = session([q(0, 100, 100.5, 1)]);
    s.advanceTo(0, 'PLAY');
    const outcome = s.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 102 });
    s.replaceTape(SYMBOL, [q(0, 100, 100.5, 1), q(300, 102, 102.05, 2)]); // a page that starts in the future
    s.advanceTo(1_000, 'PLAY');

    const state = s.state();
    const order = state.orders[0];
    const fill = state.fills[0];

    emit('P5', {
      accepted: outcome.accepted,
      state: order.state,
      rejectReason: order.rejectReason,
      fillPrice: fill?.price,
      fillReplayMs: fill?.replayMs,
    });

    expect(outcome.accepted).toBe(true);
    expect(order.state).toBe('FILLED');
    expect(order.rejectReason).toBeNull();
    expect(fill.price).toBe(102.05);
  });

  it('still refuses a stop that was genuinely on the wrong side when it was placed', () => {
    // A BUY stop BELOW the market is wrong at submission time: the client refuses it outright, so no
    // instruction is created at all. (This is the control for P5: the fix must not accept everything.)
    const s = session([q(0, 100, 100.5, 1)]);
    s.advanceTo(0, 'PLAY');
    const outcome = s.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'STOP', size: SIZE, level: 95 });
    s.advanceTo(1_000, 'PLAY');

    emit('P5b', { accepted: outcome.accepted, clientError: outcome.clientError, orders: s.state().orders.length });

    expect(outcome.accepted).toBe(false);
    expect(String(outcome.clientError)).toMatch(/above the market/i);
    expect(s.state().orders).toHaveLength(0);
  });
});

describe('P6 two views of one account cannot double-count', () => {
  /** Stand-in for a mounted chart: it observes the shared account and holds nothing itself. */
  function useChartView(symbol: string) {
    const state = useAccountStore((s) => s.state);
    const totals = useAccountStore((s) => s.totals);
    return {
      positionIds: projectForSymbol(state, symbol).positions.map((p) => p.positionId),
      realized: totals.realizedPnl,
      unrealized: totals.unrealizedPnl,
    };
  }

  it('shows one position and one total across two mounted views', () => {
    account([q(0, 100, 100.5, 1), q(1_000, 105, 105.5, 2), q(2_000, 110, 110.5, 3)]);

    const viewA = renderHook(() => useChartView(SYMBOL));
    const viewB = renderHook(() => useChartView(SYMBOL));

    act(() => {
      useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
      useAccountStore.getState().advanceTo(2_000, 'PLAY');
    });

    emit('P6', {
      aPositionIds: viewA.result.current.positionIds,
      bPositionIds: viewB.result.current.positionIds,
      aRealized: viewA.result.current.realized,
      bRealized: viewB.result.current.realized,
      aUnrealized: viewA.result.current.unrealized,
      bUnrealized: viewB.result.current.unrealized,
      accountOpenCount: projectAccountTotals(useAccountStore.getState().state).openPositionCount,
    });

    // One order, therefore one position, seen identically by both views.
    expect(viewA.result.current.positionIds).toHaveLength(1);
    expect(viewA.result.current.positionIds).toEqual(viewB.result.current.positionIds);
    expect(projectAccountTotals(useAccountStore.getState().state).openPositionCount).toBe(1);

    // Unmounting one view must not change the account (the old design deleted its contribution).
    const before = useAccountStore.getState().totals.unrealizedPnl;
    viewA.unmount();
    expect(useAccountStore.getState().totals.unrealizedPnl).toBe(before);
    expect(viewB.result.current.positionIds).toHaveLength(1);
  });
});

describe('P7 a stalled account says so instead of inventing a price', () => {
  it('freezes without a tape, discloses the reason, and unfreezes when data arrives', () => {
    const store = useAccountStore.getState();
    store.configure({ instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'probe-freeze' });
    // Deliberately no tape for the traded symbol.
    useAccountStore.getState().advanceTo(0, 'PLAY');
    useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
    useAccountStore.getState().advanceTo(5_000, 'PLAY');

    const frozenState = useAccountStore.getState();
    emit('P7a', {
      frozen: frozenState.frozen,
      frozenReason: frozenState.frozenReason,
      fills: frozenState.state.fills.length,
      nowMs: frozenState.state.nowMs,
      notices: frozenState.notices.slice(-1),
    });

    expect(frozenState.frozen).toBe(true);
    expect(frozenState.frozenReason).toBe('MISSING_TAPE');
    expect(frozenState.state.fills).toHaveLength(0); // no invented price, therefore no fill
    expect(frozenState.state.nowMs).toBe(0); // time did not advance either

    // Supply the missing data: the stall ends and the instruction completes.
    // NOTE: the playhead must stop strictly inside the tape. Advancing past the LAST quote of an
    // exposed symbol is a different condition — TAPE_EXHAUSTED — and would keep the account frozen
    // for a good reason, which is exactly what this probe is demonstrating rather than defeating.
    useAccountStore.getState().registerTape(SYMBOL, [
      q(0, 100, 100.5, 1),
      q(1_000, 101, 101.5, 2),
      q(2_000, 102, 102.5, 3),
    ]);
    useAccountStore.getState().advanceTo(1_500, 'PLAY');

    const thawed = useAccountStore.getState();
    emit('P7b', {
      frozen: thawed.frozen,
      frozenReason: thawed.frozenReason,
      fills: thawed.state.fills.length,
      fillPrice: thawed.state.fills[0]?.price,
      fillReplayMs: thawed.state.fills[0]?.replayMs,
      quoteSeq: thawed.state.fills[0]?.quoteSeq,
      nowMs: thawed.state.nowMs,
    });

    expect(thawed.frozen).toBe(false);
    expect(thawed.frozenReason).toBeNull();
    expect(thawed.state.fills).toHaveLength(1);

    // Derivation (this is P1's rule again, and worth checking by hand):
    //   the instruction arrived at t=100 and became eligible at t=150;
    //   the first new quote (t=0) was delivered at engine time 0, before it existed as a live order;
    //   the next quote (t=1000) had not been fed yet when the eligibility deadline fired at t=150.
    // So the newest quote the engine could see at the eligible instant was the t=0 quote, 150 ms old
    // and well inside the 2000 ms freshness limit: the fill is its ASK, 100.50, at replay time 150.
    expect(thawed.state.fills[0].price).toBe(100.5);
    expect(thawed.state.fills[0].replayMs).toBe(150);
    expect(thawed.state.fills[0].quoteSeq).toBe(1);
  });
});

describe('P8 the same tape produces the same account, byte for byte', () => {
  it('reports a digest that must be identical on every machine and timezone', () => {
    // Run this file twice (e.g. TZ=UTC and TZ=Asia/Tokyo) and diff the PROBE P8 line: if the engine
    // ever read a wall clock, the two digests would differ. Nothing else in the simulation may.
    function digestRun(steps: number[]): string {
      const s = session(
        Array.from({ length: 40 }, (_, i) => q(i * 500, 100 + (i % 7) * 0.05, 100.5 + (i % 7) * 0.05, i + 1)),
      );
      s.advanceTo(0, 'PLAY');
      s.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
      s.submitOrder({ symbol: SYMBOL, side: 'SELL', type: 'STOP', size: SIZE, level: 99.5 });
      s.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'LIMIT', size: SIZE, level: 95 });
      for (const step of steps) s.advanceTo(step, 'PLAY');
      return s.eventDigest();
    }

    const oneFrame = digestRun([19_500]);
    const manyFrames = digestRun(Array.from({ length: 39 }, (_, i) => (i + 1) * 500));

    emit('P8', { oneFrame, manyFrames, identical: oneFrame === manyFrames });

    // Batching is invisible to the economics: dividing a run differently changes nothing.
    expect(oneFrame).toBe(manyFrames);
  });
});
