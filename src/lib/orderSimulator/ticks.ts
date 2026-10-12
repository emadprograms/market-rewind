import type { InstrumentRules, Side, OrderType } from './types';

/**
 * Exact price arithmetic.
 *
 * Floating point is not used to decide whether a price sits on a tick, whether a level was
 * touched, or whether two prices are equal. Every price crossing this boundary is converted to an
 * integer number of ticks, compared there, and converted back only for display.
 *
 * See `.planning/research/ARCHITECTURE.md` (scaled-integer tick arithmetic).
 */

export interface TickRules {
  tickSize: number;
  priceDecimals: number;
}

export function rulesToTickRules(rules: InstrumentRules): TickRules {
  return { tickSize: rules.tickSize, priceDecimals: rules.priceDecimals };
}

/** Integer price units, where 1 unit = tickSize. */
export type Ticks = number;

export class TickArithmeticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TickArithmeticError';
  }
}

export function priceToTicks(price: number, rules: TickRules): Ticks {
  if (!Number.isFinite(price)) throw new TickArithmeticError(`Cannot convert non-finite price ${price}`);
  // Round the tick ratio to the nearest integer, then verify: this rejects prices that are close to
  // a tick boundary but not on it, rather than silently snapping them.
  const ticks = Math.round(price / rules.tickSize);
  if (Math.abs(ticks * rules.tickSize - price) > rules.tickSize * 1e-6) {
    throw new TickArithmeticError(
      `Price ${price} is not an exact multiple of tick size ${rules.tickSize} (nearest tick would be ${ticks * rules.tickSize}).`,
    );
  }
  return ticks;
}

export function ticksToPrice(ticks: Ticks, rules: TickRules): number {
  return roundToDecimals(ticks * rules.tickSize, rules.priceDecimals);
}

export function isOnTick(price: number, rules: TickRules): boolean {
  try {
    priceToTicks(price, rules);
    return true;
  } catch {
    return false;
  }
}

export function roundToDecimals(value: number, decimals: number): number {
  // Deliberately string-free and symmetric: used only for display/serialisation boundaries.
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function snapToTick(price: number, rules: TickRules, mode: 'nearest' | 'down' | 'up' = 'nearest'): number {
  const raw = price / rules.tickSize;
  const ticks = mode === 'down' ? Math.floor(raw + 1e-9) : mode === 'up' ? Math.ceil(raw - 1e-9) : Math.round(raw);
  return ticksToPrice(ticks, rules);
}

/** A limit price and a side determine the comparison across the touch boundary. */
export function levelOf(orderType: OrderType, side: Side, price: number): number {
  return orderType === 'LIMIT' ? price : price;
}

export function isBuy(side: Side): boolean {
  return side === 'BUY';
}

export function opposite(side: Side): Side {
  return side === 'BUY' ? 'SELL' : 'BUY';
}
