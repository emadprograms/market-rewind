import { useCallback } from 'react';
import { useAccountStore } from '../store/useAccountStore';

/**
 * Portfolio totals, read from the one account.
 *
 * This hook used to be the double-counting mechanism: every chart pushed `{realized, unrealized}`
 * up keyed by chart id, and the totals were the sum of those entries. Two charts on one symbol meant
 * two entries for one position, and unmounting a chart silently deleted its contribution — so the
 * portfolio total changed depending on what was on screen.
 *
 * Now there is nothing to accumulate. The totals come from the account's own entities, counted once
 * each, and this hook is a subscription. `handlePnLUpdate` is kept as a no-op so existing call sites
 * keep compiling while they are migrated; it is deliberately inert, because a chart must not be able
 * to write to the portfolio.
 */

export function usePortfolio() {
  const totals = useAccountStore((s) => s.totals);

  /**
   * Deprecated and deliberately inert.
   *
   * Kept for call-site compatibility during migration. It cannot change the totals: the portfolio is
   * derived from the engine, and a chart reporting a number it computed itself is exactly the defect
   * this replaced.
   */
  const handlePnLUpdate = useCallback((_id: number, _r: number, _u: number) => {
    // Intentionally does nothing.
  }, []);

  return {
    totalRealized: totals.realizedPnl,
    totalUnrealized: totals.unrealizedPnl,
    totalPnl: totals.totalPnl,
    openPositionCount: totals.openPositionCount,
    /** Per-chart contributions no longer exist; present so callers can detect the change. */
    globalPnL: {} as Record<number, { r: number; u: number }>,
    handlePnLUpdate,
  };
}
