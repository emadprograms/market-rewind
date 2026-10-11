import type { Quote, Side } from './types';

/**
 * Trigger semantics.
 *
 * These rules are enumerated per (type, side) and are deliberately NOT shared between stop orders
 * and touch orders. That inversion is Pitfall P1 — the highest-risk defect in this milestone.
 * (Source: nautilus_trader #5079 — `is_stop_matched_with_trigger_type` is the inverse of
 * `is_touch_triggered_with_trigger_type`; reusing the touch check for stops accepts wrong-side
 * triggers and rejects valid ones.)
 *
 *   STOP  BUY  fires when ask >= level   (level sits ABOVE the market — breakout entry)
 *   STOP  SELL fires when bid <= level   (level sits BELOW the market)
 *   LIMIT BUY  fills when ask <= level   (level sits BELOW the market)
 *   LIMIT SELL fills when bid >= level   (level sits ABOVE the market)
 */

export type TriggerKind = 'STOP' | 'LIMIT';

export interface TriggerRule {
  /** The quote field the condition is evaluated against. */
  readonly field: 'bid' | 'ask';
  /** The comparison direction. */
  readonly direction: '<=' | '>=';
  /** Where the level is expected to sit relative to the market. STOP and LIMIT are inverses. */
  readonly placement: 'ABOVE_MARKET' | 'BELOW_MARKET' | 'EITHER';
  /**
   * Whether a level on the wrong side is REFUSED.
   *
   * True for stops: a buy stop below the market would fire instantly and invert its meaning, so it
   * is a mistake, not an aggressive order. False for limits: a limit on the far side of the market
   * is merely aggressive — it is a valid order that happens to be immediately marketable.
   */
  readonly enforcesPlacement: boolean;
  readonly explanation: string;
}

export const TRIGGER_MATRIX: Record<TriggerKind, Record<Side, TriggerRule>> = {
  STOP: {
    BUY: {
      field: 'ask',
      direction: '>=',
      placement: 'ABOVE_MARKET',
      enforcesPlacement: true,
      explanation: 'A buy stop sits above the market and fires when the ask reaches or exceeds the level.',
    },
    SELL: {
      field: 'bid',
      direction: '<=',
      placement: 'BELOW_MARKET',
      enforcesPlacement: true,
      explanation: 'A sell stop sits below the market and fires when the bid reaches or falls through the level.',
    },
  },
  LIMIT: {
    BUY: {
      field: 'ask',
      direction: '<=',
      placement: 'BELOW_MARKET',
      enforcesPlacement: false,
      explanation: 'A buy limit sits below the market and fills when the ask falls to or below the level.',
    },
    SELL: {
      field: 'bid',
      direction: '>=',
      placement: 'ABOVE_MARKET',
      enforcesPlacement: false,
      explanation: 'A sell limit sits above the market and fills when the bid rises to or above the level.',
    },
  },
} as const;

/**
 * Evaluate a trigger condition. Pure; the single place any trigger decision is made.
 * Returns true when the condition currently holds.
 */
export function triggerConditionMet(
  type: TriggerKind,
  side: Side,
  level: number,
  quote: Pick<Quote, 'bid' | 'ask'>,
): boolean {
  const rule = TRIGGER_MATRIX[type][side];
  const observed = rule.field === 'bid' ? quote.bid : quote.ask;
  return rule.direction === '<=' ? observed <= level : observed >= level;
}

export type PlacementVerdict = { ok: true; warning?: string } | { ok: false; reason: string };

/**
 * Validate a level against the side of the market its trigger rule expects.
 *
 * Stops on the wrong side are refused. Limits on the wrong side are accepted with a warning,
 * because they are legitimate orders that are simply already marketable.
 */
export function validatePlacement(
  type: TriggerKind,
  side: Side,
  level: number,
  quote: Pick<Quote, 'bid' | 'ask'>,
): PlacementVerdict {
  const rule = TRIGGER_MATRIX[type][side];
  if (rule.placement === 'EITHER') return { ok: true };

  const mid = (quote.bid + quote.ask) / 2;
  const isAbove = level > mid;
  const required = rule.placement === 'ABOVE_MARKET';

  if (isAbove === required) return { ok: true };

  const description =
    `A ${side} ${type} is normally placed ${required ? 'above' : 'below'} the market ` +
    `(level ${level} vs bid ${quote.bid} / ask ${quote.ask}).`;

  if (!rule.enforcesPlacement) {
    // A limit on the far side of the market is marketable: valid, and it will fill immediately.
    return {
      ok: true,
      warning: `${description} This one is already marketable and will fill immediately rather than rest.`,
    };
  }

  return {
    ok: false,
    reason: `${description} ${rule.explanation}`,
  };
}
