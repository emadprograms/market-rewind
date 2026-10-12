import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PILOT_REFERENCE_ENVELOPES_MS,
  pilotReferenceProfile,
  trainingProfile,
  zeroDelayProfile,
  BTCUSD_RULES,
} from '../../../src/lib/orderSimulator/profiles';
import { makeEngine } from '../../../src/lib/orderSimulator/__testkit__/harness';

/**
 * The pilot fixtures are the audit trail for every number the simulator claims to have observed.
 * These tests make it impossible to quietly promote an assumption into a measured value, and they
 * fail if the fixtures drift away from the data they were derived from.
 */

const REPO = path.resolve(__dirname, '../../..');
const FIXTURE = path.join(REPO, 'tests/fixtures/orderSimulator/capital-demo-pilot.fixtures.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixtures = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as any;

/** Walk a fixture and collect every object that looks like a labelled value. */
function collectLabelled(node: unknown, trail = '$'): Array<{ trail: string; value: unknown; provenance?: string }> {
  const found: Array<{ trail: string; value: unknown; provenance?: string }> = [];
  if (node === null || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((child, i) => found.push(...collectLabelled(child, `${trail}[${i}]`)));
    return found;
  }
  const obj = node as Record<string, unknown>;
  if ('value' in obj) {
    found.push({ trail, value: obj.value, provenance: obj.provenance as string | undefined });
  }
  for (const [key, child] of Object.entries(obj)) {
    found.push(...collectLabelled(child, `${trail}.${key}`));
  }
  return found;
}

describe('pilot fixtures — provenance discipline', () => {
  it('exists and is derived, not hand-written', () => {
    expect(fixtures._provenance).toMatch(/DERIVED from docs\/research\/capital-demo-order-data/);
    expect(fixtures.generated_from).toContain('2026-10-11T11-02-15-686Z');
  });

  it('labels every numeric value object with a provenance', () => {
    const labelled = collectLabelled(fixtures);
    expect(labelled.length).toBeGreaterThan(0);
    const unlabelled = labelled.filter((l) => !l.provenance);
    expect(unlabelled.map((l) => l.trail)).toEqual([]);
  });

  it('never claims more than one sample for a response envelope', () => {
    for (const [, envelope] of Object.entries(fixtures.observed_response_envelopes_ms)) {
      const e = envelope as Record<string, unknown>;
      expect(e.sample_count).toBe(1);
      expect(e.provenance).toBe('OBSERVED');
      expect(String(e.note)).toMatch(/Not a distribution/);
    }
  });

  it('records every metric it could not measure instead of estimating it', () => {
    const unsupported = fixtures.unsupported_metrics as Array<Record<string, string>>;
    expect(unsupported.length).toBeGreaterThanOrEqual(6);
    for (const metric of unsupported) {
      expect(metric.provenance).toBe('UNAVAILABLE');
      expect(metric.reason.length).toBeGreaterThan(10);
    }
    const names = unsupported.map((m) => m.metric);
    // The specific gaps that make a fitted latency model impossible today.
    expect(names).toContain('execution_dispatch_delay_ms');
    expect(names.some((n) => /notification/i.test(n))).toBe(true);
  });

  it('never presents a derived interval as a broker latency', () => {
    const timing = fixtures.timing as Record<string, unknown>;
    const serialised = JSON.stringify(timing);
    expect(serialised).toContain('DERIVED_MIXED_CLOCK');
    const metrics = (timing.metrics ?? []) as Array<Record<string, unknown>>;
    for (const metric of metrics) {
      if (metric.provenance !== 'OBSERVED') {
        expect(metric.is_latency, `${metric.name} must not be a latency`).toBe(false);
      }
    }
  });
});

describe('pilot fixtures — the engine profile agrees with the data', () => {
  it('uses exactly the measured envelope recorded in the fixtures', () => {
    const envelopes = fixtures.observed_response_envelopes_ms as Record<string, { value: number }>;
    expect(PILOT_REFERENCE_ENVELOPES_MS.MARKET.value).toBe(envelopes.MARKET.value);
    expect(PILOT_REFERENCE_ENVELOPES_MS.LIMIT.value).toBe(envelopes.LIMIT.value);
    expect(PILOT_REFERENCE_ENVELOPES_MS.STOP.value).toBe(envelopes.STOP.value);
  });

  it('labels the envelope OBSERVED and every internal split as an assumption', () => {
    for (const orderType of ['MARKET', 'LIMIT', 'STOP'] as const) {
      const profile = pilotReferenceProfile(orderType);
      expect(profile.acknowledgementMs.provenance).toBe('OBSERVED_SAMPLE');
      expect(profile.acknowledgementMs.sampleCount).toBe(1);
      // The decomposition is impossible from one envelope, so it must stay an assumption.
      expect(profile.travelMs.provenance).toBe('TRAINING_ASSUMPTION');
      expect(profile.dispatchMs.provenance).toBe('TRAINING_ASSUMPTION');
      expect(profile.notificationMs.provenance).toBe('TRAINING_ASSUMPTION');
      expect(profile.acceptanceMs.provenance).toBe('TRAINING_ASSUMPTION');
    }
  });

  it('carries the instrument rules observed in the pilot', () => {
    expect(BTCUSD_RULES.tickSize).toBe(fixtures.instrument.tick_size);
    expect(BTCUSD_RULES.minSize).toBe(fixtures.instrument.min_deal_size);
    expect(BTCUSD_RULES.sizeIncrement).toBe(fixtures.instrument.min_size_increment);
    expect(BTCUSD_RULES.priceDecimals).toBe(fixtures.instrument.decimal_places_factor);
  });

  it('ships the three profiles the requirements call for', () => {
    const training = trainingProfile();
    const pilot = pilotReferenceProfile('MARKET');
    const zero = zeroDelayProfile();
    expect(new Set([training.id, pilot.id, zero.id]).size).toBe(3);
    for (const profile of [training, pilot, zero]) {
      for (const key of ['travelMs', 'acceptanceMs', 'acknowledgementMs', 'dispatchMs', 'notificationMs'] as const) {
        expect(profile[key].provenance, `${profile.id}.${key}`).toBeTruthy();
        expect(typeof profile[key].value).toBe('number');
      }
    }
  });

  it('runs the engine on the pilot profile without special-casing', () => {
    const engine = makeEngine({ profile: pilotReferenceProfile('MARKET') });
    engine.onQuote({ symbol: 'BTCUSD', bid: 82_946.8, ask: 82_946.85, replayMs: 0, seq: 1 });
    engine.submitOrder({ symbol: 'BTCUSD', side: 'BUY', type: 'MARKET', size: 0.01 });
    engine.runUntilIdle();

    const fill = engine.view().fills[0];
    expect(fill.price).toBe(82_946.85); // the ask, on a real observed BTCUSD price
    // The acknowledgement envelope is the observed 231.499 ms.
    const ack = engine
      .eventLog()
      .find((e) => e.kind === 'NOTICE_DELIVERED' && e.detail.notice === 'ORDER_UPDATE');
    expect(ack?.replayMs).toBeCloseTo(231.499, 3);
  });
});

describe('pilot fixtures — the offline analyzer still agrees with the data', () => {
  it('passes every claim check', () => {
    const result = spawnSync(
      process.execPath,
      ['tools/research/analyze-capital-demo-observations.mjs', '--check'],
      { cwd: REPO, encoding: 'utf8' },
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, output.slice(-400)).toBe(0);
    expect(output).toMatch(/19\/19 passed/);
  });

  it('makes no network calls', () => {
    const source = fs.readFileSync(path.join(REPO, 'tools/research/analyze-capital-demo-observations.mjs'), 'utf8');
    expect(source).not.toMatch(/from 'node:(http|https|net)'/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).toMatch(/network_calls:\s*0/);
  });
});
