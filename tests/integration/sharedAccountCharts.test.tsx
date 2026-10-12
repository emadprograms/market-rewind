import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAccountStore, selectTotalPnl } from '../../src/store/useAccountStore';
import { useOrderSimulator } from '../../src/hooks/useOrderSimulator';
import { projectForSymbol, projectMarkers } from '../../src/lib/orderSimulator/accountProjection';
import { BTCUSD_RULES, trainingProfile } from '../../src/lib/orderSimulator/profiles';
import type { Quote } from '../../src/lib/orderSimulator/types';

/**
 * SIM-ACCOUNT-01 / -02 / -05 at integration level: several charts, one account.
 *
 * The defect this suite exists to prevent: the previous design had each chart hold its own trade and
 * push its own PnL up by chart id, so two charts on one symbol produced two positions and a doubled
 * portfolio total, and a chart remount silently zeroed that chart's contribution.
 *
 * Here, several independent "charts" are mounted against one account store. Only the account changes
 * economics, and every chart sees the same numbers.
 */

const SYMBOL = 'BTCUSD';
const SIZE = 0.01;

function tape(count = 60, startMs = 0): Quote[] {
  return Array.from({ length: count }, (_, i) => {
    const bid = Math.round((100 + i * 0.1) * 100) / 100;
    return { symbol: SYMBOL, bid, ask: Math.round((bid + 0.5) * 100) / 100, replayMs: startMs + i * 1_000, seq: i + 1 };
  });
}

/** Stand-in for a mounted chart: it observes the account and can issue commands. */
function useChartSimulation(symbol: string) {
  const state = useAccountStore((s) => s.state);
  const totals = useAccountStore((s) => s.totals);
  return {
    symbol,
    projection: projectForSymbol(state, symbol),
    markers: projectMarkers(state, symbol),
    realized: totals.realizedPnl,
    unrealized: totals.unrealizedPnl,
  };
}

beforeEach(() => {
  const store = useAccountStore.getState();
  store.configure({ instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'shared-charts' });
  useAccountStore.getState().registerTape(SYMBOL, tape());
});

// ---------------------------------------------------------------------------
// Two charts, one account
// ---------------------------------------------------------------------------

describe('two charts showing the same symbol share one account', () => {
  it('shows one position and one total across both charts', () => {
    const chartA = renderHook(() => useChartSimulation(SYMBOL));
    const chartB = renderHook(() => useChartSimulation(SYMBOL));

    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });

    // Both charts see the same single position.
    expect(chartA.result.current.projection.positions).toHaveLength(1);
    expect(chartB.result.current.projection.positions).toHaveLength(1);
    expect(chartA.result.current.projection.positions[0].positionId).toBe(
      chartB.result.current.projection.positions[0].positionId,
    );

    // And the same PnL — not one contribution each.
    expect(chartA.result.current.realized).toBe(chartB.result.current.realized);
    expect(chartA.result.current.realized).toBe(selectTotalPnl(useAccountStore.getState()) - chartA.result.current.unrealized);
  });

  it('does not double the portfolio total when a second chart mounts', () => {
    const chartA = renderHook(() => useChartSimulation(SYMBOL));
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });
    const withOneChart = useAccountStore.getState().totals.totalPnl;

    const chartB = renderHook(() => useChartSimulation(SYMBOL));
    const withTwoCharts = useAccountStore.getState().totals.totalPnl;

    // Mounting a chart is a view change: the account is identical.
    expect(withTwoCharts).toBe(withOneChart);
    expect(chartB.result.current.unrealized).toBe(chartA.result.current.unrealized);
    expect(useAccountStore.getState().state.positions).toHaveLength(1);
  });

  it('unmounting a chart does not zero its contribution', () => {
    const chartA = renderHook(() => useChartSimulation(SYMBOL));
    const chartB = renderHook(() => useChartSimulation(SYMBOL));

    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });
    const before = useAccountStore.getState().totals;

    // Chart B goes away. Under the old per-chart design this is exactly what zeroed a contribution.
    chartB.unmount();

    expect(useAccountStore.getState().totals).toEqual(before);
    expect(chartA.result.current.projection.positions).toHaveLength(1);
  });

  it('remounting a chart twice over (Strict Mode) changes nothing', () => {
    const first = renderHook(() => useChartSimulation(SYMBOL));
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });
    const baseline = useAccountStore.getState().totals;
    const baselineMarkers = projectMarkers(useAccountStore.getState().state, SYMBOL);

    first.unmount();
    renderHook(() => useChartSimulation(SYMBOL));
    first.unmount();
    renderHook(() => useChartSimulation(SYMBOL));

    expect(useAccountStore.getState().totals).toEqual(baseline);
    expect(projectMarkers(useAccountStore.getState().state, SYMBOL)).toEqual(baselineMarkers);
    expect(useAccountStore.getState().state.positions).toHaveLength(1);
  });

  it('closing from one chart closes the position for the other', () => {
    const chartA = renderHook(() => useChartSimulation(SYMBOL));
    const chartB = renderHook(() => useChartSimulation(SYMBOL));

    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });

    const positionId = chartA.result.current.projection.positions[0].positionId;
    act(() => {
      useAccountStore.getState().closePosition(positionId);
      useAccountStore.getState().advanceTo(25_000, 'PLAY');
    });

    expect(chartA.result.current.projection.openPositions).toHaveLength(0);
    expect(chartB.result.current.projection.openPositions).toHaveLength(0);
    // Realized once, not once per chart.
    expect(chartA.result.current.realized).toBe(chartB.result.current.realized);
    expect(useAccountStore.getState().state.fills.filter((f) => f.side === 'SELL')).toHaveLength(1);
  });

  it('a chart switched to another symbol changes only what it draws', () => {
    const chart = renderHook(({ symbol }: { symbol: string }) => useChartSimulation(symbol), {
      initialProps: { symbol: SYMBOL },
    });

    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
      useAccountStore.getState().advanceTo(15_000, 'PLAY');
    });
    const positionBefore = { ...chart.result.current.projection.positions[0] };

    chart.rerender({ symbol: 'ETHUSD' });
    expect(chart.result.current.projection.positions).toHaveLength(0);

    chart.rerender({ symbol: SYMBOL });
    const positionAfter = chart.result.current.projection.positions[0];

    // The position is untouched: same id, symbol and execution price.
    expect(positionAfter.positionId).toBe(positionBefore.positionId);
    expect(positionAfter.symbol).toBe(positionBefore.symbol);
    expect(positionAfter.entryPrice).toBe(positionBefore.entryPrice);
    expect(useAccountStore.getState().state.positions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Two charts, two symbols, one portfolio
// ---------------------------------------------------------------------------

describe('charts on different symbols still share one portfolio', () => {
  it('reports one total across symbols', () => {
    const ETH_RULES = { ...BTCUSD_RULES, symbol: 'ETHUSD' };
    act(() => {
      // `configure` starts a new session, so BOTH tapes must be supplied to it. Registering only
      // the new symbol would leave BTCUSD without data, and its order would be refused for having
      // no quote rather than because of anything this test is about.
      useAccountStore.getState().configure({ instruments: [BTCUSD_RULES, ETH_RULES] });
      useAccountStore.getState().registerTape(SYMBOL, tape());
      useAccountStore
        .getState()
        .registerTape('ETHUSD', tape().map((q) => ({ ...q, symbol: 'ETHUSD', bid: q.bid / 20, ask: q.ask / 20 })));
    });

    const btcChart = renderHook(() => useChartSimulation(SYMBOL));
    const ethChart = renderHook(() => useChartSimulation('ETHUSD'));

    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
      useAccountStore.getState().openPosition({ symbol: SYMBOL, side: 'BUY', size: SIZE });
      useAccountStore.getState().openPosition({ symbol: 'ETHUSD', side: 'BUY', size: SIZE });
      useAccountStore.getState().advanceTo(20_000, 'PLAY');
    });

    expect(btcChart.result.current.projection.positions).toHaveLength(1);
    expect(ethChart.result.current.projection.positions).toHaveLength(1);
    expect(useAccountStore.getState().state.positions).toHaveLength(2);

    // Each chart reports the ACCOUNT total, not a per-chart share of it.
    const accountTotal = useAccountStore.getState().totals.totalPnl;
    expect(btcChart.result.current.unrealized).toBe(useAccountStore.getState().totals.unrealizedPnl);
    expect(ethChart.result.current.unrealized).toBe(useAccountStore.getState().totals.unrealizedPnl);
    expect(accountTotal).toBe(
      Math.round((useAccountStore.getState().totals.realizedPnl + useAccountStore.getState().totals.unrealizedPnl) * 1e6) / 1e6,
    );
  });
});

// ---------------------------------------------------------------------------
// The per-chart hook is a view over the shared account
// ---------------------------------------------------------------------------

describe('useOrderSimulator remains a view, not a second account', () => {
  it('a standalone session does not touch the shared account', () => {
    const { result } = renderHook(() =>
      useOrderSimulator({ symbols: [SYMBOL], instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'standalone' }),
    );

    act(() => {
      result.current.session.replaceTape(SYMBOL, tape());
      result.current.session.advanceTo(5_000, 'PLAY');
      result.current.session.submitOrder({ symbol: SYMBOL, side: 'BUY', type: 'MARKET', size: SIZE });
      result.current.session.advanceTo(15_000, 'PLAY');
      result.current.refresh();
    });

    // The standalone session did its own thing...
    expect(result.current.state.positions).toHaveLength(1);
    // ...and the shared account is untouched, because nothing dispatched a command to it.
    expect(useAccountStore.getState().state.positions).toHaveLength(0);
    expect(useAccountStore.getState().state.fills).toHaveLength(0);
  });
});
