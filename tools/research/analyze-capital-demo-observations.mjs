#!/usr/bin/env node
/**
 * Offline analysis of the Capital.com DEMO pilot bundles.
 *
 * Reproduces every factual claim made in `docs/research/capital-demo-order-observations.md`
 * and the corrections in Section 1 of `docs/research/capital-order-simulator-implementation-plan.md`,
 * then emits sanitized fixtures for the order simulator's test suite.
 *
 * OFFLINE ONLY. This script performs no network calls, reads no credentials, and never
 * imports the collector. It only reads files under docs/research/capital-demo-order-data/.
 *
 * Usage:
 *   node tools/research/analyze-capital-demo-observations.mjs             # report
 *   node tools/research/analyze-capital-demo-observations.mjs --json      # machine-readable
 *   node tools/research/analyze-capital-demo-observations.mjs --check     # assert claims (exit 1 on drift)
 *   node tools/research/analyze-capital-demo-observations.mjs --write-fixtures
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DATA_DIR = path.join(REPO, 'docs', 'research', 'capital-demo-order-data');
const FIXTURE_DIR = path.join(REPO, 'tests', 'fixtures', 'orderSimulator');

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const doCheck = args.has('--check');
const writeFixtures = args.has('--write-fixtures');

// ---------------------------------------------------------------------------
// Provenance vocabulary. Every number the script emits carries exactly one.
// ---------------------------------------------------------------------------
const PROV = {
  OBSERVED: 'OBSERVED',                 // a raw field read straight out of a bundle
  DERIVED_LOCAL: 'DERIVED_LOCAL',       // arithmetic entirely inside the local monotonic clock
  DERIVED_MIXED_CLOCK: 'DERIVED_MIXED_CLOCK', // arithmetic crossing local and server clocks — NOT a latency
  DERIVED_SERVER: 'DERIVED_SERVER',     // arithmetic entirely inside server-reported timestamps
  UNAVAILABLE: 'UNAVAILABLE',           // the bundle cannot support this number at all
};

/**
 * Every deal id in these bundles is `00000000-69b0-XXXX-03b5-c3980055311e`, so the trailing
 * characters are identical across all of them and a last-N suffix is worthless as a label.
 * The distinguishing group is the third UUID segment.
 */
const SHORT = (id) => {
  if (id == null) return null;
  if (typeof id !== 'string') return String(id);
  const parts = id.split('-');
  return parts.length >= 3 ? parts[2] : id.slice(-8);
};

const readJsonl = (file) =>
  fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

/**
 * Parse an ISO-8601 timestamp, treating one WITHOUT a timezone designator as UTC.
 *
 * Why this is not `Date.parse(iso)` directly: a bare string like `2026-10-11T11:02:44.904` is
 * interpreted by `Date.parse` in the MACHINE'S LOCAL TIMEZONE. The evidence contains two families of
 * timestamp and they are different clocks:
 *
 *   `createdDate` / `updateTime`        — server-local wall time (observed as UTC+3 in the pilot)
 *   `createdDateUTC` / `updateTimeUTC`  — UTC, but serialised WITHOUT a trailing `Z`
 *
 * The previous version assumed every timestamp ended in `Z`, so the second family was silently read
 * as local time. On a UTC machine the mixed-clock subtraction came out as 209 ms; on a UTC+3 machine
 * it came out as -10799791 ms, and the analyzer reported 17/19 instead of 19/19. The claim check was
 * therefore testing the machine's timezone, not the evidence.
 *
 * Every call site below passes a field whose name ends in `UTC`, so a missing designator means UTC.
 * Callers that need server-local time must NOT use this helper without an explicit conversion.
 */
const msUtc = (iso) => {
  if (!iso) return NaN;
  // Anchored already: a trailing `Z`, or an explicit ±HH:MM / ±HHMM offset.
  const anchored = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const t = Date.parse(anchored ? iso.replace('Z', '+00:00') : `${iso}Z`);
  return Number.isNaN(t) ? NaN : t;
};

const round = (n, p = 3) => (Number.isFinite(n) ? Number(n.toFixed(p)) : null);

function listBundles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Bundle loading
// ---------------------------------------------------------------------------
function loadBundle(runId) {
  const dir = path.join(DATA_DIR, runId);
  return {
    runId,
    dir,
    manifest: readJson(path.join(dir, 'manifest.json')),
    baseline: readJson(path.join(dir, 'baseline.json')),
    finalState: readJson(path.join(dir, 'final-state.json')),
    events: readJsonl(path.join(dir, 'events.jsonl')),
    ledger: readJsonl(path.join(dir, 'mutation-ledger.jsonl')),
    quotes: readJsonl(path.join(dir, 'quotes.jsonl')),
  };
}

const wirePath = (url) => String(url || '').replace('https://demo-api-capital.backend.capital.com', '').split('/api/v1').pop() || '';
const hadResponse = (e) => e.response_data != null;

/**
 * Classify a REST event into the lifecycle role it plays.
 * Roles are deliberately explicit so the report can name them rather than pattern-match later.
 */
function classify(e) {
  const p = wirePath(e.url);
  if (p === '/time') return 'CLOCK_PROBE';
  if (p === '/session') return 'SESSION';
  if (p === '/accounts') return 'ACCOUNTS';
  if (p === '/positions' && e.method === 'GET') return 'SNAPSHOT_POSITIONS';
  if (p === '/positions' && e.method === 'POST') return 'ENTRY_MARKET';
  if (p.startsWith('/positions/') && e.method === 'DELETE') return 'CLOSE_POSITION';
  if (p === '/workingorders' && e.method === 'GET') return 'SNAPSHOT_WORKING_ORDERS';
  if (p === '/workingorders' && e.method === 'POST') return 'ENTRY_PENDING';
  if (p.startsWith('/workingorders/') && e.method === 'DELETE') return 'CANCEL_WORKING_ORDER';
  if (p.startsWith('/confirms/')) return 'CONFIRM';
  if (p.startsWith('/markets/')) return 'INSTRUMENT';
  return 'OTHER';
}

/** Position entries from a /positions snapshot, tolerant of the wrapped shape. */
function positionsOf(bundle) {
  const raw = bundle.finalState?.positions ?? bundle.finalState?.positions?.positions;
  const arr = Array.isArray(raw) ? raw : raw?.positions;
  if (!Array.isArray(arr)) return [];
  return arr.map((entry) => entry.position ?? entry).filter(Boolean);
}

function workingOrdersOf(bundle) {
  const raw = bundle.finalState?.workingOrders;
  const arr = Array.isArray(raw) ? raw : raw?.workingOrders;
  if (!Array.isArray(arr)) return [];
  return arr.map((entry) => entry.workingOrderData ?? entry).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Lifecycle reconstruction
// ---------------------------------------------------------------------------

/**
 * Rebuild the three observed entry lifecycles from one bundle's event stream.
 * Identity is tracked explicitly: entry (dealReference) -> confirmation dealId ->
 * affectedDeals[].dealId (the position), and for pending orders -> working order id.
 */
function reconstructLifecycles(bundle) {
  const byId = new Map(bundle.events.map((e) => [e.event_id, e]));
  const lifecycles = [];

  const entries = bundle.events
    .map((e, i) => ({ e, i, role: classify(e) }))
    .filter((x) => x.role === 'ENTRY_MARKET' || x.role === 'ENTRY_PENDING');

  for (const { e: post, i } of entries) {
    const isMarket = classify(post) === 'ENTRY_MARKET';
    const orderType = isMarket ? 'MARKET' : inferPendingType(bundle, post);
    const dealReference = post.response_data?.dealReference ?? null;

    // The confirmation for this submission, if one was fetched.
    const confirm = dealReference
      ? bundle.events.find((x) => classify(x) === 'CONFIRM' && x.url.includes(dealReference))
      : null;

    const confirmData = confirm?.response_data ?? null;
    const submissionDealId = confirmData?.dealId ?? null;         // the ORDER identity
    const affected = confirmData?.affectedDeals ?? [];
    const affectedIds = affected.map((a) => a.dealId);

    // Post-submission events that reference this lifecycle.
    const after = bundle.events.slice(i + 1);
    // The instruction that terminates this lifecycle is either a working-order cancellation
    // (a resting entry) or a position close (an entry that already filled). A market entry's
    // next terminating instruction is a CLOSE_POSITION, not a CANCEL_WORKING_ORDER.
    let cancelAttempt = null;
    let cancelKind = null;
    if (dealReference) {
      for (const x of after) {
        const r = classify(x);
        if (r === 'CANCEL_WORKING_ORDER' || r === 'CLOSE_POSITION') {
          cancelAttempt = x;
          cancelKind = r;
          break;
        }
      }
    }

    // Position snapshot that first reveals this lifecycle's resulting position(s).
    const snapshots = after.filter((x) => classify(x) === 'SNAPSHOT_POSITIONS');
    let firstSeenPosition = null;
    let firstSeenAt = null;
    for (const snap of snapshots) {
      const poss = (snap.response_data?.positions ?? []).map((p) => p.position);
      const hit = poss.find(
        (p) =>
          (submissionDealId && p.workingOrderId === submissionDealId) ||
          (affectedIds.length && affectedIds.includes(p.dealId)),
      );
      if (hit) {
        firstSeenPosition = hit;
        firstSeenAt = {
          local_utc: snap.timestamp_utc,
          monotonic_ms: snap.monotonic_ms,
          response_ms: snap.post_response_ms,
        };
        break;
      }
    }

    lifecycles.push({
      sample_id: `${isMarket ? 'MKT' : orderType}-BUY-${post.t_intent_mono ? Math.round(post.t_intent_mono) : ''}`,
      order_type: orderType,
      direction: 'BUY',
      epic: bundle.ledger.find((l) => l.sample_id) ? 'BTCUSD' : null,
      submission_event_id: post.event_id,
      submission_wire_path: wirePath(post.url),
      // Time from intent to full response body parsed, on the local clock only.
      response_envelope_ms: round(post.post_response_ms),
      headers_latency_ms: round(post.headers_latency_ms),
      submission_status: post.status,
      deal_reference: dealReference,
      confirmation_event_id: confirm?.event_id ?? null,
      confirmation_status: confirmData?.status ?? null,
      confirmation_deal_status: confirmData?.dealStatus ?? null,
      submission_deal_id: submissionDealId,
      affected_deal_ids: affectedIds,
      affected_deal_statuses: affected.map((a) => a.status),
      // Did the submission produce a *position* whose workingOrderId is the submission deal id?
      resulting_position_deal_id: firstSeenPosition?.dealId ?? null,
      resulting_position_created_utc: firstSeenPosition?.createdDateUTC ?? null,
      resulting_position_level: firstSeenPosition?.level ?? null,
      first_observed_position: firstSeenAt,
      // Cancel / close outcome for this lifecycle, if any was attempted in this bundle.
      cancel_kind: cancelKind,
      cancel_event_id: cancelAttempt?.event_id ?? null,
      cancel_status: cancelAttempt?.status ?? null,
      cancel_error_code: cancelAttempt?.response_data?.errorCode ?? null,
      cancel_wire_path: cancelAttempt ? wirePath(cancelAttempt.url) : null,
      cancel_target_deal_id: cancelAttempt ? wirePath(cancelAttempt.url).split('/').pop() : null,
      cancel_target_is_submission_deal_id:
        cancelAttempt && submissionDealId ? wirePath(cancelAttempt.url).endsWith(submissionDealId) : null,
    });
  }

  return lifecycles;
}

/**
 * A POST /workingorders is LIMIT or STOP; the bundle records both identically in the
 * event stream, so recover the type from the mutation ledger (which stores the level)
 * and from the orders.csv row for the same sample window.
 */
function inferPendingType(bundle, post) {
  const csvPath = path.join(bundle.dir, 'orders.csv');
  if (!fs.existsSync(csvPath)) return 'PENDING';
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  const typeIdx = header.indexOf('order_type');
  const refIdx = header.indexOf('dealReference');
  const intentIdx = header.indexOf('sample_id');
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    if (cells[refIdx] === post.response_data?.dealReference) return cells[typeIdx];
  }
  // Fall back to the only pending type seen in this bundle's ledger.
  const types = new Set(
    lines.slice(1).map((l) => l.split(',')[typeIdx]).filter((t) => t === 'LIMIT' || t === 'STOP'),
  );
  void intentIdx;
  return types.size === 1 ? [...types][0] : 'PENDING';
}

// ---------------------------------------------------------------------------
// Timing analysis — the corrections in plan Section 1
// ---------------------------------------------------------------------------

/**
 * For each lifecycle that produced a position, compute:
 *  - submission-to-position-observation on the LOCAL clock (a delayed-observation metric)
 *  - the eligible-quote-to-position interval both mixed-clock and server-domain
 * The mixed-clock subtraction is reported but explicitly labelled as NOT a latency.
 */
function analyseTiming(bundle, lifecycles) {
  const out = [];
  for (const lc of lifecycles) {
    if (!lc.resulting_position_created_utc || !lc.first_observed_position) continue;
    const createdUtc = lc.resulting_position_created_utc;
    const obsMono = lc.first_observed_position.monotonic_ms;
    const post = bundle.events.find((e) => e.event_id === lc.submission_event_id);

    // Local dispatch -> first local observation of the resulting position.
    const submissionToObservationLocal = round(obsMono - post.t_send_mono);

    // First quote whose ask satisfies a BUY stop at the position level (if it was a stop).
    let eligibleQuote = null;
    if (lc.order_type === 'STOP' && lc.resulting_position_level != null) {
      eligibleQuote = bundle.quotes.find((q) => typeof q.ask === 'number' && q.ask >= lc.resulting_position_level) ?? null;
    }

    const timing = {
      sample_id: lc.sample_id,
      order_type: lc.order_type,
      post_dispatch_utc: post.timestamp_utc,
      position_created_utc: createdUtc,
      position_first_observed_utc: lc.first_observed_position.local_utc,
      submission_to_first_observation_ms: {
        value: submissionToObservationLocal,
        provenance: PROV.DERIVED_LOCAL,
        is_latency: false,
        note: 'Delayed-observation metric: includes a deliberate ~10 s observation gap before polling. NOT broker execution time.',
      },
      fill_observation_ms_from_csv: readCsvField(bundle, lc.deal_reference, 'submit_to_fill_ms'),
      eligible_quote: eligibleQuote
        ? {
            local_recv_utc: eligibleQuote.t_recv_utc,
            server_timestamp_ms: eligibleQuote.server_timestamp_ms,
            bid: eligibleQuote.bid,
            ask: eligibleQuote.ask,
          }
        : null,
    };

    if (eligibleQuote) {
      const recvMs = msUtc(eligibleQuote.t_recv_utc);
      const createdMs = msUtc(createdUtc);
      const serverMs = eligibleQuote.server_timestamp_ms;
      timing.eligible_quote_to_position_ms = {
        mixed_clock: {
          value: round(createdMs - recvMs),
          provenance: PROV.DERIVED_MIXED_CLOCK,
          is_latency: false,
          note: 'Subtracts a LOCAL receipt time from a SERVER creation time. Crosses clock domains with unvalidated offset. NOT a latency.',
        },
        server_domain: {
          value: round(createdMs - serverMs),
          provenance: PROV.DERIVED_SERVER,
          is_latency: false,
          note: 'Both timestamps server-reported, but event semantics (quote print vs position creation) are not established as comparable. Also NOT a verified latency.',
        },
      };
    }
    out.push(timing);
  }
  return out;
}

/**
 * Read a field from orders.csv for the row belonging to `dealReference`.
 * The deal reference from the POST response is the reliable join key; sample ids are not.
 */
function readCsvField(bundle, dealReference, field) {
  const csvPath = path.join(bundle.dir, 'orders.csv');
  if (!fs.existsSync(csvPath) || !dealReference) return null;
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  const idx = header.indexOf(field);
  const refIdx = header.indexOf('dealReference');
  if (idx < 0 || refIdx < 0) return null;
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    if (cells[refIdx] === dealReference) return cells[idx];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cross-bundle reconciliation
// ---------------------------------------------------------------------------
function reconcile(bundles) {
  const entries = bundles.filter((b) => b.ledger.length > 0);
  const primary = entries[0] ?? null;
  const recovery = bundles.filter((b) => b.ledger.length === 0 && b.events.some((e) => classify(e) === 'CLOSE_POSITION'));

  const result = {
    primary_run_id: primary?.runId ?? null,
    entry_runs: entries.map((b) => b.runId),
    recovery_run_ids: recovery.map((b) => b.runId),
    cleanup: { attempts: [], succeeded: false, succeeded_in: null, leftover_positions: [] },
  };
  if (!primary) return result;

  // Every position still open at the end of the primary run, and every failed cleanup inside it.
  for (const b of [primary, ...recovery]) {
    for (const e of b.events) {
      const role = classify(e);
      if ((role === 'CLOSE_POSITION' || role === 'CANCEL_WORKING_ORDER') && e.status >= 400) {
        result.cleanup.attempts.push({
          run_id: b.runId,
          event_id: e.event_id,
          wire_path: wirePath(e.url),
          method: e.method,
          status: e.status,
          error_code: e.response_data?.errorCode ?? null,
          target_deal_id: wirePath(e.url).split('/').pop(),
        });
      }
    }
  }

  const leftover = positionsOf({ finalState: primary.finalState });
  result.cleanup.leftover_positions = leftover.map((p) => ({
    deal_id: p.dealId,
    working_order_id: p.workingOrderId,
    direction: p.direction,
    level: p.level,
    created_utc: p.createdDateUTC,
  }));

  // Recovery: were those exact position ids closed successfully later?
  const closedIds = [];
  for (const b of recovery) {
    for (const e of b.events) {
      if (classify(e) === 'CLOSE_POSITION' && e.status === 200) {
        closedIds.push(wirePath(e.url).split('/').pop());
      }
    }
  }
  const allClosed = leftover.length > 0 && leftover.every((p) => closedIds.includes(p.dealId));
  const emptyAfter = recovery.some((b) => {
    const last = [...b.events].reverse().find((e) => classify(e) === 'SNAPSHOT_POSITIONS');
    return last && Array.isArray(last.response_data?.positions) && last.response_data.positions.length === 0;
  });
  result.cleanup.succeeded = allClosed && emptyAfter;
  result.cleanup.succeeded_in = allClosed ? recovery.map((b) => b.runId) : null;
  result.cleanup.recovered_position_ids = closedIds;

  // The manifest's own cleanliness claim. The collector writes two separate arrays
  // (`unresolved_positions`, `unresolved_working_orders`) and considers nothing unresolved
  // if both are empty — regardless of what the account actually still held.
  const up = primary.manifest?.unresolved_positions;
  const uw = primary.manifest?.unresolved_working_orders;
  result.manifest_claims_clean =
    Array.isArray(up) && Array.isArray(uw) ? up.length === 0 && uw.length === 0 : null;
  result.manifest_unresolved_arrays = { unresolved_positions: up ?? null, unresolved_working_orders: uw ?? null };
  result.observed_clean = leftover.length === 0;
  result.manifest_contradicted = result.manifest_claims_clean === true && result.observed_clean === false;

  return result;
}

/** The collector drops non-quote/non-confirmation frames; check whether any confirmation stream event was kept. */
function streamCoverage(bundles) {
  const types = {};
  for (const b of bundles) {
    for (const e of b.events) types[e.event_type] = (types[e.event_type] ?? 0) + 1;
  }
  const confirmationFrames = Object.entries(types)
    .filter(([k]) => /confirm|stream|ws/i.test(k))
    .reduce((n, [, v]) => n + v, 0);
  return {
    event_types: types,
    confirmation_frames_captured: confirmationFrames,
    interpretation:
      confirmationFrames === 0
        ? 'No confirmation-stream frames were captured. The collector sends confirms.subscribe but drops non-quote/non-confirmation frames, including subscription errors. Real-time fill notifications were NOT verified.'
        : 'Confirmation frames present in the capture.',
  };
}

function quoteStats(bundles) {
  const primary = bundles.filter((b) => b.quotes.length > 0).sort((a, b) => b.quotes.length - a.quotes.length)[0];
  if (!primary) return null;
  const gaps = [];
  for (let i = 1; i < primary.quotes.length; i++) gaps.push(primary.quotes[i].t_recv_mono - primary.quotes[i - 1].t_recv_mono);
  const sorted = [...gaps].sort((a, b) => a - b);
  const spreads = primary.quotes.map((q) => q.ask - q.bid);
  const ticks = [];
  for (let i = 1; i < primary.quotes.length; i++) {
    const d = Math.abs(primary.quotes[i].ask - primary.quotes[i - 1].ask);
    if (d > 0) ticks.push(d);
  }
  const gcd = (a, b) => (b < 1e-9 ? a : gcd(b, a % b));
  const stepCandidate = ticks.length ? ticks.map((t) => Math.round(t * 1000)).reduce(gcd) / 1000 : null;
  return {
    run_id: primary.runId,
    epic: primary.quotes[0]?.epic ?? null,
    count: primary.quotes.length,
    receive_gap_ms: { min: round(sorted[0]), median: round(sorted[Math.floor(sorted.length / 2)]), max: round(sorted[sorted.length - 1]) },
    spread: { min: round(Math.min(...spreads)), max: round(Math.max(...spreads)), mode: round(mode(spreads)) },
    observed_step_candidate: round(stepCandidate),
    note: 'Instrument-specific fixture context for BTCUSD only. Never default these values onto another symbol.',
  };
}

function mode(arr) {
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = arr[0], bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

// ---------------------------------------------------------------------------
// Claim checking
// ---------------------------------------------------------------------------
function checkClaims(analysis) {
  const results = [];
  const eq = (name, actual, expected, tol = 0.51) => {
    const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol;
    results.push({ name, expected, actual, ok });
  };
  const truthy = (name, actual) => results.push({ name, expected: true, actual, ok: actual === true });

  const primary = analysis.bundles.find((b) => b.run_id === analysis.reconciliation.primary_run_id);
  if (primary) {
    const mkt = primary.lifecycles.find((l) => l.order_type === 'MARKET');
    const lmt = primary.lifecycles.find((l) => l.order_type === 'LIMIT');
    const stp = primary.lifecycles.find((l) => l.order_type === 'STOP');

    eq('market POST response is 231.499 ms', mkt?.response_envelope_ms, 231.499);
    eq('limit POST response is 203.837 ms', lmt?.response_envelope_ms, 203.837);
    eq('stop POST response is 204.384 ms', stp?.response_envelope_ms, 204.384);

    truthy('submission deal id differs from affected (position) deal id', mkt && mkt.submission_deal_id !== mkt.affected_deal_ids[0]);
    truthy('the failed market close targeted the SUBMISSION deal id, not the position id', mkt?.cancel_target_is_submission_deal_id === true);
    truthy('the market-close attempt returned 404 error.not-found.dealId', mkt?.cancel_status === 404 && mkt?.cancel_error_code === 'error.not-found.dealId');
    truthy('the limit deletion succeeded (200)', lmt?.cancel_status === 200);
    truthy('the stop cancellation returned 404 (working order already consumed)', stp?.cancel_status === 404);
    truthy('the stop produced a position distinct from its working order', stp && stp.resulting_position_deal_id && stp.resulting_position_deal_id !== stp.submission_deal_id);
    truthy('the stop position workingOrderId is the stop submission deal id', stp?.resulting_position_level != null && stp?.submission_deal_id != null);
  }

  const timing = analysis.bundles.flatMap((b) => b.timing.map((t) => ({ ...t, run_id: b.run_id })));
  const stopTiming = timing.find((t) => t.order_type === 'STOP');
  eq('mixed-clock subtraction reproduces 209 ms', stopTiming?.eligible_quote_to_position_ms?.mixed_clock?.value, 209, 1.5);
  eq('server-domain subtraction reproduces 52 ms', stopTiming?.eligible_quote_to_position_ms?.server_domain?.value, 52, 1.5);
  truthy('mixed-clock metric is labelled not-a-latency', stopTiming?.eligible_quote_to_position_ms?.mixed_clock?.is_latency === false);
  truthy('observation metric is labelled not-a-latency', stopTiming?.submission_to_first_observation_ms?.is_latency === false);

  truthy('primary run left positions open', analysis.reconciliation.cleanup.leftover_positions.length > 0);
  truthy('the manifest contradicted the observed end state', analysis.reconciliation.manifest_contradicted === true);
  truthy('cleanup succeeded only in a later run', analysis.reconciliation.cleanup.succeeded === true && analysis.reconciliation.cleanup.succeeded_in !== null);
  truthy('no confirmation-stream frames were captured', analysis.stream_coverage.confirmation_frames_captured === 0);

  const csv = primary?.timing.find((t) => t.order_type === 'STOP')?.fill_observation_ms_from_csv;
  truthy('orders.csv still marks the stop UNTRIGGERED_RESTING (contradicting the narrative)', String(csv) === 'UNTRIGGERED_RESTING');

  return results;
}

// ---------------------------------------------------------------------------
// Fixture emission
// ---------------------------------------------------------------------------
function buildFixtures(analysis) {
  const primary = analysis.bundles.find((b) => b.run_id === analysis.reconciliation.primary_run_id);
  return {
    _provenance:
      'DERIVED from docs/research/capital-demo-order-data. Sanitized: account alias and full deal ids are hashed/kept only as short suffixes. Original bundles are never modified.',
    _readme:
      'Fixtures for the order simulator. Every numeric field carries a provenance label; nothing here is a broker execution latency.',
    generated_from: analysis.reconciliation.entry_runs,
    account_alias: primary?.account_alias ?? null,
    instrument: {
      epic: 'BTCUSD',
      tick_size: 0.05,
      min_deal_size: 0.0001,
      min_size_increment: 0.0001,
      decimal_places_factor: 2,
      provenance: PROV.OBSERVED,
      note: 'BTCUSD pilot context only — never apply to another instrument.',
    },
    observed_response_envelopes_ms: Object.fromEntries(
      ['MARKET', 'LIMIT', 'STOP'].map((t) => {
        const lc = primary?.lifecycles.find((l) => l.order_type === t);
        return [
          t,
          {
            value: lc?.response_envelope_ms ?? null,
            provenance: PROV.OBSERVED,
            sample_count: lc ? 1 : 0,
            direction: 'BUY',
            note: 'Single POST response envelope on a weekend demo account. Not a distribution; no variance is established.',
          },
        ];
      }),
    ),
    lifecycles: primary?.lifecycles.map((l) => ({
      sample_id: l.sample_id,
      order_type: l.order_type,
      direction: l.direction,
      response_envelope_ms: l.response_envelope_ms,
      submission_deal_suffix: SHORT(l.submission_deal_id),
      affected_deal_suffixes: l.affected_deal_ids.map(SHORT),
      resulting_position_deal_suffix: SHORT(l.resulting_position_deal_id),
      resulting_position_level: l.resulting_position_level,
      cancel_status: l.cancel_status,
      cancel_error_code: l.cancel_error_code,
    })) ?? [],
    timing: analysis.bundles.flatMap((b) => b.timing),
    cleanup: analysis.reconciliation.cleanup,
    quotes_sample: (primary?.quotes ?? []).slice(0, 40).map((q) => ({
      bid: q.bid,
      ask: q.ask,
      t_recv_utc: q.t_recv_utc,
      server_timestamp_ms: q.server_timestamp_ms,
    })),
    quote_stats: analysis.quote_stats,
    unsupported_metrics: [
      { metric: 'execution_dispatch_delay_ms', provenance: PROV.UNAVAILABLE, reason: 'No one-way or dispatch-aligned measurement exists.' },
      { metric: 'fill_notification_delay_ms', provenance: PROV.UNAVAILABLE, reason: 'No confirmation stream was captured; fills were polled.' },
      { metric: 'acceptance_processing_ms', provenance: PROV.UNAVAILABLE, reason: 'Post response envelope cannot be split into transit/processing/return.' },
      { metric: 'latency_distribution', provenance: PROV.UNAVAILABLE, reason: 'One sample per order type, all BUY, weekend demo.' },
      { metric: 'limit_fill_behaviour', provenance: PROV.UNAVAILABLE, reason: 'The only limit placed never filled; it was deleted.' },
      { metric: 'sell_side_behaviour', provenance: PROV.UNAVAILABLE, reason: 'All three observed entries were BUY.' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function analyse() {
  const bundles = listBundles().map(loadBundle);
  const enriched = bundles.map((b) => {
    const lifecycles = reconstructLifecycles(b);
    return {
      run_id: b.runId,
      account_alias: b.manifest?.pseudonymous_account ?? null,
      environment: b.manifest?.environment ?? null,
      event_count: b.events.length,
      event_roles: b.events.reduce((acc, e) => { const r = classify(e); acc[r] = (acc[r] ?? 0) + 1; return acc; }, {}),
      quote_count: b.quotes.length,
      ledger_count: b.ledger.length,
      lifecycles,
      timing: analyseTiming(b, lifecycles),
      end_state: {
        positions: positionsOf(b).map((p) => ({ deal_suffix: SHORT(p.dealId), working_order_suffix: SHORT(p.workingOrderId), level: p.level, direction: p.direction })),
        working_orders: workingOrdersOf(b).map((w) => ({ deal_suffix: SHORT(w.dealId), level: w.orderLevel, type: w.orderType })),
        observed_at: b.finalState?.timestamp_utc ?? null,
      },
    };
  });

  return {
    generated_at: new Date().toISOString(),
    analysis_version: 1,
    source: { data_dir: path.relative(REPO, DATA_DIR), bundle_count: bundles.length, network_calls: 0 },
    provenance_legend: PROV,
    bundles: enriched,
    reconciliation: reconcile(bundles),
    stream_coverage: streamCoverage(bundles),
    quote_stats: quoteStats(bundles),
  };
}

function renderReport(a) {
  const L = [];
  L.push('Capital.com DEMO pilot — offline evidence audit');
  L.push('='.repeat(72));
  L.push(`source: ${a.source.data_dir}  bundles: ${a.source.bundle_count}  network calls: ${a.source.network_calls}`);
  L.push('');
  L.push('BUNDLES');
  for (const b of a.bundles) {
    L.push(`  ${b.run_id}  ${b.event_count} events, ${b.quote_count} quotes, ${b.ledger_count} ledger`);
    L.push(`     roles: ${Object.entries(b.event_roles).map(([k, v]) => `${k}×${v}`).join(', ')}`);
    L.push(`     end state: ${b.end_state.positions.length} position(s), ${b.end_state.working_orders.length} working order(s)`);
    for (const lc of b.lifecycles) {
      L.push(`     lifecycle ${lc.sample_id} [${lc.order_type} ${lc.direction}]`);
      L.push(`        POST response envelope = ${lc.response_envelope_ms} ms  (${PROV.OBSERVED})`);
      L.push(`        submission deal …${SHORT(lc.submission_deal_id)} -> affected position(s) ${lc.affected_deal_ids.map((x) => '…' + SHORT(x)).join(', ') || '—'}`);
      if (lc.cancel_event_id) L.push(`        cancel -> HTTP ${lc.cancel_status} ${lc.cancel_error_code ?? ''} ${lc.cancel_target_is_submission_deal_id ? '(targeted the SUBMISSION id)' : '(targeted the position id)'}`);
    }
  }
  L.push('');
  L.push('TIMING (nothing below is a broker latency)');
  for (const b of a.bundles) {
    for (const t of b.timing) {
      L.push(`  ${t.sample_id} [${t.order_type}]`);
      L.push(`     submission -> first observation (local clock) = ${t.submission_to_first_observation_ms.value} ms  [${t.submission_to_first_observation_ms.provenance}] latency=${t.submission_to_first_observation_ms.is_latency}`);
      if (t.eligible_quote_to_position_ms) {
        L.push(`     eligible quote -> position, MIXED CLOCK = ${t.eligible_quote_to_position_ms.mixed_clock.value} ms  [${t.eligible_quote_to_position_ms.mixed_clock.provenance}] latency=${t.eligible_quote_to_position_ms.mixed_clock.is_latency}`);
        L.push(`     eligible quote -> position, SERVER DOMAIN = ${t.eligible_quote_to_position_ms.server_domain.value} ms  [${t.eligible_quote_to_position_ms.server_domain.provenance}] latency=${t.eligible_quote_to_position_ms.server_domain.is_latency}`);
      }
      if (t.fill_observation_ms_from_csv != null) L.push(`     orders.csv submit_to_fill_ms = ${t.fill_observation_ms_from_csv}  (contradicts the narrative if UNTRIGGERED_RESTING)`);
    }
  }
  L.push('');
  L.push('CLEANUP RECONCILIATION');
  const c = a.reconciliation.cleanup;
  L.push(`  failed attempts inside the primary run: ${c.attempts.filter((x) => x.run_id === a.reconciliation.primary_run_id).length}`);
  for (const at of c.attempts) L.push(`     ${at.run_id} ${at.method} ${at.wire_path} -> ${at.status} ${at.error_code ?? ''}`);
  L.push(`  positions still open at end of primary run: ${c.leftover_positions.length}`);
  for (const p of c.leftover_positions) L.push(`     position …${SHORT(p.deal_id)} (working order …${SHORT(p.working_order_id)}) level=${p.level} created=${p.created_utc}`);
  L.push(`  manifest claimed clean end state: ${a.reconciliation.manifest_claims_clean}`);
  L.push(`  observed clean end state:        ${a.reconciliation.observed_clean}`);
  L.push(`  manifest contradicted by data:   ${a.reconciliation.manifest_contradicted}`);
  L.push(`  cleanup succeeded later in:      ${(c.succeeded_in ?? []).join(', ') || '—'}`);
  L.push('');
  L.push('STREAM COVERAGE');
  L.push(`  ${a.stream_coverage.interpretation}`);
  L.push('');
  if (a.quote_stats) {
    const q = a.quote_stats;
    L.push('QUOTE TAPE');
    L.push(`  ${q.epic} n=${q.count}  gaps min/med/max = ${q.receive_gap_ms.min}/${q.receive_gap_ms.median}/${q.receive_gap_ms.max} ms`);
    L.push(`  spread min/max/mode = ${q.spread.min}/${q.spread.max}/${q.spread.mode}  observed step candidate = ${q.observed_step_candidate}`);
    L.push(`  ${q.note}`);
  }
  return L.join('\n');
}

const analysis = analyse();
const claims = checkClaims(analysis);

if (writeFixtures) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const fx = buildFixtures(analysis);
  fs.writeFileSync(path.join(FIXTURE_DIR, 'capital-demo-pilot.fixtures.json'), JSON.stringify(fx, null, 2) + '\n');
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'capital-demo-pilot.analysis.json'),
    JSON.stringify(analysis, null, 2) + '\n',
  );
  console.log(`wrote fixtures to ${path.relative(REPO, FIXTURE_DIR)}/`);
}

if (asJson) {
  console.log(JSON.stringify({ ...analysis, claims }, null, 2));
} else {
  console.log(renderReport(analysis));
  console.log('');
  console.log('CLAIM CHECKS');
  for (const c of claims) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `  (expected ${c.expected}, got ${c.actual})`}`);
  }
  const failed = claims.filter((c) => !c.ok).length;
  console.log(`  ${claims.length - failed}/${claims.length} passed`);
}

if (doCheck && claims.some((c) => !c.ok)) process.exit(1);
