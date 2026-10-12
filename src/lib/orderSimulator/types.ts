/**
 * Order simulator — domain types.
 *
 * Entity identities are deliberately distinct and branded. The Capital.com pilot's own cleanup
 * failed by closing a position with an ORDER id, so the type system is the first line of defence:
 * a `PositionId` cannot be used where an `OrderId` is expected.
 *
 * This module has no runtime dependencies and no imports.
 */

// ---------------------------------------------------------------------------
// Branded identities
// ---------------------------------------------------------------------------

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** A client-side submission. Never a broker identity. */
export type RequestId = Brand<string, 'RequestId'>;
/** The broker's identity for an order (a working order or an entry order). */
export type OrderId = Brand<string, 'OrderId'>;
/** The broker's identity for a position. Closes target THIS, never an OrderId. */
export type PositionId = Brand<string, 'PositionId'>;
/** One execution. */
export type FillId = Brand<string, 'FillId'>;
/** A simulation session. Reset/date-change creates a new one. */
export type SessionId = Brand<string, 'SessionId'>;

// ---------------------------------------------------------------------------
// Time and market data
// ---------------------------------------------------------------------------

/** Replay-market milliseconds. The ONLY clock the engine knows. */
export type ReplayMs = number;

export interface Quote {
  readonly symbol: string;
  readonly bid: number;
  readonly ask: number;
  readonly replayMs: ReplayMs;
  /**
   * Stable tape sequence. Quote identity must survive buffer prepends and merges, so this is the
   * deduplication key — never an array index.
   */
  readonly seq: number;
  /**
   * True when the bid/ask were derived from a single print rather than observed. A derived quote is
   * a disclosed convention, never a measurement.
   */
  readonly derived?: boolean;
}

export type MovementReason =
  | 'PLAY'
  | 'FORWARD_STEP'
  | 'BACKWARD_STEP'
  | 'SEEK_FORWARD'
  | 'SEEK_BACKWARD'
  | 'SESSION_RESET'
  | 'BUFFER_REPLACED';

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Where a parameter's value came from. Nothing may be presented as measured unless it is
 * OBSERVED_SAMPLE. See `.planning/research/PITFALLS.md` Pitfall 2.
 */
export type Provenance = 'OBSERVED_SAMPLE' | 'DOCUMENTED_RULE' | 'TRAINING_ASSUMPTION';

export interface Labelled<T> {
  readonly value: T;
  readonly provenance: Provenance;
  readonly note?: string;
  /** Number of independent observations, when provenance is OBSERVED_SAMPLE. */
  readonly sampleCount?: number;
}

// ---------------------------------------------------------------------------
// Instrument rules
// ---------------------------------------------------------------------------

export interface InstrumentRules {
  readonly symbol: string;
  /** Minimum price increment, in price units. */
  readonly tickSize: number;
  readonly minSize: number;
  readonly sizeIncrement: number;
  /** Decimal places used to convert prices to exact integer price units. */
  readonly priceDecimals: number;
  readonly contractMultiplier: number;
  readonly currency: string;
  readonly provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';
export type OrderPurpose = 'ENTRY' | 'CLOSE' | 'STOP_LOSS' | 'TAKE_PROFIT';

export type OrderState =
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'WORKING'
  | 'TRIGGERED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED';

export type RejectReason =
  | 'INVALID_SIZE'
  | 'INVALID_TICK'
  | 'MISSING_LEVEL'
  | 'INVALID_PLACEMENT'
  | 'UNSUPPORTED_SYMBOL'
  | 'NO_VALID_QUOTE'
  | 'STALE_QUOTE'
  | 'CROSSED_QUOTE'
  | 'INSTRUCTION_TOO_LATE'
  | 'INSTRUCTION_CONSUMED'
  | 'MISSING_TARGET'
  | 'SIZE_EXCEEDS_POSITION';

export interface Order {
  readonly orderId: OrderId;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly symbol: string;
  readonly side: Side;
  readonly type: OrderType;
  readonly purpose: OrderPurpose;
  readonly size: number;
  /** Limit or stop level. Absent for MARKET. */
  readonly level: number | null;
  readonly positionId: PositionId | null;
  /** Bumped by every accepted amendment; stale instructions cannot overwrite a later state. */
  readonly version: number;
  state: OrderState;
  readonly submittedAt: ReplayMs;
  acceptedAt: ReplayMs | null;
  workingAt: ReplayMs | null;
  /** When the dispatch delay elapsed and the order became executable. Never a public state. */
  armedAt: ReplayMs | null;
  triggeredAt: ReplayMs | null;
  terminalAt: ReplayMs | null;
  rejectReason: RejectReason | null;
  /** The profile captured at submission. Later settings changes never affect this order. */
  readonly profileSnapshot: LatencyProfile;
  /** The quote the client saw when the command was submitted, if any. */
  readonly submittedQuote: Quote | null;
}

// ---------------------------------------------------------------------------
// Fills and positions
// ---------------------------------------------------------------------------

export interface Fill {
  readonly fillId: FillId;
  readonly orderId: OrderId;
  readonly positionId: PositionId;
  readonly symbol: string;
  readonly side: Side;
  readonly quantity: number;
  readonly price: number;
  readonly replayMs: ReplayMs;
  readonly quoteSeq: number;
  /** Price at submission, for adverse-move reporting. Positive = adverse. */
  readonly priceChangeFromSubmit: number | null;
  /** Direction-aware difference from a stop level to the fill. */
  readonly stopToFillDifference: number | null;
}

export interface Position {
  readonly positionId: PositionId;
  readonly symbol: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly size: number;
  readonly entryPrice: number;
  readonly entryReplayMs: ReplayMs;
  readonly entryFillId: FillId;
  /** Size still open. Decreases as closes fill. */
  openSize: number;
  realizedPnl: number;
  state: 'OPEN' | 'CLOSING' | 'CLOSED';
  slOrderId: OrderId | null;
  tpOrderId: OrderId | null;
  /** Manual/scheduled close commitment; reserves the close so exits cannot both apply. */
  closeReservedBy: OrderId | null;
}

// ---------------------------------------------------------------------------
// Latency profile
// ---------------------------------------------------------------------------

export interface LatencyProfile {
  readonly id: string;
  readonly label: string;
  /** Command travel to the simulated broker. */
  readonly travelMs: Labelled<number>;
  /** Acceptance/validation processing at the broker. */
  readonly acceptanceMs: Labelled<number>;
  /** Acknowledgement arrival at the client. */
  readonly acknowledgementMs: Labelled<number>;
  /** Execution dispatch delay after eligibility/acceptance. */
  readonly dispatchMs: Labelled<number>;
  /** Notification delay after the economic event. */
  readonly notificationMs: Labelled<number>;
  /** Maximum age of a quote that may be used for acceptance or execution. */
  readonly maxQuoteAgeMs: Labelled<number>;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface AttachmentInput {
  readonly stopLoss?: number;
  readonly takeProfit?: number;
}

export interface SubmitOrderInput {
  readonly symbol: string;
  readonly side: Side;
  readonly type: OrderType;
  readonly size: number;
  readonly level?: number | null;
  readonly attachments?: AttachmentInput;
}

export interface ClosePositionInput {
  readonly positionId: PositionId;
}

export interface CancelOrderInput {
  readonly orderId: OrderId;
}

export interface AmendOrderInput {
  readonly orderId: OrderId;
  readonly version: number;
  readonly level: number;
}

export type Command =
  | { readonly kind: 'SUBMIT'; readonly requestId: RequestId; readonly input: SubmitOrderInput }
  | { readonly kind: 'CLOSE'; readonly requestId: RequestId; readonly input: ClosePositionInput }
  | { readonly kind: 'CANCEL'; readonly requestId: RequestId; readonly input: CancelOrderInput }
  | { readonly kind: 'AMEND'; readonly requestId: RequestId; readonly input: AmendOrderInput };

// ---------------------------------------------------------------------------
// Events (the audit trail; also the determinism surface)
// ---------------------------------------------------------------------------

export type EngineEventKind =
  | 'COMMAND_SUBMITTED'
  | 'COMMAND_ARRIVED'
  | 'ACCEPTED'
  | 'WORKING'
  | 'TRIGGERED'
  | 'ELIGIBLE'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'QUOTE_ELIGIBLE'
  | 'WAITING_FOR_QUOTE'
  | 'NOTICE_DELIVERED'
  | 'POSITION_OPENED'
  | 'POSITION_CLOSED'
  | 'INSTRUCTION_CANCELLED'
  | 'INSTRUCTION_AMENDED'
  | 'WAITING_FOR_DATA';

export interface EngineEvent {
  /** Monotonic across the session. The stable ordering key for the whole event log. */
  readonly seq: number;
  readonly replayMs: ReplayMs;
  readonly kind: EngineEventKind;
  readonly requestId: RequestId | null;
  readonly orderId: OrderId | null;
  readonly positionId: PositionId | null;
  /** Broker-processed time vs the time the client learned about it. */
  readonly brokerMs: ReplayMs | null;
  readonly clientKnownMs: ReplayMs | null;
  readonly detail: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Account projection
// ---------------------------------------------------------------------------

export interface AccountState {
  readonly sessionId: SessionId;
  readonly nowMs: ReplayMs;
  readonly orders: readonly Order[];
  readonly positions: readonly Position[];
  readonly fills: readonly Fill[];
  /** Realised PnL across the whole account. Counted once per position. */
  readonly realizedPnl: number;
  /** Unrealised PnL valued at the close side (long→bid, short→ask). */
  readonly unrealizedPnl: number;
  readonly events: readonly EngineEvent[];
}
