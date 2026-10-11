import type {
  AccountState,
  AmendOrderInput,
  CancelOrderInput,
  ClosePositionInput,
  Command,
  EngineEvent,
  EngineEventKind,
  Fill,
  FillId,
  InstrumentRules,
  LatencyProfile,
  Order,
  OrderId,
  OrderPurpose,
  OrderState,
  Position,
  PositionId,
  Quote,
  ReplayMs,
  RequestId,
  SessionId,
  Side,
  SubmitOrderInput,
} from './types';
import { priceToTicks, ticksToPrice, roundToDecimals, type TickRules } from './ticks';
import { DeterministicScheduler, SequenceGenerator } from './scheduler';
import { createInstrumentRegistry, UnsupportedSymbolError } from './profiles';
import { triggerConditionMet, validatePlacement } from './triggers';

// ---------------------------------------------------------------------------
// Engine options and outcomes
// ---------------------------------------------------------------------------

export interface EngineOptions {
  sessionId: string;
  instruments: InstrumentRules[];
  profile: LatencyProfile;
  /** Initial replay-market time. */
  startMs?: ReplayMs;
  /** Cap on `runUntilIdle` iterations, so a bug cannot hang the tab. */
  maxIterations?: number;
}

export interface CommandOutcome {
  readonly requestId: RequestId;
  /** The command was accepted for processing. Not the same as the order being accepted. */
  readonly accepted: boolean;
  readonly orderId: OrderId | null;
  /** Immediate, client-side validation failure (nothing was scheduled). */
  readonly clientError: string | null;
}

/** Every action the engine can schedule. Discriminated so `handleAction` is exhaustive. */
type ScheduledAction =
  | { kind: 'COMMAND_ARRIVAL'; requestId: RequestId; orderId: OrderId }
  | { kind: 'ACCEPT_ORDER'; requestId: RequestId; orderId: OrderId }
  | { kind: 'ELIGIBLE'; orderId: OrderId }
  | { kind: 'NOTIFY_FILL'; orderId: OrderId; fillId: FillId }
  | { kind: 'NOTIFY_ORDER'; orderId: OrderId; state: OrderState }
  | { kind: 'CLOSE_POSITION_REQUEST'; requestId: RequestId; positionId: PositionId; orderId: OrderId };

function fmt(ms: number): string {
  return String(Math.round(ms * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class OrderSimulatorEngine {
  readonly sessionId: SessionId;
  private readonly rulesFor: (symbol: string) => InstrumentRules;
  private readonly tickRulesBySymbol = new Map<string, TickRules>();
  private readonly profile: LatencyProfile;
  private readonly maxIterations: number;

  private readonly scheduler = new DeterministicScheduler<ScheduledAction>();

  private readonly seq = new SequenceGenerator(1);
  private readonly eventSeq = new SequenceGenerator(1);
  private readonly orderSeq = new SequenceGenerator(1);
  private readonly positionSeq = new SequenceGenerator(1);
  private readonly fillSeq = new SequenceGenerator(1);
  private readonly requestSeq = new SequenceGenerator(1);

  private nowMs: ReplayMs;
  private ordersById = new Map<OrderId, Order>();
  private positionsById = new Map<PositionId, Position>();
  private fills: Fill[] = [];
  private events: EngineEvent[] = [];
  private lastQuoteBySymbol = new Map<string, Quote>();
  private iterationCount = 0;

  constructor(options: EngineOptions) {
    this.sessionId = options.sessionId as SessionId;
    this.profile = options.profile;
    this.nowMs = options.startMs ?? 0;
    this.maxIterations = options.maxIterations ?? 10_000;
    this.rulesFor = createInstrumentRegistry(options.instruments);
    for (const r of options.instruments) {
      this.tickRulesBySymbol.set(r.symbol.toUpperCase(), { tickSize: r.tickSize, priceDecimals: r.priceDecimals });
    }
  }

  // -- clock ---------------------------------------------------------------

  /** Replay-market time. Advanced ONLY by the scheduler when it dispatches an action. */
  now(): ReplayMs {
    return this.nowMs;
  }

  // -- quote input ---------------------------------------------------------

  /**
   * Feed a quote. Quotes are the engine's only external input.
   *
   * Re-evaluation is a cascade: after each new quote every eligible resting order is re-evaluated,
   * which is what makes a one-tick sweep behave the way a real matching engine does.
   */
  onQuote(quote: Quote): void {
    if (!Number.isFinite(quote.bid) || !Number.isFinite(quote.ask)) {
      throw new Error(`Quote for ${quote.symbol} has a non-finite price`);
    }
    if (quote.bid > quote.ask) {
      this.emit('WAITING_FOR_DATA', null, null, null, { reason: 'CROSSED_QUOTE', bid: quote.bid, ask: quote.ask });
      return;
    }
    if (quote.replayMs < this.nowMs) {
      // Out-of-order quote: refused rather than applied, so the tape is monotonic by construction.
      throw new Error(
        `Quote timestamp ${fmt(quote.replayMs)} is before engine time ${fmt(this.nowMs)}. ` +
          'Quotes must arrive in non-decreasing replay time.',
      );
    }
    // The market data tape IS the engine's clock source: accepting a quote advances replay time to
    // it. Combined with the monotonicity check above, the engine can never observe a quote from the
    // past, and it still never reads a wall clock.
    this.nowMs = Math.max(this.nowMs, quote.replayMs);
    this.lastQuoteBySymbol.set(quote.symbol.toUpperCase(), quote);
    this.cascade(quote.symbol);
  }

  private cascade(symbol: string): void {
    for (const order of this.ordersById.values()) {
      if (order.symbol.toUpperCase() !== symbol.toUpperCase()) continue;
      // Only WORKING orders that have passed the dispatch delay can execute.
      if (order.state !== 'WORKING' || order.armedAt === null) continue;
      this.tryTrigger(order);
    }
  }

  // -- commands ------------------------------------------------------------

  private nextRequestId(): RequestId {
    return `R-${this.requestSeq.next()}` as RequestId;
  }

  private nextOrderId(): OrderId {
    return `O-${this.orderSeq.next()}` as OrderId;
  }

  private nextPositionId(): PositionId {
    return `P-${this.positionSeq.next()}` as PositionId;
  }

  submitOrder(input: SubmitOrderInput): CommandOutcome {
    const requestId = this.nextRequestId();
    return this.dispatch({ kind: 'SUBMIT', requestId, input });
  }

  closePosition(positionId: PositionId): CommandOutcome {
    const requestId = this.nextRequestId();
    return this.dispatch({ kind: 'CLOSE', requestId, input: { positionId } });
  }

  cancelOrder(orderId: OrderId): CommandOutcome {
    const requestId = this.nextRequestId();
    return this.dispatch({ kind: 'CANCEL', requestId, input: { orderId } });
  }

  amendOrder(orderId: OrderId, version: number, level: number): CommandOutcome {
    const requestId = this.nextRequestId();
    return this.dispatch({ kind: 'AMEND', requestId, input: { orderId, version, level } });
  }

  /**
   * Dispatch a command. Client-side validation happens synchronously so the caller learns
   * immediately; everything else is scheduled at real (simulated) delay.
   */
  dispatch(command: Command): CommandOutcome {
    const reject = (clientError: string): CommandOutcome => {
      this.emit('REJECTED', command.requestId, null, null, { stage: 'CLIENT', reason: clientError });
      return { requestId: command.requestId, accepted: false, orderId: null, clientError };
    };

    switch (command.kind) {
      case 'SUBMIT':
        return this.dispatchSubmit(command.requestId, command.input);
      case 'CLOSE':
        return this.dispatchClose(command.requestId, command.input);
      case 'CANCEL':
        return this.dispatchCancel(command.requestId, command.input);
      case 'AMEND':
        return this.dispatchAmend(command.requestId, command.input);
      default: {
        const exhaustive: never = command;
        void exhaustive;
        return reject('Unknown command');
      }
    }
  }

  private dispatchSubmit(requestId: RequestId, input: SubmitOrderInput): CommandOutcome {
    const reject = (clientError: string): CommandOutcome => {
      this.emit('REJECTED', requestId, null, null, { stage: 'CLIENT', reason: clientError });
      return { requestId, accepted: false, orderId: null, clientError };
    };

    let rules: InstrumentRules;
    try {
      rules = this.rulesFor(input.symbol);
    } catch (err) {
      return reject(err instanceof UnsupportedSymbolError ? err.message : 'Unknown symbol');
    }
    const tick = this.tickRulesBySymbol.get(rules.symbol.toUpperCase())!;

    if (!Number.isFinite(input.size) || input.size <= 0) {
      return reject(`Size must be a positive number (received ${input.size}).`);
    }
    // Minimum first: for a size that is both too small and off-increment, "below the minimum" is
    // the more useful message, and it is the one a real ticket would show.
    if (input.size < rules.minSize) {
      return reject(`Size ${input.size} is below the minimum size ${rules.minSize}.`);
    }
    const sizeUnits = Math.round(input.size / rules.sizeIncrement);
    if (Math.abs(sizeUnits * rules.sizeIncrement - input.size) > rules.sizeIncrement * 1e-6) {
      return reject(`Size ${input.size} is not a multiple of the size increment ${rules.sizeIncrement}.`);
    }

    const isMarket = input.type === 'MARKET';
    if (!isMarket) {
      if (input.level === null || input.level === undefined || !Number.isFinite(input.level)) {
        return reject(`A ${input.type} order requires a finite level.`);
      }
      try {
        priceToTicks(input.level, tick);
      } catch (err) {
        return reject(err instanceof Error ? err.message : 'Invalid level');
      }
    }

    const quote = this.lastQuoteBySymbol.get(rules.symbol.toUpperCase()) ?? null;
    if (!isMarket && quote) {
      const verdict = validatePlacement(input.type as 'STOP' | 'LIMIT', input.side, input.level!, quote);
      if (!verdict.ok) return reject(verdict.reason);
    }

    const orderId = this.nextOrderId();
    const order: Order = {
      orderId,
      requestId,
      sessionId: this.sessionId,
      symbol: rules.symbol,
      side: input.side,
      type: input.type,
      purpose: 'ENTRY',
      size: input.size,
      level: isMarket ? null : input.level!,
      positionId: null,
      version: 0,
      state: 'SUBMITTED',
      submittedAt: this.nowMs,
      acceptedAt: null,
      workingAt: null,
      triggeredAt: null,
      terminalAt: null,
      rejectReason: null,
      // The profile is captured at submission: changing settings later must never change this order.
      profileSnapshot: this.profile,
      submittedQuote: quote ? { ...quote } : null,
      attachments: input.attachments ? { ...input.attachments } : undefined,
    } as Order & { attachments?: { stopLoss?: number; takeProfit?: number } };

    this.ordersById.set(orderId, order);
    this.emit('COMMAND_SUBMITTED', requestId, orderId, null, {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      size: order.size,
      level: order.level,
      quote: quote ? { bid: quote.bid, ask: quote.ask } : null,
      profileId: this.profile.id,
    });

    const travel = this.profile.travelMs.value;
    this.scheduler.schedule(this.nowMs + travel, { kind: 'COMMAND_ARRIVAL', requestId, orderId });
    return { requestId, accepted: true, orderId, clientError: null };
  }

  private dispatchClose(requestId: RequestId, input: ClosePositionInput): CommandOutcome {
    const reject = (clientError: string): CommandOutcome => {
      this.emit('REJECTED', requestId, null, input.positionId, { stage: 'CLIENT', reason: clientError });
      return { requestId, accepted: false, orderId: null, clientError };
    };

    const position = this.positionsById.get(input.positionId);
    if (!position) {
      return reject(`No position with id ${input.positionId}.`);
    }
    if (position.state !== 'OPEN') {
      return reject(`Position ${input.positionId} is ${position.state} and cannot be closed again.`);
    }
    if (position.closeReservedBy) {
      return reject(`Position ${input.positionId} already has a close in flight (${position.closeReservedBy}).`);
    }

    // A close is a market order in the opposite direction, targeting THIS position id.
    const orderId = this.nextOrderId();
    const closeSide: Side = position.direction === 'LONG' ? 'SELL' : 'BUY';
    const order: Order = {
      orderId,
      requestId,
      sessionId: this.sessionId,
      symbol: position.symbol,
      side: closeSide,
      type: 'MARKET',
      purpose: 'CLOSE',
      size: position.openSize,
      level: null,
      positionId: position.positionId,
      version: 0,
      state: 'SUBMITTED',
      submittedAt: this.nowMs,
      acceptedAt: null,
      workingAt: null,
      armedAt: null,
      triggeredAt: null,
      terminalAt: null,
      rejectReason: null,
      profileSnapshot: this.profile,
      submittedQuote: this.lastQuoteBySymbol.get(position.symbol.toUpperCase()) ?? null,
    };
    this.ordersById.set(orderId, order);
    position.closeReservedBy = orderId;

    this.emit('COMMAND_SUBMITTED', requestId, orderId, position.positionId, {
      purpose: 'CLOSE',
      targetPositionId: position.positionId,
      note: 'Closes target the POSITION id, never an order id.',
    });

    this.scheduler.schedule(this.nowMs + this.profile.travelMs.value, {
      kind: 'CLOSE_POSITION_REQUEST',
      requestId,
      positionId: position.positionId,
      orderId,
    });
    return { requestId, accepted: true, orderId, clientError: null };
  }

  private dispatchCancel(requestId: RequestId, input: CancelOrderInput): CommandOutcome {
    const reject = (clientError: string): CommandOutcome => {
      this.emit('REJECTED', requestId, input.orderId, null, { stage: 'CLIENT', reason: clientError });
      return { requestId, accepted: false, orderId: null, clientError };
    };

    const order = this.ordersById.get(input.orderId);
    if (!order) return reject(`No order with id ${input.orderId}.`);
    if (order.state !== 'ACCEPTED' && order.state !== 'WORKING') {
      return reject(`Order ${input.orderId} is ${order.state} and can no longer be cancelled.`);
    }

    this.emit('COMMAND_SUBMITTED', requestId, input.orderId, null, { purpose: 'CANCEL' });
    this.scheduler.schedule(this.nowMs + this.profile.travelMs.value, {
      kind: 'COMMAND_ARRIVAL',
      requestId,
      orderId: input.orderId,
    });
    // Cancellation intent is recorded so `runUntilIdle` can act on it at arrival time.
    this.pendingCancels.set(input.orderId, requestId);
    return { requestId, accepted: true, orderId: input.orderId, clientError: null };
  }

  private pendingCancels = new Map<OrderId, RequestId>();

  private dispatchAmend(requestId: RequestId, input: AmendOrderInput): CommandOutcome {
    const reject = (clientError: string): CommandOutcome => {
      this.emit('REJECTED', requestId, input.orderId, null, { stage: 'CLIENT', reason: clientError });
      return { requestId, accepted: false, orderId: null, clientError };
    };

    const order = this.ordersById.get(input.orderId);
    if (!order) return reject(`No order with id ${input.orderId}.`);
    if (order.state !== 'ACCEPTED' && order.state !== 'WORKING') {
      return reject(`Order ${input.orderId} is ${order.state} and can no longer be amended.`);
    }
    if (input.version !== order.version) {
      // Stale instruction: an amendment that lost a race must not overwrite a newer state.
      return reject(
        `Amendment is stale: instruction targets version ${input.version} but order is at version ${order.version}.`,
      );
    }
    const tick = this.tickRulesBySymbol.get(order.symbol.toUpperCase())!;
    try {
      priceToTicks(input.level, tick);
    } catch (err) {
      return reject(err instanceof Error ? err.message : 'Invalid level');
    }
    const quote = this.lastQuoteBySymbol.get(order.symbol.toUpperCase());
    if (quote && (order.type === 'STOP' || order.type === 'LIMIT')) {
      const verdict = validatePlacement(order.type, order.side, input.level, quote);
      if (!verdict.ok) return reject(verdict.reason);
    }

    this.emit('COMMAND_SUBMITTED', requestId, input.orderId, null, { purpose: 'AMEND', level: input.level });
    this.scheduler.schedule(this.nowMs + this.profile.travelMs.value, {
      kind: 'COMMAND_ARRIVAL',
      requestId,
      orderId: input.orderId,
    });
    this.pendingAmends.set(input.orderId, { requestId, level: input.level, version: input.version });
    return { requestId, accepted: true, orderId: input.orderId, clientError: null };
  }

  private pendingAmends = new Map<OrderId, { requestId: RequestId; level: number; version: number }>();

  // -- main loop -----------------------------------------------------------

  /**
   * Run until no scheduled action remains. `now` only moves to the timestamp of the action being
   * dispatched, so the engine cannot observe time passing on its own.
   */
  runUntilIdle(): void {
    this.runUntil(Number.POSITIVE_INFINITY);
  }

  /**
   * Dispatch every scheduled action whose fire time is at or before `targetMs`, then leave `now`
   * at `targetMs`. This is how a caller interleaves market data with instruction latency without
   * ever letting the engine read a wall clock.
   */
  runUntil(targetMs: ReplayMs): void {
    let iterations = 0;
    for (;;) {
      // Peek before popping: an action beyond the target must stay queued, not be discarded.
      const pending = this.scheduler.peek();
      if (!pending || pending.fireAtMs > targetMs) break;

      const next = this.scheduler.next();
      if (!next) break;

      if (++iterations > this.maxIterations) {
        throw new Error(
          `runUntil exceeded ${this.maxIterations} iterations in a single call. This indicates a scheduling loop bug.`,
        );
      }

      this.nowMs = Math.max(this.nowMs, next.fireAtMs);
      this.handleAction(next.payload);
    }
    if (Number.isFinite(targetMs)) {
      this.nowMs = Math.max(this.nowMs, targetMs);
    }
  }

  private handleAction(action: ScheduledAction): void {
    switch (action.kind) {
      case 'COMMAND_ARRIVAL':
        this.onCommandArrival(action.requestId, action.orderId);
        return;
      case 'ACCEPT_ORDER':
        this.onAcceptOrder(action.orderId);
        return;
      case 'ELIGIBLE':
        this.onEligible(action.orderId);
        return;
      case 'NOTIFY_FILL':
        this.onNotifyFill(action.orderId, action.fillId);
        return;
      case 'NOTIFY_ORDER':
        this.onNotifyOrder(action.orderId, action.state);
        return;
      case 'CLOSE_POSITION_REQUEST':
        this.onCloseArrival(action.requestId, action.positionId, action.orderId);
        return;
      default:
        throw new Error(`Unknown scheduled action ${JSON.stringify(action)}`);
    }
  }

  private onCommandArrival(requestId: RequestId, orderId: OrderId): void {
    const cancelRequest = this.pendingCancels.get(orderId);
    if (cancelRequest !== undefined && cancelRequest === requestId) {
      this.pendingCancels.delete(orderId);
      this.applyCancel(orderId, requestId);
      return;
    }

    const amend = this.pendingAmends.get(orderId);
    if (amend && amend.requestId === requestId) {
      this.pendingAmends.delete(orderId);
      this.applyAmend(orderId, amend.level, amend.version, requestId);
      return;
    }

    const order = this.ordersById.get(orderId);
    if (!order) return;
    if (order.state !== 'SUBMITTED') return; // already resolved (e.g. cancelled in flight)

    this.emit('COMMAND_ARRIVED', requestId, orderId, null, { symbol: order.symbol, type: order.type });
    const acceptance = this.profile.acceptanceMs.value;
    this.scheduler.schedule(this.nowMs + acceptance, { kind: 'ACCEPT_ORDER', requestId, orderId });
  }

  private applyCancel(orderId: OrderId, requestId: RequestId): void {
    const order = this.ordersById.get(orderId);
    if (!order) return;
    if (order.state !== 'ACCEPTED' && order.state !== 'WORKING') {
      this.emit('REJECTED', requestId, orderId, null, {
        stage: 'BROKER',
        reason: `Cancel arrived after the order became ${order.state}.`,
      });
      return;
    }
    order.state = 'CANCELLED';
    order.terminalAt = this.nowMs;
    this.releaseAttachments(order);
    this.emit('CANCELLED', requestId, orderId, order.positionId, { cause: 'CLIENT_CANCEL' });
    this.scheduler.schedule(this.nowMs + this.profile.notificationMs.value, {
      kind: 'NOTIFY_ORDER',
      orderId,
      state: 'CANCELLED',
    });
  }

  private applyAmend(orderId: OrderId, level: number, version: number, requestId: RequestId): void {
    const order = this.ordersById.get(orderId);
    if (!order) return;
    if (order.state !== 'ACCEPTED' && order.state !== 'WORKING') {
      this.emit('REJECTED', requestId, orderId, null, {
        stage: 'BROKER',
        reason: `Amendment arrived after the order became ${order.state}.`,
      });
      return;
    }
    if (version !== order.version) {
      this.emit('REJECTED', requestId, orderId, null, {
        stage: 'BROKER',
        reason: `Amendment lost a race: order advanced from version ${version} to ${order.version}.`,
      });
      return;
    }

    const previous = order.level;
    (order as { level: number | null }).level = level;
    (order as { version: number }).version = order.version + 1;

    // The trigger is re-armed only because the level genuinely changed: the new level has not yet
    // triggered, so its condition must be evaluated from this moment. The order stays WORKING —
    // it is resting again against the new level, not executing.
    order.triggeredAt = null;
    order.armedAt = this.nowMs;
    order.state = 'WORKING';

    this.emit('INSTRUCTION_AMENDED', requestId, orderId, order.positionId, { previousLevel: previous, level });
    this.scheduler.schedule(this.nowMs + this.profile.notificationMs.value, {
      kind: 'NOTIFY_ORDER',
      orderId,
      state: 'WORKING',
    });
  }

  private onAcceptOrder(orderId: OrderId): void {
    const order = this.ordersById.get(orderId);
    if (!order || order.state !== 'SUBMITTED') return;

    const rules = this.rulesFor(order.symbol);
    const quote = this.lastQuoteBySymbol.get(order.symbol.toUpperCase()) ?? null;
    if (!quote) {
      order.state = 'REJECTED';
      order.terminalAt = this.nowMs;
      order.rejectReason = 'NO_VALID_QUOTE';
      this.emit('REJECTED', order.requestId, orderId, null, {
        stage: 'BROKER',
        reason: 'No quote has been observed for this instrument.',
      });
      return;
    }

    const age = this.nowMs - quote.replayMs;
    if (age > this.profile.maxQuoteAgeMs.value) {
      order.state = 'REJECTED';
      order.terminalAt = this.nowMs;
      order.rejectReason = 'STALE_QUOTE';
      this.emit('REJECTED', order.requestId, orderId, null, {
        stage: 'BROKER',
        reason: `Quote is ${Math.round(age)} ms old, beyond the ${this.profile.maxQuoteAgeMs.value} ms freshness limit.`,
      });
      return;
    }

    // Re-validate tick and placement at the broker, against the quote it can actually see. A client
    // that validated against an older quote can be wrong by the time the instruction arrives.
    if (order.level !== null) {
      const tick = this.tickRulesBySymbol.get(order.symbol.toUpperCase())!;
      try {
        priceToTicks(order.level, tick);
      } catch (err) {
        order.state = 'REJECTED';
        order.terminalAt = this.nowMs;
        order.rejectReason = 'INVALID_TICK';
        this.emit('REJECTED', order.requestId, orderId, null, {
          stage: 'BROKER',
          reason: err instanceof Error ? err.message : 'Invalid tick',
        });
        return;
      }
      if (order.type === 'STOP' || order.type === 'LIMIT') {
        const verdict = validatePlacement(order.type, order.side, order.level, quote);
        if (!verdict.ok) {
          order.state = 'REJECTED';
          order.terminalAt = this.nowMs;
          order.rejectReason = 'INVALID_PLACEMENT';
          this.emit('REJECTED', order.requestId, orderId, null, { stage: 'BROKER', reason: verdict.reason });
          return;
        }
      }
    }

    order.acceptedAt = this.nowMs;
    order.state = 'WORKING';
    order.workingAt = this.nowMs;
    order.armedAt = null;
    this.emit('ACCEPTED', order.requestId, orderId, null, {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      level: order.level,
      size: order.size,
    });

    // Acknowledgement reaches the client after the ack envelope, measured from submission.
    const ackAt = Math.max(this.nowMs, order.submittedAt + this.profile.acknowledgementMs.value);
    this.scheduler.schedule(ackAt, { kind: 'NOTIFY_ORDER', orderId, state: 'WORKING' });

    // Execution eligibility: acceptance plus dispatch delay.
    const eligibleAt = this.nowMs + this.profile.dispatchMs.value;
    this.scheduler.schedule(eligibleAt, { kind: 'ELIGIBLE', orderId });
    void rules;
  }

  /**
   * The dispatch delay has elapsed: the order is now eligible to execute against the market.
   *
   * BUGFIX: this used to move the order into EXECUTING, which both hid its true state (a resting
   * order is WORKING, not executing) and blocked cancel/amend, which only accepted ACCEPTED or
   * WORKING. Eligibility is now separate bookkeeping and the public state stays truthful.
   */
  private onEligible(orderId: OrderId): void {
    const order = this.ordersById.get(orderId);
    if (!order || order.state !== 'WORKING') return;
    if (order.armedAt !== null) return;
    order.armedAt = this.nowMs;
    this.emit('ELIGIBLE', order.requestId, orderId, order.positionId, { symbol: order.symbol, type: order.type });
    this.tryTrigger(order);
  }

  /**
   * Evaluate an eligible resting order against the latest quote. The single place an order
   * progresses from WORKING to a terminal state.
   */
  private tryTrigger(order: Order): void {
    if (order.state !== 'WORKING') return;
    const quote = this.lastQuoteBySymbol.get(order.symbol.toUpperCase());
    if (!quote) {
      order.state = 'WORKING';
      this.emit('WAITING_FOR_QUOTE', order.requestId, order.orderId, null, { reason: 'NO_QUOTE' });
      return;
    }

    const age = this.nowMs - quote.replayMs;
    if (age > this.profile.maxQuoteAgeMs.value) {
      order.state = 'WORKING';
      this.emit('WAITING_FOR_QUOTE', order.requestId, order.orderId, null, {
        reason: 'STALE_QUOTE',
        ageMs: age,
        limitMs: this.profile.maxQuoteAgeMs.value,
      });
      return;
    }

    if (order.type === 'MARKET') {
      this.fillOrder(order, quote);
      return;
    }

    // The trigger condition LATCHES: once an order has triggered, this branch is never re-entered
    // for that order, so a level that later becomes satisfiable cannot re-fire it.
    if (order.triggeredAt !== null) return;

    const met = triggerConditionMet(order.type as 'STOP' | 'LIMIT', order.side, order.level!, quote);
    if (!met) return;

    order.triggeredAt = this.nowMs;
    order.state = 'TRIGGERED';
    this.emit('TRIGGERED', order.requestId, order.orderId, order.positionId, {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      level: order.level,
      quote: { bid: quote.bid, ask: quote.ask },
      rule: `${order.type} ${order.side}: condition met and latched`,
    });

    // The trigger condition is now inert. The fill still needs an execution instruction, which
    // arrives after the dispatch delay; if the market moves away in the meantime the order waits
    // rather than silently filling at a price that no longer exists.
    this.fillOrder(order, quote);
  }

  private fillOrder(order: Order, quote: Quote): void {
    if (order.terminalAt !== null) return;

    const tick = this.tickRulesBySymbol.get(order.symbol.toUpperCase())!;
    const fillPrice = order.side === 'BUY' ? quote.ask : quote.bid;

    // BUGFIX: every non-entry order (CLOSE, STOP_LOSS, TAKE_PROFIT) belongs to an existing
    // position. Previously only CLOSE looked the position up, so a stop-loss fill never applied to
    // its position, never realized PnL, and minted a phantom position id instead.
    const isEntry = order.purpose === 'ENTRY';
    const position = isEntry ? undefined : order.positionId ? this.positionsById.get(order.positionId) : undefined;
    if (!isEntry && !position) {
      // The position vanished (already closed by a sibling). The instruction is inert, not fatal.
      order.state = 'CANCELLED';
      order.terminalAt = this.nowMs;
      this.emit('CANCELLED', order.requestId, order.orderId, order.positionId, {
        cause: 'TARGET_POSITION_ALREADY_CLOSED',
      });
      return;
    }
    const realized = position ? this.realizedOn(position, fillPrice, order.size) : null;

    // Entry orders mint a position id at the moment of the fill; exits reuse the position they close.
    const positionId = (isEntry ? this.nextPositionId() : position!.positionId) as PositionId;

    const fill: Fill = {
      fillId: `F-${this.fillSeq.next()}` as FillId,
      orderId: order.orderId,
      positionId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.size,
      price: fillPrice,
      replayMs: this.nowMs,
      quoteSeq: quote.seq,
      priceChangeFromSubmit: order.submittedQuote
        ? roundToDecimals(
            (order.side === 'BUY'
              ? fillPrice - order.submittedQuote.ask
              : order.submittedQuote.bid - fillPrice) / tick.tickSize,
            4,
          )
        : null,
      stopToFillDifference:
        order.triggeredAt !== null && order.level !== null
          ? roundToDecimals((order.side === 'BUY' ? fillPrice - order.level : order.level - fillPrice) / tick.tickSize, 4)
          : null,
    };

    order.state = 'FILLED';
    order.terminalAt = this.nowMs;
    this.fills.push(fill);

    this.emit('FILLED', order.requestId, order.orderId, fill.positionId, {
      price: fillPrice,
      size: order.size,
      quote: { bid: quote.bid, ask: quote.ask, seq: quote.seq },
      quoteAgeMs: this.nowMs - quote.replayMs,
      priceChangeFromSubmitInTicks: fill.priceChangeFromSubmit,
      stopToFillDifferenceInTicks: fill.stopToFillDifference,
    });

    // Notification: the economics happened at `nowMs`; the client learns later.
    this.scheduler.schedule(this.nowMs + this.profile.notificationMs.value, {
      kind: 'NOTIFY_FILL',
      orderId: order.orderId,
      fillId: fill.fillId,
    });

    // Position effect. The world state changes at the economic time, not at notification time.
    if (isEntry) {
      this.openPosition(order, fill);
    } else if (order.purpose === 'CLOSE') {
      this.applyClose(position!, order, fillPrice, realized!);
    } else {
      this.applyExit(position!, order, fillPrice, realized!);
    }
  }

  private realizedOn(position: Position, exitPrice: number, size: number): number {
    const rules = this.rulesFor(position.symbol);
    const directionSign = position.direction === 'LONG' ? 1 : -1;
    return roundToDecimals(
      directionSign * (exitPrice - position.entryPrice) * size * rules.contractMultiplier,
      rules.priceDecimals + 2,
    );
  }

  private openPosition(order: Order, fill: Fill): void {
    const positionId = fill.positionId;
    const position: Position = {
      positionId,
      symbol: order.symbol,
      direction: order.side === 'BUY' ? 'LONG' : 'SHORT',
      size: order.size,
      entryPrice: fill.price,
      entryReplayMs: this.nowMs,
      entryFillId: fill.fillId,
      openSize: order.size,
      realizedPnl: 0,
      state: 'OPEN',
      slOrderId: null,
      tpOrderId: null,
      closeReservedBy: null,
    };
    this.positionsById.set(positionId, position);
    (order as { positionId: PositionId | null }).positionId = positionId;

    this.emit('POSITION_OPENED', order.requestId, order.orderId, positionId, {
      direction: position.direction,
      entryPrice: position.entryPrice,
      size: position.size,
    });

    const attachments = (order as Order & { attachments?: { stopLoss?: number; takeProfit?: number } }).attachments;
    if (attachments?.stopLoss !== undefined) {
      this.attachExit(order, position, 'STOP', attachments.stopLoss);
    }
    if (attachments?.takeProfit !== undefined) {
      this.attachExit(order, position, 'LIMIT', attachments.takeProfit);
    }
  }

  /**
   * Attach a stop-loss or take-profit. The exit side is always OPPOSITE the position, and the
   * trigger kind is chosen from the attachment's meaning — not inherited from the entry order.
   */
  private attachExit(entryOrder: Order, position: Position, kind: 'STOP' | 'LIMIT', level: number): void {
    const tick = this.tickRulesBySymbol.get(position.symbol.toUpperCase())!;
    try {
      priceToTicks(level, tick);
    } catch (err) {
      this.emit('REJECTED', entryOrder.requestId, entryOrder.orderId, position.positionId, {
        stage: 'ATTACHMENT',
        reason: err instanceof Error ? err.message : 'Invalid attachment level',
        kind,
        level,
      });
      return;
    }

    const exitSide: Side = position.direction === 'LONG' ? 'SELL' : 'BUY';
    const quote = this.lastQuoteBySymbol.get(position.symbol.toUpperCase()) ?? null;
    if (quote) {
      const verdict = validatePlacement(kind, exitSide, level, quote);
      if (!verdict.ok) {
        this.emit('REJECTED', entryOrder.requestId, entryOrder.orderId, position.positionId, {
          stage: 'ATTACHMENT',
          reason: verdict.reason,
          kind,
          level,
        });
        return;
      }
    }

    const orderId = this.nextOrderId();
    const purpose: OrderPurpose = kind === 'STOP' ? 'STOP_LOSS' : 'TAKE_PROFIT';
    const exitOrder: Order = {
      orderId,
      requestId: entryOrder.requestId,
      sessionId: this.sessionId,
      symbol: position.symbol,
      side: exitSide,
      type: kind,
      purpose,
      size: position.size,
      level,
      positionId: position.positionId,
      version: 0,
      state: 'WORKING',
      submittedAt: this.nowMs,
      acceptedAt: this.nowMs,
      workingAt: this.nowMs,
      armedAt: null, // armed when the dispatch delay elapses
      triggeredAt: null,
      terminalAt: null,
      rejectReason: null,
      profileSnapshot: entryOrder.profileSnapshot,
      submittedQuote: quote ? { ...quote } : null,
    };
    this.ordersById.set(orderId, exitOrder);
    if (kind === 'STOP') position.slOrderId = orderId;
    else position.tpOrderId = orderId;

    this.emit('WORKING', entryOrder.requestId, orderId, position.positionId, {
      purpose,
      side: exitSide,
      level,
      rule: `${kind} ${exitSide} exit attached to a ${position.direction} position`,
    });

    // An exit attached while the market already satisfies it must fire on the next evaluation.
    this.scheduler.schedule(this.nowMs + this.profile.dispatchMs.value, { kind: 'ELIGIBLE', orderId });
  }

  private releaseAttachments(order: Order): void {
    if (!order.positionId) return;
    const position = this.positionsById.get(order.positionId);
    if (!position) return;
    if (position.slOrderId === order.orderId) position.slOrderId = null;
    if (position.tpOrderId === order.orderId) position.tpOrderId = null;
  }

  /**
   * An attached stop-loss or take-profit fired. Economically this closes (part of) the position,
   * and the OTHER exit instruction is cancelled because its condition is no longer meaningful.
   */
  private applyExit(position: Position, order: Order, fillPrice: number, realized: number): void {
    const previous = position.realizedPnl;
    position.realizedPnl = roundToDecimals(position.realizedPnl + realized, 6);
    position.openSize = roundToDecimals(position.openSize - order.size, 8);
    position.state = position.openSize <= 0 ? 'CLOSED' : 'OPEN';

    const other = order.purpose === 'STOP_LOSS' ? position.tpOrderId : position.slOrderId;
    if (order.purpose === 'STOP_LOSS') position.slOrderId = null;
    else position.tpOrderId = null;

    this.emit('POSITION_CLOSED', order.requestId, order.orderId, position.positionId, {
      closedBy: order.purpose,
      closedSize: order.size,
      exitPrice: fillPrice,
      realizedOnThisClose: realized,
      realizedTotal: position.realizedPnl,
      realizedDelta: roundToDecimals(position.realizedPnl - previous, 6),
      remainingOpenSize: position.openSize,
    });

    if (other) {
      const otherOrder = this.ordersById.get(other);
      if (otherOrder && (otherOrder.state === 'WORKING' || otherOrder.state === 'ACCEPTED')) {
        otherOrder.state = 'CANCELLED';
        otherOrder.terminalAt = this.nowMs;
        this.emit('CANCELLED', otherOrder.requestId, otherOrder.orderId, position.positionId, {
          cause: 'SIBLING_EXIT_FILLED',
          note: 'One of the two attached exits filled, so the other is no longer meaningful.',
        });
      }
      if (order.purpose === 'STOP_LOSS') position.tpOrderId = null;
      else position.slOrderId = null;
    }

    if (position.state === 'CLOSED') {
      position.slOrderId = null;
      position.tpOrderId = null;
    }
  }

  private applyClose(position: Position, order: Order, fillPrice: number, realized: number): void {
    const previous = position.realizedPnl;
    position.realizedPnl = roundToDecimals(position.realizedPnl + realized, 6);
    position.openSize = roundToDecimals(position.openSize - order.size, 8);
    position.state = position.openSize <= 0 ? 'CLOSED' : 'OPEN';
    position.closeReservedBy = null;

    this.emit(position.state === 'CLOSED' ? 'POSITION_CLOSED' : 'POSITION_OPENED', order.requestId, order.orderId, position.positionId, {
      closedSize: order.size,
      exitPrice: fillPrice,
      realizedOnThisClose: realized,
      realizedTotal: position.realizedPnl,
      realizedDelta: roundToDecimals(position.realizedPnl - previous, 6),
    });

    // Exit instructions on a now-flat position must not remain live.
    if (position.state === 'CLOSED') {
      this.cancelExitFor(position, 'POSITION_CLOSED');
    }
  }

  private cancelExitFor(position: Position, cause: string): void {
    for (const id of [position.slOrderId, position.tpOrderId]) {
      if (!id) continue;
      const exit = this.ordersById.get(id);
      if (!exit) continue;
      if (exit.state === 'WORKING' || exit.state === 'ACCEPTED') {
        exit.state = 'CANCELLED';
        exit.terminalAt = this.nowMs;
        this.emit('CANCELLED', exit.requestId, exit.orderId, position.positionId, {
          cause,
          note: 'The other exit instruction is cancelled once one of them fills.',
        });
      }
    }
    position.slOrderId = null;
    position.tpOrderId = null;
  }

  private onCloseArrival(requestId: RequestId, positionId: PositionId, orderId: OrderId): void {
    const order = this.ordersById.get(orderId);
    const position = this.positionsById.get(positionId);
    if (!order) return;

    if (!position || position.state !== 'OPEN') {
      order.state = 'REJECTED';
      order.terminalAt = this.nowMs;
      order.rejectReason = 'MISSING_TARGET';
      if (position) position.closeReservedBy = null;
      this.emit('REJECTED', requestId, orderId, positionId, {
        stage: 'BROKER',
        reason: `Position ${positionId} is ${position ? position.state : 'missing'} and cannot be closed.`,
      });
      return;
    }

    this.emit('COMMAND_ARRIVED', requestId, orderId, positionId, { purpose: 'CLOSE' });
    this.scheduler.schedule(this.nowMs + this.profile.acceptanceMs.value, { kind: 'ACCEPT_ORDER', requestId, orderId });
  }

  private onNotifyFill(orderId: OrderId, fillId: FillId): void {
    const order = this.ordersById.get(orderId);
    const fill = this.fills.find((f) => f.fillId === fillId);
    this.emit(order?.purpose === 'CLOSE' ? 'NOTICE_DELIVERED' : 'NOTICE_DELIVERED', order?.requestId ?? null, orderId, null, {
      notice: 'FILL_NOTIFICATION',
      fillId,
      price: fill?.price ?? null,
      economicsAtMs: fill?.replayMs ?? null,
      deliveredAtMs: this.nowMs,
      // The gap between these two is the notification delay, and it is deliberately visible.
      notificationDelayMs: fill ? roundToDecimals(this.nowMs - fill.replayMs, 3) : null,
    });
  }

  private onNotifyOrder(orderId: OrderId, state: OrderState): void {
    const order = this.ordersById.get(orderId);
    this.emit('NOTICE_DELIVERED', order?.requestId ?? null, orderId, null, {
      notice: 'ORDER_UPDATE',
      state,
      deliveredAtMs: this.nowMs,
    });
  }

  // -- views ---------------------------------------------------------------

  private emit(
    kind: EngineEventKind,
    requestId: RequestId | null,
    orderId: OrderId | null,
    positionId: PositionId | null,
    detail: Record<string, unknown>,
  ): void {
    const order = orderId ? this.ordersById.get(orderId) : undefined;
    this.events.push({
      seq: this.eventSeq.next(),
      replayMs: this.nowMs,
      kind,
      requestId,
      orderId,
      positionId,
      brokerMs: order?.acceptedAt ?? null,
      clientKnownMs: null,
      detail,
    });
  }

  /** Full account state at the current replay time. */
  view(): AccountState {
    const positions = Array.from(this.positionsById.values());
    let unrealized = 0;
    for (const p of positions) {
      if (p.state !== 'OPEN' || p.openSize <= 0) continue;
      const quote = this.lastQuoteBySymbol.get(p.symbol.toUpperCase());
      if (!quote) continue;
      const closePrice = p.direction === 'LONG' ? quote.bid : quote.ask;
      unrealized += this.realizedOn({ ...p, entryPrice: p.entryPrice }, closePrice, p.openSize);
    }

    return {
      sessionId: this.sessionId,
      nowMs: this.nowMs,
      orders: Array.from(this.ordersById.values()),
      positions,
      fills: [...this.fills],
      realizedPnl: roundToDecimals(
        positions.reduce((sum, p) => sum + p.realizedPnl, 0),
        6,
      ),
      unrealizedPnl: roundToDecimals(unrealized, 6),
      events: [...this.events],
    };
  }

  /** Events in scheduling order, for inspection and the accounting identity test. */
  eventLog(): readonly EngineEvent[] {
    return this.events;
  }

  /** Current open positions, keyed by POSITION id. */
  openPositions(): Position[] {
    return Array.from(this.positionsById.values()).filter((p) => p.state === 'OPEN' && p.openSize > 0);
  }
}
