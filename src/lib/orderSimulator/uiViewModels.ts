import type {
  AccountState,
  EngineEvent,
  InstrumentRules,
  Labelled,
  LatencyProfile,
  Order,
  OrderId,
  OrderState,
  Provenance,
  Quote,
  ReplayMs,
  Side,
} from './types';
import { TRIGGER_MATRIX, type TriggerKind } from './triggers';
import { isOnTick } from './ticks';

/**
 * View models for the terminal UI.
 *
 * Everything the UI needs to say is computed here, as a pure function of account state, so the copy
 * and the arithmetic that backs it are testable without rendering anything. The components are then
 * thin: they lay these values out and nothing more.
 *
 * Two rules this module exists to enforce:
 *  - A position is never displayed merely because submit was clicked. Rows are derived from the
 *    engine's own orders and positions, so an order that has not filled has no position to show.
 *  - A fill is never hidden because a cancel button was pressed. A cancelled instruction and a
 *    filled one are different facts about the same id, and both are reported.
 */

// ---------------------------------------------------------------------------
// Status vocabulary (SIM-UI-02)
// ---------------------------------------------------------------------------

export type ActivityStatus =
  | 'Sending'
  | 'Working'
  | 'Executing'
  | 'Triggered'
  | 'Filled'
  | 'Cancelled'
  | 'Rejected'
  // Positions use their own two words. Borrowing an order's status for a position row would say
  // "Filled" about something that is still open, and "Cancelled" about a position that was closed.
  | 'Open'
  | 'Closed';

/**
 * The status a row shows.
 *
 * `Executing` is the state of a resting instruction that has passed its dispatch delay and is being
 * evaluated against every quote — live, but not yet triggered. It is deliberately distinct from
 * `Working` (accepted, still inside its dispatch delay) and from `Triggered` (the condition has been
 * met and latched).
 */
export function statusOf(order: Order): ActivityStatus {
  switch (order.state) {
    case 'SUBMITTED':
      return 'Sending';
    case 'ACCEPTED':
      return 'Working';
    case 'WORKING':
      return order.armedAt === null ? 'Working' : 'Executing';
    case 'TRIGGERED':
      return 'Triggered';
    case 'FILLED':
      return 'Filled';
    case 'CANCELLED':
      return 'Cancelled';
    case 'REJECTED':
      return 'Rejected';
    default:
      return 'Sending';
  }
}

/** Terminal statuses, so the UI can style settled rows differently. */
export function isTerminal(order: Order): boolean {
  return ['FILLED', 'CANCELLED', 'REJECTED'].includes(orderStateName(order.state));
}

function orderStateName(state: OrderState): string {
  return state;
}

// ---------------------------------------------------------------------------
// Pending condition copy (SIM-UI-02)
// ---------------------------------------------------------------------------

/** Instrument rules, or null. A symbol with no configured rules is never given invented ones. */
function safeRules(rulesFor: (symbol: string) => InstrumentRules | null, symbol: string): InstrumentRules | null {
  try {
    return rulesFor(symbol);
  } catch {
    return null;
  }
}

function priceText(value: number, rules: InstrumentRules | null): string {
  const decimals = rules?.priceDecimals ?? 2;
  return value.toFixed(decimals);
}

/**
 * The exact price side and condition a pending instruction is waiting on.
 *
 * Phrased as the comparison the engine will actually perform, taken from the same trigger matrix the
 * engine uses, so the sentence on screen cannot drift away from the rule being evaluated.
 */
export function pendingConditionText(
  order: Order,
  rules: InstrumentRules | null = null,
  quote: Quote | null = null,
): string {
  if (order.state === 'FILLED' || order.state === 'CANCELLED' || order.state === 'REJECTED') {
    return '';
  }

  if (order.type === 'MARKET') {
    if (order.state === 'SUBMITTED') return 'On its way to the simulated broker.';
    return `Executes at the ${order.side === 'BUY' ? 'ask' : 'bid'} as soon as it is accepted.`;
  }

  if (order.level === null) return 'Waiting for a level.';

  const rule = TRIGGER_MATRIX[order.type as TriggerKind][order.side];
  const level = priceText(order.level, rules);
  const observed = quote ? priceText(rule.field === 'bid' ? quote.bid : quote.ask, rules) : null;

  if (order.triggeredAt !== null) {
    return `Condition met: ${rule.field} reached ${level}. Waiting for execution at the ${order.side === 'BUY' ? 'ask' : 'bid'}.`;
  }

  const head = `Waiting for ${rule.field} ${rule.direction} ${level}`;
  return observed === null ? `${head}.` : `${head} (now ${observed}).`;
}

// ---------------------------------------------------------------------------
// Activity rows (SIM-UI-02, SIM-UI-03)
// ---------------------------------------------------------------------------

export interface ActivityRow {
  readonly key: string;
  readonly id: string;
  readonly kind: 'ORDER' | 'POSITION';
  readonly symbol: string;
  readonly side: Side;
  readonly type: string;
  readonly size: number;
  readonly level: number | null;
  readonly status: ActivityStatus;
  /** Present only for pending rows: the exact price side and condition. */
  readonly condition: string | null;
  readonly rejectReason: string | null;
  readonly submittedAt: ReplayMs;
  readonly cancellable: boolean;
  readonly amendable: boolean;
  readonly version: number;
}

/**
 * Open instructions and positions as rows.
 *
 * Sending and working orders are kept in the list **alongside** later positions: an instruction that
 * has not filled yet is exactly the thing the user needs to see, and dropping it the moment a
 * position appears is what makes a terminal feel like it has forgotten a click.
 */
export function activityRows(state: AccountState, rulesFor: (symbol: string) => InstrumentRules | null): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const quoteOf = (symbol: string): Quote | null => state.lastQuoteBySymbol?.[symbol.toUpperCase()] ?? null;

  for (const order of state.orders) {
    const rules = safeRules(rulesFor, order.symbol);
    const status = statusOf(order);
    rows.push({
      key: `order:${order.orderId}`,
      id: order.orderId,
      kind: 'ORDER',
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      size: order.size,
      level: order.level,
      status,
      condition: pendingConditionText(order, rules, quoteOf(order.symbol)),
      rejectReason: order.rejectReason ? rejectionCopy(order) : null,
      submittedAt: order.submittedAt,
      cancellable: order.state === 'WORKING' || order.state === 'ACCEPTED',
      amendable: order.state === 'WORKING' || order.state === 'ACCEPTED',
      version: order.version,
    });
  }

  for (const position of state.positions) {
    rows.push({
      key: `position:${position.positionId}`,
      id: position.positionId,
      kind: 'POSITION',
      symbol: position.symbol,
      side: position.direction === 'LONG' ? 'BUY' : 'SELL',
      type: 'POSITION',
      size: position.openSize,
      level: position.entryPrice,
      status: position.state === 'CLOSED' ? 'Closed' : 'Open',
      condition: null,
      rejectReason: null,
      submittedAt: position.entryReplayMs,
      cancellable: position.state === 'OPEN' && position.closeReservedBy === null,
      amendable: false,
      version: 0,
    });
  }

  // Newest first, but stable for equal timestamps so the list does not shuffle under the cursor.
  return rows.sort((a, b) => b.submittedAt - a.submittedAt || a.key.localeCompare(b.key));
}

/** Plain-language rejection copy. Never a bare code. */
export function rejectionCopy(order: Order): string {
  switch (order.rejectReason) {
    case 'NO_VALID_QUOTE':
      return 'Refused: no quote was available for this instrument, so there was no price to execute against.';
    case 'STALE_QUOTE':
      return 'Refused: the last quote was too old to execute against. Waiting rather than filling at a stale price.';
    case 'INVALID_TICK':
      return 'Refused: the level is not a valid price step for this instrument.';
    case 'INVALID_PLACEMENT':
      return 'Refused: this order type must sit on the other side of the market.';
    case 'MISSING_TARGET':
      return 'Refused: the position it targets is closed or missing.';
    case 'INSTRUCTION_CONSUMED':
      return 'Refused: the position’s size was already claimed by another instruction.';
    default:
      return order.rejectReason ? `Refused: ${order.rejectReason}.` : 'Refused.';
  }
}

// ---------------------------------------------------------------------------
// Lost races (SIM-UI-03)
// ---------------------------------------------------------------------------

export interface RaceNotice {
  readonly orderId: OrderId;
  /** What the user tried to do, and what actually happened instead. */
  readonly text: string;
  readonly outcome: 'CANCELLED_IN_TIME' | 'ARRIVED_TOO_LATE' | 'FILLED_ANYWAY' | 'CLOSE_TOO_LATE';
}

/**
 * Explain a lost race, if there was one.
 *
 * The requirement is that a lost race is acknowledged *plainly*: the user pressed cancel and the
 * order filled anyway, and the UI must say so rather than quietly leaving a filled row. The wording
 * names the instruction that won, because "cancellation failed" tells the user nothing actionable.
 */
export function raceNotices(state: AccountState): RaceNotice[] {
  const notices: RaceNotice[] = [];
  const eventsByOrder = groupEventsByOrder(state.events);

  for (const order of state.orders) {
    const events = eventsByOrder.get(order.orderId) ?? [];
    const terminal = events.find((e) => e.kind === 'CANCELLED' || e.kind === 'FILLED');
    // A refusal can come from either side of the wire and means the same thing to the user: the
    // instruction lost. The client refuses when it can already see the terminal state; the broker
    // refuses when the instruction arrives and finds the order gone.
    const lateInstruction = events.find(
      (e) =>
        e.kind === 'REJECTED' &&
        (String(e.detail?.stage ?? '') === 'BROKER' || String(e.detail?.stage ?? '') === 'CLIENT') &&
        /already|no longer|arrived after|too late/i.test(String(e.detail?.reason ?? '')),
    );

    if (lateInstruction && terminal?.kind === 'FILLED') {
      notices.push({
        orderId: order.orderId,
        outcome: 'ARRIVED_TOO_LATE',
        text:
          `The ${labelOf(order)} ${order.purpose === 'STOP_LOSS' ? 'stop' : 'order'} triggered before the ` +
          `${instructionWord(lateInstruction)} arrived, so it filled instead.`,
      });
      continue;
    }

    if (lateInstruction && terminal?.kind === 'CANCELLED') {
      notices.push({
        orderId: order.orderId,
        outcome: 'CANCELLED_IN_TIME',
        text: `The instruction arrived after the order had already been cancelled.`,
      });
    }
  }

  return notices;
}

function instructionWord(event: EngineEvent): string {
  const reason = String(event.detail?.reason ?? '');
  if (/cancel/i.test(reason)) return 'cancellation';
  if (/amend/i.test(reason)) return 'amendment';
  return 'instruction';
}

function labelOf(order: Order): string {
  return `${order.side} ${order.type}`;
}

function groupEventsByOrder(events: readonly EngineEvent[]): Map<OrderId, EngineEvent[]> {
  const map = new Map<OrderId, EngineEvent[]>();
  for (const event of events) {
    if (!event.orderId) continue;
    const list = map.get(event.orderId) ?? [];
    list.push(event);
    map.set(event.orderId, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Timeline (SIM-UI-04)
// ---------------------------------------------------------------------------

export type TransitionName =
  | 'Submitted'
  | 'BrokerArrival'
  | 'Accepted'
  | 'QuoteEligible'
  | 'Triggered'
  | 'Executed'
  | 'NoticeReceived';

export interface TimelineTransition {
  readonly name: TransitionName;
  readonly label: string;
  readonly replayMs: ReplayMs | null;
  /** The quote side and the reason at this transition, where the engine recorded one. */
  readonly quoteSide: 'bid' | 'ask' | null;
  readonly quotePrice: number | null;
  readonly reason: string | null;
}

export interface TimelineIntervals {
  /**
   * How long the order itself took to execute, measured from the moment it was free to execute:
   * the trigger for a conditional order, or eligibility for a market order.
   *
   * This is deliberately NOT `eligible → filled`, which would swallow the market waiting time and
   * report the same number twice under two different names.
   */
  readonly executionDelayMs: number | null;
  /** Eligibility → trigger: how long the market took to satisfy the condition. Null if it never had to wait. */
  readonly marketWaitingMs: number | null;
  /** Executed → notice received: how long before the client learned about it. */
  readonly notificationDelayMs: number | null;
}

export interface OrderTimeline {
  readonly orderId: OrderId;
  readonly transitions: readonly TimelineTransition[];
  readonly intervals: TimelineIntervals;
}

const TRANSITION_ORDER: TransitionName[] = [
  'Submitted',
  'BrokerArrival',
  'Accepted',
  'QuoteEligible',
  'Triggered',
  'Executed',
  'NoticeReceived',
];

const TRANSITION_LABELS: Record<TransitionName, string> = {
  Submitted: 'Submitted',
  BrokerArrival: 'Simulated broker arrival',
  Accepted: 'Accepted / working',
  QuoteEligible: 'Quote eligible',
  Triggered: 'Triggered',
  Executed: 'Executed',
  NoticeReceived: 'Notice received',
};

/**
 * The distinct transitions of one instruction, and the three intervals that are routinely confused
 * with one another.
 *
 * This is the heart of the phase: "how long did the broker take", "how long did the market take to
 * reach my level", and "how long before I was told" are three different numbers, and a single
 * "latency" figure hides which one the user is actually looking at.
 */
export function orderTimeline(state: AccountState, orderId: OrderId): OrderTimeline {
  const events = (groupEventsByOrder(state.events).get(orderId) ?? []).slice().sort((a, b) => a.seq - b.seq);
  const find = (kind: string): EngineEvent | undefined => events.find((e) => e.kind === kind);

  const submitted = find('COMMAND_SUBMITTED');
  const arrival = find('COMMAND_ARRIVED');
  const accepted = find('ACCEPTED') ?? find('WORKING');
  const eligible = find('ELIGIBLE');
  const triggered = find('TRIGGERED');
  const filled = find('FILLED');
  const notice = events.find((e) => e.kind === 'NOTICE_DELIVERED' && e.detail?.notice === 'FILL_NOTIFICATION');

  const quoteAt = (event: EngineEvent | undefined, order: Order | undefined) => {
    const quote = event?.detail?.quote as { bid?: number; ask?: number } | undefined;
    if (!quote) return { side: null as 'bid' | 'ask' | null, price: null as number | null };
    const side: 'bid' | 'ask' = order?.side === 'BUY' ? 'ask' : 'bid';
    return { side, price: (side === 'ask' ? quote.ask : quote.bid) ?? null };
  };

  const order = state.orders.find((o) => o.orderId === orderId);
  const at = (event: EngineEvent | undefined): ReplayMs | null => (event ? event.replayMs : null);

  const transitions: TimelineTransition[] = [
    { name: 'Submitted', label: TRANSITION_LABELS.Submitted, replayMs: at(submitted), quoteSide: null, quotePrice: null, reason: 'Instruction left the ticket.' },
    { name: 'BrokerArrival', label: TRANSITION_LABELS.BrokerArrival, replayMs: at(arrival), quoteSide: null, quotePrice: null, reason: arrival ? 'Reached the simulated broker.' : null },
    { name: 'Accepted', label: TRANSITION_LABELS.Accepted, replayMs: at(accepted), quoteSide: null, quotePrice: null, reason: accepted ? 'Accepted and resting.' : null },
    {
      name: 'QuoteEligible',
      label: TRANSITION_LABELS.QuoteEligible,
      replayMs: at(eligible),
      quoteSide: null,
      quotePrice: null,
      reason: eligible ? 'Dispatch delay elapsed; the order can now execute against quotes.' : null,
    },
    {
      name: 'Triggered',
      label: TRANSITION_LABELS.Triggered,
      replayMs: at(triggered),
      ...(() => {
        const q = quoteAt(triggered, order);
        return { quoteSide: q.side, quotePrice: q.price };
      })(),
      reason: triggered ? String(triggered.detail?.rule ?? 'Condition met and latched.') : null,
    },
    {
      name: 'Executed',
      label: TRANSITION_LABELS.Executed,
      replayMs: at(filled),
      ...(() => {
        const q = quoteAt(filled, order);
        return { quoteSide: q.side, quotePrice: q.price };
      })(),
      reason: filled
        ? `Filled ${String(filled.detail?.size ?? '')} at ${String(filled.detail?.price ?? '')} on the ${order?.side === 'BUY' ? 'ask' : 'bid'}.`
        : null,
    },
    {
      name: 'NoticeReceived',
      label: TRANSITION_LABELS.NoticeReceived,
      replayMs: at(notice),
      quoteSide: null,
      quotePrice: null,
      reason: notice ? 'The client learned the fill had happened.' : null,
    },
  ];

  const eligibleMs = at(eligible);
  const triggeredMs = at(triggered);
  const filledMs = at(filled);
  const noticeMs = at(notice);

  return {
    orderId,
    transitions,
    intervals: {
      // Measured from the trigger when there was one: an order that waited 4.85 s for the market and
      // then filled instantly has a 4.85 s waiting time and a zero execution delay, not two 4.85 s
      // numbers under different labels.
      executionDelayMs:
        filledMs !== null
          ? round3(filledMs - (triggeredMs ?? eligibleMs ?? filledMs))
          : null,
      marketWaitingMs: triggeredMs !== null && eligibleMs !== null ? round3(triggeredMs - eligibleMs) : null,
      notificationDelayMs:
        noticeMs !== null && filledMs !== null
          ? round3(noticeMs - filledMs)
          : notice && typeof notice.detail?.notificationDelayMs === 'number'
            ? round3(notice.detail.notificationDelayMs)
            : null,
    },
  };
}

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** All transitions that exist, in lifecycle order, for rendering as a vertical list. */
export function presentTransitions(timeline: OrderTimeline): TimelineTransition[] {
  return timeline.transitions
    .filter((t) => t.replayMs !== null)
    .sort((a, b) => TRANSITION_ORDER.indexOf(a.name) - TRANSITION_ORDER.indexOf(b.name) || (a.replayMs ?? 0) - (b.replayMs ?? 0));
}

// ---------------------------------------------------------------------------
// Ticket (SIM-UI-01)
// ---------------------------------------------------------------------------

export type TicketError =
  | { code: 'SIZE_TOO_SMALL'; message: string }
  | { code: 'SIZE_NOT_INCREMENT'; message: string }
  | { code: 'SIZE_NOT_POSITIVE'; message: string }
  | { code: 'LEVEL_REQUIRED'; message: string }
  | { code: 'LEVEL_NOT_ON_TICK'; message: string }
  | { code: 'LEVEL_WRONG_SIDE'; message: string }
  | { code: 'NO_QUOTE'; message: string };

export interface TicketModel {
  readonly symbol: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly spread: number | null;
  readonly spreadInTicks: number | null;
  readonly quoteAgeMs: number | null;
  readonly estimatedDelay: Labelled<number>;
  readonly profileLabel: string;
  readonly profileId: string;
  readonly sizeIncrement: number;
  readonly minSize: number;
  readonly tickSize: number;
  readonly priceDecimals: number;
  readonly errors: readonly TicketError[];
  readonly canSubmit: boolean;
  readonly levelRequired: boolean;
}

/**
 * Everything the ticket shows, and whether it may be submitted.
 *
 * Validation lives here rather than in the component so that the same rules the engine enforces are
 * the ones the ticket explains. `canSubmit` is false when any error is present, which is what keeps
 * a doomed instruction from being sent and then quietly rejected.
 */
export function ticketModel(options: {
  symbol: string;
  side: Side;
  type: 'MARKET' | 'LIMIT' | 'STOP';
  size: number;
  level: number | null;
  quote: Quote | null;
  nowMs: ReplayMs;
  rules: InstrumentRules;
  profile: LatencyProfile;
}): TicketModel {
  const { symbol, side, type, size, level, quote, nowMs, rules, profile } = options;
  const errors: TicketError[] = [];

  if (!Number.isFinite(size) || size <= 0) {
    errors.push({ code: 'SIZE_NOT_POSITIVE', message: 'Quantity must be greater than zero.' });
  } else if (size < rules.minSize) {
    errors.push({ code: 'SIZE_TOO_SMALL', message: `Minimum quantity is ${rules.minSize}.` });
  } else {
    const units = Math.round(size / rules.sizeIncrement);
    if (Math.abs(units * rules.sizeIncrement - size) > rules.sizeIncrement * 1e-6) {
      errors.push({ code: 'SIZE_NOT_INCREMENT', message: `Quantity must be a multiple of ${rules.sizeIncrement}.` });
    }
  }

  const levelRequired = type !== 'MARKET';
  if (levelRequired) {
    if (level === null || !Number.isFinite(level)) {
      errors.push({ code: 'LEVEL_REQUIRED', message: `A ${type.toLowerCase()} order needs a level.` });
    } else if (!isOnTick(level, rules)) {
      errors.push({ code: 'LEVEL_NOT_ON_TICK', message: `Level must be a multiple of ${rules.tickSize}.` });
    } else if (quote) {
      const rule = TRIGGER_MATRIX[type as TriggerKind][side];
      const mid = (quote.bid + quote.ask) / 2;
      const required = rule.placement === 'ABOVE_MARKET';
      if (rule.enforcesPlacement && level > mid !== required) {
        errors.push({
          code: 'LEVEL_WRONG_SIDE',
          message: `A ${side} ${type.toLowerCase()} must be placed ${required ? 'above' : 'below'} the market.`,
        });
      }
    }
  }

  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const spread = bid !== null && ask !== null ? round3(ask - bid) : null;

  return {
    symbol: symbol.toUpperCase(),
    bid,
    ask,
    spread,
    spreadInTicks: spread === null ? null : round3(spread / rules.tickSize),
    quoteAgeMs: quote ? round3(nowMs - quote.replayMs) : null,
    estimatedDelay: profile.acknowledgementMs,
    profileLabel: profile.label,
    profileId: profile.id,
    sizeIncrement: rules.sizeIncrement,
    minSize: rules.minSize,
    tickSize: rules.tickSize,
    priceDecimals: rules.priceDecimals,
    errors,
    canSubmit: errors.length === 0,
    levelRequired,
  };
}

// ---------------------------------------------------------------------------
// Settings and provenance (SIM-UI-05)
// ---------------------------------------------------------------------------

export interface SettingDescriptor {
  readonly key: string;
  readonly label: string;
  readonly valueMs: number;
  readonly provenance: Provenance;
  readonly note: string;
  readonly sampleCount: number | null;
  /** Whether the user may edit it. Observed evidence is not a setting. */
  readonly editable: boolean;
}

/**
 * The latency profile as editable settings, with provenance attached to each value.
 *
 * A value that came from a real observation is presented as evidence and marked NOT editable: the
 * user may choose a different training value, but must not be able to relabel a measurement as one
 * of their own preferences, or a preference as a measurement.
 */
export function settingDescriptors(profile: LatencyProfile): SettingDescriptor[] {
  const build = (key: string, label: string, value: Labelled<number>): SettingDescriptor => ({
    key,
    label,
    valueMs: value.value,
    provenance: value.provenance,
    note: value.note ?? '',
    sampleCount: value.sampleCount ?? null,
    editable: value.provenance !== 'OBSERVED_SAMPLE',
  });

  return [
    build('travelMs', 'Instruction travel time', profile.travelMs),
    build('acceptanceMs', 'Broker acceptance', profile.acceptanceMs),
    build('acknowledgementMs', 'Acknowledgement envelope', profile.acknowledgementMs),
    build('dispatchMs', 'Execution dispatch', profile.dispatchMs),
    build('notificationMs', 'Fill notification', profile.notificationMs),
    build('maxQuoteAgeMs', 'Quote freshness limit', profile.maxQuoteAgeMs),
  ];
}

export interface EvidenceCard {
  readonly id: string;
  readonly title: string;
  readonly valueText: string;
  readonly provenance: Provenance;
  readonly detail: string;
}

/**
 * The pilot's observed response envelopes as read-only reference cards.
 *
 * These are kept deliberately separate from the simulated output: they are what was measured, once,
 * on a weekend demo account, and they are not a distribution to be fitted or a setting to be tuned.
 */
export const PILOT_EVIDENCE_CARDS: EvidenceCard[] = [
  {
    id: 'pilot-post-market',
    title: 'Demo BUY, MARKET order',
    valueText: '231.5 ms',
    provenance: 'OBSERVED_SAMPLE',
    detail:
      'In one demo BUY the POST response envelope took 231.5 ms. Single sample: this is a reference ' +
      'point, not a distribution, and it does not decompose into travel, processing and return.',
  },
  {
    id: 'pilot-post-limit',
    title: 'Demo BUY, LIMIT order',
    valueText: '203.8 ms',
    provenance: 'OBSERVED_SAMPLE',
    detail: 'In one demo BUY the LIMIT POST response envelope took 203.8 ms. Single sample.',
  },
  {
    id: 'pilot-post-stop',
    title: 'Demo BUY, STOP order',
    valueText: '204.4 ms',
    provenance: 'OBSERVED_SAMPLE',
    detail: 'In one demo BUY the STOP POST response envelope took 204.4 ms. Single sample.',
  },
  {
    id: 'pilot-unavailable',
    title: 'Not measured',
    valueText: '—',
    provenance: 'TRAINING_ASSUMPTION',
    detail:
      'No one-way delay, no dispatch delay and no fill-notification delay were measurable from the ' +
      'pilot. Every such value in this simulator is an editable training assumption.',
  },
];

// ---------------------------------------------------------------------------
// Learning copy and live announcements (SIM-UI-06)
// ---------------------------------------------------------------------------

export const SIMULATED_ACCOUNT_LABEL = 'Simulated account — no broker is contacted.';

export const ORDER_TYPE_COPY: Record<'MARKET' | 'LIMIT' | 'STOP', { title: string; consequence: string }> = {
  MARKET: {
    title: 'Market',
    consequence:
      'Executes immediately at the other side of the spread: a BUY pays the ask, a SELL receives the ' +
      'bid. You control the quantity, not the price.',
  },
  LIMIT: {
    title: 'Limit',
    consequence:
      'Rests until the market touches your level, and fills at the level rather than worse. A BUY ' +
      'limit sits below the market; a SELL limit sits above it. It may never fill.',
  },
  STOP: {
    title: 'Stop',
    consequence:
      'Waits for the market to reach your level, then executes at the other side of the spread, which ' +
      'can be a worse price. A BUY stop sits above the market; a SELL stop sits below it.',
  },
};

/**
 * The announcement for a meaningful transition.
 *
 * Only transitions that change what the user needs to know are announced. Price ticks are not
 * transitions, and announcing them would make the status region unusable — the requirement is
 * explicit that a live region must not narrate every tick.
 */
export function announce(state: AccountState, previousEventCount: number): string | null {
  const events = state.events;
  if (events.length <= previousEventCount) return null;

  const fresh = events.slice(previousEventCount);
  const meaningful = fresh.filter((e) =>
    ['ACCEPTED', 'ELIGIBLE', 'TRIGGERED', 'FILLED', 'CANCELLED', 'REJECTED', 'NOTICE_DELIVERED', 'POSITION_OPENED', 'POSITION_CLOSED'].includes(
      e.kind,
    ),
  );
  if (meaningful.length === 0) return null;

  // One sentence per batch: a burst of events must not produce a burst of speech.
  const last = meaningful[meaningful.length - 1];
  const order = last.orderId ? state.orders.find((o) => o.orderId === last.orderId) : undefined;
  const subject = order ? `${order.side} ${order.type}` : 'Instruction';

  switch (last.kind) {
    case 'ACCEPTED':
      return `${subject} accepted and working.`;
    case 'ELIGIBLE':
      return `${subject} is now eligible to execute.`;
    case 'TRIGGERED':
      return `${subject} triggered.`;
    case 'FILLED':
      return `${subject} filled at ${String(last.detail?.price ?? '')}.`;
    case 'CANCELLED':
      return `${subject} cancelled.`;
    case 'REJECTED':
      return `${subject} rejected: ${String(last.detail?.reason ?? '')}`;
    case 'POSITION_OPENED':
      return 'Position opened.';
    case 'POSITION_CLOSED':
      return 'Position closed.';
    default:
      return meaningful.length > 1 ? `${meaningful.length} order updates.` : null;
  }
}
