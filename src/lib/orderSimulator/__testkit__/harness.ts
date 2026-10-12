import type { AccountState, EngineEvent, Quote, ReplayMs } from '../types';
import { OrderSimulatorEngine, type EngineOptions } from '../engine';
import { BTCUSD_RULES, trainingProfile, zeroDelayProfile, pilotReferenceProfile } from '../profiles';
import type { LatencyProfile } from '../types';

/**
 * Deterministic test harness for the order simulator.
 *
 * A `Scenario` drives a tape of quotes and commands interleaved by replay time. Nothing here reads
 * a wall clock, and no test may depend on real elapsed time.
 */

export function quote(symbol: string, bid: number, ask: number, replayMs: ReplayMs, seq: number): Quote {
  return { symbol, bid, ask, replayMs, seq };
}

export interface EngineHarness {
  engine: OrderSimulatorEngine;
  /** Quote feed with auto-incrementing seq. */
  push(symbol: string, bid: number, ask: number, replayMs: ReplayMs): Quote;
  /** Advance the engine to a replay time, dispatching due actions and delivering a quote there. */
  at(replayMs: ReplayMs, symbol: string, bid: number, ask: number): Quote;
  view(): AccountState;
  events(): readonly EngineEvent[];
}

export function makeEngine(overrides: Partial<EngineOptions> = {}): OrderSimulatorEngine {
  return new OrderSimulatorEngine({
    sessionId: 'session-test-1',
    instruments: [BTCUSD_RULES],
    profile: trainingProfile(),
    startMs: 0,
    ...overrides,
  });
}

export function makeHarness(overrides: Partial<EngineOptions> = {}): EngineHarness {
  const engine = makeEngine(overrides);
  let seq = 1;
  return {
    engine,
    push(symbol, bid, ask, replayMs) {
      const q = quote(symbol, bid, ask, replayMs, seq++);
      engine.onQuote(q);
      engine.runUntil(replayMs);
      return q;
    },
    at(replayMs, symbol, bid, ask) {
      engine.runUntil(replayMs);
      const q = quote(symbol, bid, ask, replayMs, seq++);
      engine.onQuote(q);
      return q;
    },
    view: () => engine.view(),
    events: () => engine.eventLog(),
  };
}

/**
 * Stable digest of an event log. Used to prove that two runs are identical, and that a run is
 * unaffected by wall-clock skew (the engine never reads a wall clock, so the digest cannot change).
 *
 * FNV-1a over the canonical serialisation of every event. Deliberately simple and dependency-free.
 */
export function digestEvents(events: readonly EngineEvent[]): string {
  const canonical = events.map((e) =>
    [
      e.seq,
      e.kind,
      round(e.replayMs),
      e.requestId ?? '-',
      e.orderId ?? '-',
      e.positionId ?? '-',
      canonicalise(e.detail),
    ].join('|'),
  );
  return fnv1a(canonical.join('\n'));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Key-sorted serialisation, so object key insertion order cannot affect the digest. */
function canonicalise(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${k}:${canonicalise((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** A profile with all delays set to an explicit value, for stage-ordering tests. */
export function fixedProfile(delays: Partial<Record<keyof LatencyProfile, number>> & { id?: string } = {}): LatencyProfile {
  const base = zeroDelayProfile();
  const { id, ...rest } = delays;
  const out = { ...base, id: id ?? 'fixed-test' } as LatencyProfile;
  for (const [key, value] of Object.entries(rest)) {
    (out as unknown as Record<string, unknown>)[key] = {
      value,
      provenance: 'TRAINING_ASSUMPTION',
      note: 'Test profile: value chosen by the test, not observed.',
    };
  }
  return out;
}

export const PROFILES = { trainingProfile, zeroDelayProfile, pilotReferenceProfile };
export { BTCUSD_RULES };
