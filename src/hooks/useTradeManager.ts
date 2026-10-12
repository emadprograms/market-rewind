import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
import type { ActiveTrade, ChartBar, MarketTick, TradeType } from '../types';
import type { TradePlugin } from '../lib/TradePlugin';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { useAccountStore } from '../store/useAccountStore';
import { quotesFromTicks } from '../lib/orderSimulator/playbackBridge';
import { BTCUSD_RULES, createInstrumentRegistry } from '../lib/orderSimulator/profiles';
import type { InstrumentRules } from '../lib/orderSimulator/types';

/**
 * Backwards-compatible trade view over the shared account.
 *
 * This hook used to OWN the trade: it held an `ActiveTrade` in component state, averaged entries
 * when a second order arrived, flipped on a larger opposite order, and reported its own PnL up to
 * the parent by chart id. That design is what SIM-ACCOUNT-01..03 forbid — two charts on one symbol
 * produced two trades and a doubled portfolio total, and a remount silently zeroed a contribution.
 *
 * It is now a thin VIEW. It reads positions from the one account and issues commands to it; it keeps
 * no economic state of its own. Everything it reports is a projection, so mounting, unmounting or
 * duplicating a chart cannot change a single number.
 */

/** The most recent open position on a symbol, or undefined. Indexing, not `.at(-1)`: the project's
 * TypeScript lib target predates Array.prototype.at. */
export function mostRecentOpenPosition<T extends { symbol: string; state: string; openSize: number }>(
  positions: readonly T[],
  symbol: string,
): T | undefined {
  const wanted = symbol.toUpperCase();
  const matching = positions.filter((p) => p.symbol.toUpperCase() === wanted && p.state === 'OPEN' && p.openSize > 0);
  return matching[matching.length - 1];
}

export function getAskPrice(tick: MarketTick | null | undefined, fallbackPrice: number): number {
  if (tick && tick.ask != null && Number(tick.ask) > 0) {
    return Number(tick.ask);
  }
  if (tick && tick.price != null && Number(tick.price) > 0) {
    return Number((Number(tick.price) + 0.01).toFixed(2));
  }
  return fallbackPrice;
}

export function getBidPrice(tick: MarketTick | null | undefined, fallbackPrice: number): number {
  if (tick && tick.bid != null && Number(tick.bid) > 0) {
    return Number(tick.bid);
  }
  if (tick && tick.price != null && Number(tick.price) > 0) {
    return Number((Number(tick.price) - 0.01).toFixed(2));
  }
  return fallbackPrice;
}

interface UseTradeManagerParams {
  chartData: ChartBar[];
  chartContainerRef?: React.RefObject<HTMLDivElement | null>;
  priceSeriesRef?: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  tradePluginRef?: React.MutableRefObject<TradePlugin | null>;
  ticker?: string;
  /** Kept for call-site compatibility. The account owns PnL now, so this is only a notification. */
  onAccountChange?: () => void;
}

export function useTradeManager({
  chartData,
  ticker,
  onAccountChange,
}: UseTradeManagerParams) {
  const symbol = (ticker ?? BTCUSD_RULES.symbol).toUpperCase();

  const [tradeSize, setTradeSize] = useState(1);
  const [dragTarget, setDragTarget] = useState<'sl' | 'tp' | null>(null);
  const tradeBadgeRef = useRef<HTMLDivElement>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // -- reads from the one account ------------------------------------------
  const accountState = useAccountStore((s) => s.state);
  const totals = useAccountStore((s) => s.totals);
  const instruments = useAccountStore((s) => s.session);

  // -- keep the account's tape for this symbol aligned with the playhead ----
  const bufferedTicks = usePlaybackStore((s) => s.bufferedTicks);
  const ticksBySymbol = usePlaybackStore((s) => s.ticksBySymbol);

  const rulesFor = useMemo(() => {
    try {
      return createInstrumentRegistry([BTCUSD_RULES]);
    } catch {
      return null;
    }
  }, []);

  /**
   * Whether the simulated account has rules for this chart's instrument.
   *
   * These controls used to render as if every chart were tradeable. Clicking BUY on an instrument with
   * no rules produced no order, no position and no message: `placeOrder` set `lastError`, and nothing
   * rendered it. The buttons now report the situation instead of accepting a click they cannot honour.
   */
  const isTradeable = useMemo(() => {
    if (!rulesFor) return false;
    try {
      rulesFor(symbol);
      return true;
    } catch {
      return false;
    }
  }, [rulesFor, symbol]);

  useEffect(() => {
    if (!rulesFor) return;
    let rules: InstrumentRules;
    try {
      rules = rulesFor(symbol);
    } catch {
      return; // an unconfigured symbol is never given invented rules
    }
    const ticks =
      ticksBySymbol[symbol] ?? (bufferedTicks.some((t) => t.symbol?.toUpperCase() === symbol) ? bufferedTicks : []);
    if (ticks.length === 0) return;
    useAccountStore.getState().registerTape(symbol, quotesFromTicks(ticks, symbol, rules));
  }, [bufferedTicks, ticksBySymbol, symbol, rulesFor]);

  // -- the current tick, for display only ----------------------------------
  const currentTick = usePlaybackStore((state) => state.latestTickBySymbol?.[symbol] ?? state.currentTick);

  const fallbackPrice = chartData && chartData.length > 0 ? chartData[chartData.length - 1].close : 0;
  const askPrice = getAskPrice(currentTick, fallbackPrice);
  const bidPrice = getBidPrice(currentTick, fallbackPrice);

  /**
   * The most recent open position on this symbol, in the legacy shape.
   *
   * Read-only: this exists so the badge and controls keep rendering. It is NOT the source of truth,
   * and an opposite order opens another position rather than modifying this one.
   */
  const activeTrade: ActiveTrade | null = useMemo(() => {
    const open = accountState.positions.filter(
      (p) => p.symbol.toUpperCase() === symbol && p.state === 'OPEN' && p.openSize > 0,
    );
    const position = open[open.length - 1];
    if (!position) return null;
    const stop = accountState.orders.find((o) => o.orderId === position.slOrderId);
    const take = accountState.orders.find((o) => o.orderId === position.tpOrderId);
    return {
      type: (position.direction === 'LONG' ? 'long' : 'short') as TradeType,
      entryPrice: position.entryPrice,
      slPrice: stop?.level ?? 0,
      tpPrice: take?.level ?? 0,
      size: position.openSize,
      entryTime: String(position.entryReplayMs),
    };
  }, [accountState, symbol]);

  /** Every open position on this symbol, for callers that need more than the latest. */
  const openPositions = useMemo(
    () => accountState.positions.filter((p) => p.symbol.toUpperCase() === symbol && p.state === 'OPEN' && p.openSize > 0),
    [accountState, symbol],
  );

  const realizedPnL = totals.realizedPnl;
  const unrealizedPnL = totals.unrealizedPnl;

  // -- commands -------------------------------------------------------------
  const placeOrder = useCallback(
    (type: TradeType) => {
      const side = type === 'long' ? 'BUY' : 'SELL';
      const result = useAccountStore.getState().openPosition({
        symbol,
        side,
        type: 'MARKET',
        size: tradeSize,
        // Attachments are OFF by default (SIM-ACCOUNT-03): a plain entry is unprotected.
      });
      setLastError(result.error);
      if (result.ok) onAccountChange?.();
      return result;
    },
    [symbol, tradeSize, onAccountChange],
  );

  const closePosition = useCallback(
    (positionId?: string) => {
      // Read the LIVE store rather than the render closure: two commands issued in the same tick
      // would otherwise both act on the state as it was rendered, and the second would address an
      // id that has already changed.
      const live = useAccountStore.getState().state.positions.filter(
        (p) => p.symbol.toUpperCase() === symbol && p.state === 'OPEN' && p.openSize > 0,
      );
      const target = positionId ?? live[live.length - 1]?.positionId;
      if (!target) {
        setLastError('There is no open position to close.');
        return { ok: false, error: 'There is no open position to close.' };
      }
      // Closes target a POSITION id — the pilot's failed cleanup is the reason this is not an order id.
      const result = useAccountStore.getState().closePosition(target as never);
      setLastError(result.error);
      if (result.ok) onAccountChange?.();
      return result;
    },
    [symbol, onAccountChange],
  );

  /** Drag-to-amend: route a moved stop or target through an engine amendment. */
  const amendProtection = useCallback(
    (kind: 'sl' | 'tp', level: number) => {
      // BUGFIX: this read the order from the render closure, so a stop attached earlier in the SAME
      // tick was still invisible and the amendment was refused with "no stop-loss". Commands now
      // read the store at the moment they run.
      const live = useAccountStore.getState().state;
      const livePositions = live.positions.filter(
        (p) => p.symbol.toUpperCase() === symbol && p.state === 'OPEN' && p.openSize > 0,
      );
      const position = livePositions[livePositions.length - 1];
      if (!position) return { ok: false, error: 'No open position to amend.' };
      const order = live.orders.find(
        (o) => o.orderId === (kind === 'sl' ? position.slOrderId : position.tpOrderId),
      );
      if (!order) return { ok: false, error: `This position has no ${kind === 'sl' ? 'stop-loss' : 'take-profit'}.` };
      const result = useAccountStore.getState().amendOrder(order.orderId, order.version, level);
      setLastError(result.error);
      if (result.ok) onAccountChange?.();
      return result;
    },
    [symbol, onAccountChange],
  );

  return {
    // legacy view surface
    symbol,
    activeTrade,
    realizedPnL,
    unrealizedPnL,
    tradeSize,
    setTradeSize,
    dragTarget,
    setDragTarget,
    tradeBadgeRef,
    placeOrder,
    // new, identity-addressed surface
    openPositions,
    closePosition,
    amendProtection,
    askPrice,
    bidPrice,
    lastError,
    /** False when the simulated account has no rules for this chart's instrument. */
    isTradeable,
    /** Kept so existing call sites compile; the badge no longer owns a PnL. */
    instrumentSession: instruments,
  };
}
