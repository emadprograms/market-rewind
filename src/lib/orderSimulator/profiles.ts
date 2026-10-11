import type { InstrumentRules, LatencyProfile, Labelled, Provenance } from './types';

/**
 * Latency profiles.
 *
 * The pilot measured exactly three POST response envelopes, one per order type, all BUY, on a
 * weekend demo account. That is enough to cite as a reference sample and NOT enough to fit a
 * distribution. Every other delay here is a labelled training assumption.
 *
 * See `docs/research/capital-demo-pilot-evidence-audit.md` §6 and
 * `.planning/research/PITFALLS.md` Pitfall 2.
 */

const observed = (value: number, sampleCount: number, note: string): Labelled<number> => ({
  value,
  provenance: 'OBSERVED_SAMPLE',
  sampleCount,
  note,
});

const assumption = (value: number, note: string): Labelled<number> => ({
  value,
  provenance: 'TRAINING_ASSUMPTION',
  note,
});

/** The three measured POST envelopes, as reference cards. Never applied as internal splits. */
export const PILOT_REFERENCE_ENVELOPES_MS = {
  MARKET: observed(231.499, 1, 'BTCUSD demo BUY, weekend. Single POST response envelope.'),
  LIMIT: observed(203.837, 1, 'BTCUSD demo BUY, weekend. Single POST response envelope.'),
  STOP: observed(204.384, 1, 'BTCUSD demo BUY, weekend. Single POST response envelope.'),
} as const;

/**
 * Training profile (default). The acknowledgement envelope is the only figure with any observed
 * basis; every internal split is a disclosed teaching value.
 */
export function trainingProfile(): LatencyProfile {
  return {
    id: 'training',
    label: 'Training (illustrative)',
    travelMs: assumption(100, 'Illustrative outbound travel. No one-way measurement exists.'),
    acceptanceMs: assumption(0, 'No measured acceptance/processing split is available.'),
    acknowledgementMs: assumption(
      210,
      'Illustrative acknowledgement envelope, in the region of the three observed POST responses (204–231 ms).',
    ),
    dispatchMs: assumption(50, 'Illustrative execution dispatch delay. Not measured.'),
    notificationMs: assumption(100, 'Illustrative fill-notification delay. No confirmation stream was captured.'),
    maxQuoteAgeMs: assumption(2000, 'A quote older than this is treated as stale and the instruction waits.'),
  };
}

/**
 * BTCUSD BUY pilot response reference. The acknowledgement envelope is the observed POST response
 * for the chosen order type; the internal split stays a disclosed assumption, because a single
 * response envelope cannot be decomposed into travel / processing / return.
 */
export function pilotReferenceProfile(orderType: 'MARKET' | 'LIMIT' | 'STOP'): LatencyProfile {
  const env = PILOT_REFERENCE_ENVELOPES_MS[orderType];
  const base = trainingProfile();
  return {
    ...base,
    id: `pilot-${orderType.toLowerCase()}`,
    label: `BTCUSD BUY pilot reference (${orderType})`,
    acknowledgementMs: {
      value: env.value,
      provenance: 'OBSERVED_SAMPLE',
      sampleCount: env.sampleCount,
      note: `${env.note} The internal split below remains a TRAINING ASSUMPTION — one envelope cannot be decomposed into one-way components.`,
    },
    travelMs: assumption(
      base.travelMs.value,
      'BUY-only, single sample: SELL and other instruments fall back to training values.',
    ),
  };
}

/** Zero-delay comparison. Identical quote-side and limit constraints, no instruction latency. */
export function zeroDelayProfile(): LatencyProfile {
  const zero = assumption(0, 'Comparison profile: instruction and observation delays removed.');
  return {
    id: 'zero-delay',
    label: 'Zero-delay comparison',
    travelMs: zero,
    acceptanceMs: zero,
    acknowledgementMs: zero,
    dispatchMs: zero,
    notificationMs: zero,
    maxQuoteAgeMs: assumption(60000, 'Comparison profile: freshness is not the variable under test.'),
  };
}

export const PROFILES = {
  training: trainingProfile,
  zeroDelay: zeroDelayProfile,
  pilotMarket: () => pilotReferenceProfile('MARKET'),
  pilotLimit: () => pilotReferenceProfile('LIMIT'),
  pilotStop: () => pilotReferenceProfile('STOP'),
} as const;

// ---------------------------------------------------------------------------
// Instrument rules
// ---------------------------------------------------------------------------

/**
 * BTCUSD, exactly as the pilot observed it. These values are fixture context for THIS symbol only;
 * `DEFAULT_INSTRUMENT` exists so that an unconfigured symbol is refused rather than silently given
 * two decimals and a 0.05 tick.
 */
export const BTCUSD_RULES: InstrumentRules = {
  symbol: 'BTCUSD',
  tickSize: 0.05,
  minSize: 0.0001,
  sizeIncrement: 0.0001,
  priceDecimals: 2,
  contractMultiplier: 1,
  currency: 'USD',
  provenance: 'OBSERVED_SAMPLE',
};

export class UnsupportedSymbolError extends Error {
  constructor(symbol: string) {
    super(
      `Unsupported symbol "${symbol}": no instrument rules configured. ` +
        'Instrument rules are never defaulted — add explicit rules for this symbol.',
    );
    this.name = 'UnsupportedSymbolError';
  }
}

export function createInstrumentRegistry(rules: InstrumentRules[]): (symbol: string) => InstrumentRules {
  const map = new Map(rules.map((r) => [r.symbol.toUpperCase(), r]));
  return (symbol: string) => {
    const found = map.get(String(symbol).toUpperCase());
    if (!found) throw new UnsupportedSymbolError(symbol);
    return found;
  };
}
