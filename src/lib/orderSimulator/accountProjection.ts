import type {
  AccountState,
  Fill,
  Order,
  OrderId,
  Position,
  PositionId,
  ReplayMs,
} from './types';

/**
 * Projections from the one shared account onto a chart.
 *
 * Everything here is **pure and idempotent**. A projection is a *read*: calling it once, twice, or
 * from five charts on the same symbol must not change the account, and must return the same answer.
 * That is the mechanical guarantee behind SIM-ACCOUNT-01 (nothing outside the engine mutates
 * economics) and SIM-ACCOUNT-02 (PnL is counted once per account entity, not once per chart).
 *
 * Every projected object is bound by IDENTITY — the engine's own order / position / fill id — plus
 * the symbol it belongs to. Which chart happens to render it, and whether that chart is detached,
 * remounted or switched to another symbol, cannot affect what the object says.
 */

// ---------------------------------------------------------------------------
// Per-symbol view
// ---------------------------------------------------------------------------

export interface SymbolProjection {
  readonly symbol: string;
  readonly positions: readonly Position[];
  readonly openPositions: readonly Position[];
  readonly workingOrders: readonly Order[];
  readonly fills: readonly Fill[];
  /** True when this symbol carries live exposure, whatever any chart is displaying. */
  readonly hasExposure: boolean;
}

export function projectForSymbol(state: AccountState, symbol: string): SymbolProjection {
  const wanted = symbol.toUpperCase();
  const onSymbol = <T extends { symbol: string }>(items: readonly T[]): T[] =>
    items.filter((item) => item.symbol.toUpperCase() === wanted);

  const positions = onSymbol(state.positions);
  const workingOrders = onSymbol(state.orders).filter(
    (o) => o.state === 'WORKING' || o.state === 'ACCEPTED' || o.state === 'SUBMITTED' || o.state === 'TRIGGERED',
  );
  const fills = onSymbol(state.fills);

  return {
    symbol: wanted,
    positions,
    openPositions: positions.filter((p) => p.state === 'OPEN' && p.openSize > 0),
    workingOrders,
    fills,
    hasExposure: positions.some((p) => p.state === 'OPEN' && p.openSize > 0) || workingOrders.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Account totals — counted ONCE per account entity
// ---------------------------------------------------------------------------

export interface AccountTotals {
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly totalPnl: number;
  /** The position ids that contributed, so a double count would be visible rather than silent. */
  readonly countedPositionIds: readonly PositionId[];
  readonly openPositionCount: number;
  readonly openOrderCount: number;
}

/**
 * Account totals derived from the account's own entities.
 *
 * Each position contributes exactly once, keyed by its `positionId`. There is no per-chart
 * accumulator anywhere: a chart renders these numbers, it never adds to them. Two charts on the
 * same symbol therefore show the same total instead of one each.
 */
export function projectAccountTotals(state: AccountState): AccountTotals {
  const seen = new Set<PositionId>();
  let realized = 0;

  for (const position of state.positions) {
    // Identity, not symbol: a duplicated projection cannot walk the same position twice.
    if (seen.has(position.positionId)) continue;
    seen.add(position.positionId);
    realized += position.realizedPnl;
  }

  const unrealized = state.unrealizedPnl;
  return {
    realizedPnl: round6(realized),
    unrealizedPnl: round6(unrealized),
    totalPnl: round6(realized + unrealized),
    countedPositionIds: [...seen],
    openPositionCount: state.positions.filter((p) => p.state === 'OPEN' && p.openSize > 0).length,
    openOrderCount: state.orders.filter(
      (o) => o.state === 'WORKING' || o.state === 'ACCEPTED' || o.state === 'SUBMITTED' || o.state === 'TRIGGERED',
    ).length,
  };
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Protective group
// ---------------------------------------------------------------------------

export interface ClosingGroup {
  readonly positionId: PositionId;
  /** The size the group may close. Exactly one position size — never one per member. */
  readonly claimSize: number;
  readonly members: readonly Order[];
  readonly stopLoss: Order | null;
  readonly takeProfit: Order | null;
  /**
   * The id of the instruction that owns the close, if one does. Set by a latched exit or by an
   * accepted manual close, and the reason a competing close is refused.
   */
  readonly reservedBy: OrderId | null;
  /**
   * Sum of every member's size. This is EXPECTED to be up to two position sizes: each member closes
   * the whole position, and whichever activates first wins. It is not a double-close risk on its
   * own — the risk would be two members able to act simultaneously, which `sound` rules out.
   */
  readonly memberSizeTotal: number;
  /** The largest single member's size. This one must never exceed the position's size. */
  readonly maxMemberSize: number;
  /** Whether the group obeys the one-claim invariant. See `protectiveGroupIsSound`. */
  readonly sound: boolean;
}

/**
 * The closing group for a position: its stop-loss and take-profit as one claim on the position's
 * size, plus whatever currently owns that claim.
 *
 * `liveClaimSize` is the number the requirement is really about. If two members each claimed the
 * full size, they could close it twice; the invariant is that the live claim never exceeds one
 * position size, and it is asserted in the tests rather than assumed.
 */
export function closingGroupFor(state: AccountState, position: Position): ClosingGroup {
  const members = state.orders.filter(
    (o) => o.positionId === position.positionId && (o.purpose === 'STOP_LOSS' || o.purpose === 'TAKE_PROFIT'),
  );
  const live = members.filter((o) => o.state === 'WORKING' || o.state === 'ACCEPTED');
  const liveClaimSize = live.reduce((sum, o) => sum + o.size, 0);

  return {
    positionId: position.positionId,
    claimSize: position.size,
    members,
    stopLoss: members.find((o) => o.purpose === 'STOP_LOSS') ?? null,
    takeProfit: members.find((o) => o.purpose === 'TAKE_PROFIT') ?? null,
    reservedBy: position.closeReservedBy,
    memberSizeTotal: round6(liveClaimSize),
    maxMemberSize: members.reduce((max, o) => Math.max(max, o.size), 0),
    sound: evaluateSoundness(members, position.size, position.closeReservedBy),
  };
}

const LIVE_STATES = new Set(['WORKING', 'ACCEPTED', 'TRIGGERED']);

/**
 * The one-claim invariant for a protective group.
 *
 * The group is sound when:
 *  1. no member claims more than the position's size — a member closes the position, never more;
 *  2. at most one member has latched, because a latch is what takes ownership of the claim; and
 *  3. once the claim is reserved, no member OTHER than the reservation holder can still act.
 *
 * Note what is deliberately NOT required: the members' sizes summing to one position size. Each
 * member closes the whole position and whichever fires first invalidates the rest, so a sum of two
 * position sizes is the expected shape and not a defect.
 */
export function protectiveGroupIsSound(state: AccountState, position: Position): boolean {
  return closingGroupFor(state, position).sound;
}

/** The invariant itself, as a pure function of the group's parts. */
function evaluateSoundness(
  members: readonly Order[],
  claimSize: number,
  reservedBy: OrderId | null,
): boolean {
  if (members.length === 0) return true;

  // 1. No member may claim more than the position's size.
  if (members.some((o) => o.size > claimSize + 1e-9)) return false;

  // 2. At most one member may have latched: a latch is what takes ownership of the claim.
  if (members.filter((o) => o.triggeredAt !== null).length > 1) return false;

  // 3. Once reserved, no member other than the holder may still be able to act.
  if (reservedBy !== null) {
    const actionable = members.filter((o) => LIVE_STATES.has(o.state) && o.orderId !== reservedBy);
    if (actionable.length > 0) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Chart markers, bound by identity
// ---------------------------------------------------------------------------

export type MarkerKind = 'POSITION' | 'WORKING_ORDER' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'FILL';

export interface ChartMarkerDescriptor {
  /** Stable identity. Two projections of unchanged state produce equal keys. */
  readonly key: string;
  readonly kind: MarkerKind;
  readonly id: OrderId | PositionId | string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL' | null;
  readonly price: number;
  readonly size: number;
  readonly replayMs: ReplayMs;
  readonly state: string;
  /** True while this member owns the position's close. */
  readonly reserved: boolean;
}

/**
 * Project the account's surviving facts about a symbol into marker descriptors.
 *
 * Deterministic and total: the same account state always yields the same list, so a chart can
 * rebuild its primitives from scratch on every remount and get the same picture. Markers carry the
 * engine's own ids, which is why a detach or remount is a view change and nothing more.
 */
export function projectMarkers(state: AccountState, symbol: string): ChartMarkerDescriptor[] {
  const view = projectForSymbol(state, symbol);
  const markers: ChartMarkerDescriptor[] = [];

  // Who owns each position's close, so a member can be drawn as "holding the claim".
  const reservedByPosition = new Map<PositionId, OrderId | null>();
  for (const position of view.positions) reservedByPosition.set(position.positionId, position.closeReservedBy);

  for (const position of view.positions) {
    markers.push({
      key: `position:${position.positionId}`,
      kind: 'POSITION',
      id: position.positionId,
      symbol: position.symbol,
      side: position.direction === 'LONG' ? 'BUY' : 'SELL',
      price: position.entryPrice,
      size: position.openSize,
      replayMs: position.entryReplayMs,
      state: position.state,
      reserved: position.closeReservedBy !== null,
    });
  }

  for (const order of view.workingOrders) {
    const kind: MarkerKind =
      order.purpose === 'STOP_LOSS' ? 'STOP_LOSS' : order.purpose === 'TAKE_PROFIT' ? 'TAKE_PROFIT' : 'WORKING_ORDER';
    markers.push({
      key: `order:${order.orderId}`,
      kind,
      id: order.orderId,
      symbol: order.symbol,
      side: order.side,
      price: order.level ?? 0,
      size: order.size,
      replayMs: order.workingAt ?? order.submittedAt,
      state: order.state,
      reserved: order.positionId !== null && reservedByPosition.get(order.positionId) === order.orderId,
    });
  }

  for (const fill of view.fills) {
    markers.push({
      key: `fill:${fill.fillId}`,
      kind: 'FILL',
      id: fill.fillId,
      symbol: fill.symbol,
      side: fill.side,
      price: fill.price,
      size: fill.quantity,
      replayMs: fill.replayMs,
      state: 'FILLED',
      reserved: false,
    });
  }

  // Sorted by identity, never by arrival: a rebuilt chart must not depend on iteration order.
  return markers.sort((a, b) => a.replayMs - b.replayMs || a.key.localeCompare(b.key));
}

/**
 * Markers grouped for the badge/primitive layer, which draws a position's protective instructions as
 * one set rather than as unrelated orders.
 *
 * Ordering carries the meaning: a position marker is immediately followed by the members of its
 * closing group, so a consumer can render the group without re-deriving membership.
 */
export function projectGroupedMarkers(state: AccountState, symbol: string): Array<{
  position: ChartMarkerDescriptor | null;
  group: ChartMarkerDescriptor[];
  orphanOrders: ChartMarkerDescriptor[];
}> {
  const view = projectForSymbol(state, symbol);
  const markers = projectMarkers(state, symbol);
  const byKey = new Map(markers.map((m) => [m.key, m]));
  const grouped = new Set<string>();

  const groups = view.positions.map((position) => {
    const group = closingGroupFor(state, position);
    const members = group.members
      .map((member) => byKey.get(`order:${member.orderId}`))
      .filter((m): m is ChartMarkerDescriptor => m !== undefined);
    for (const member of members) grouped.add(member.key);
    const positionMarker = byKey.get(`position:${position.positionId}`) ?? null;
    if (positionMarker) grouped.add(positionMarker.key);
    return { position: positionMarker, group: members, orphanOrders: [] };
  });

  // Entry orders that are not part of any protective group still need to be drawn.
  const orphans = markers.filter((m) => !grouped.has(m.key));
  if (groups.length === 0) return [{ position: null, group: [], orphanOrders: orphans }];

  // Attached to the first group rather than to a new bucket, so the return shape stays uniform and
  // a consumer never has to special-case an account that has orphans but no positions.
  return groups.map((entry, index) => (index === 0 ? { ...entry, orphanOrders: orphans } : entry));
}
