#!/usr/bin/env node
/**
 * Tests for the collector repairs in `capital-demo-order-observer.mjs`.
 *
 * These tests NEVER contact the network. The collector is only ever invoked in ways that are
 * guaranteed to fail before any transport is constructed — specifically with unusable credentials,
 * which `loadDemoCredentials()` rejects inside the client constructor.
 *
 * Run: node tools/research/test-observer-repairs.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OBSERVER = path.join(HERE, 'capital-demo-order-observer.mjs');
const ANALYZER = path.join(HERE, 'analyze-capital-demo-observations.mjs');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

const source = fs.readFileSync(OBSERVER, 'utf8');
const analyzerSource = fs.readFileSync(ANALYZER, 'utf8');

console.log('Collector repair tests (offline)\n');

// ---------------------------------------------------------------------------
console.log('1. Credential scope — a generic key must not be usable');
// ---------------------------------------------------------------------------
{
  // The loader is unit-tested directly in a subprocess. `--calibrate` cannot be used to prove
  // credential scope, because it never loads credentials at all (it only hits the public /time
  // endpoint). See the separate check below for that.
  const probe = `
    import { loadDemoCredentials } from '${OBSERVER.replace(/\\/g, '/')}';
    try {
      loadDemoCredentials();
      console.log('LOADER_ACCEPTED');
    } catch (e) {
      console.log('LOADER_REJECTED:' + e.message);
    }
  `;
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    // Generic names only — the exact shape that must NOT authenticate a run.
    CAPITAL_API_KEY: 'generic-key-that-must-not-be-accepted',
    CAPITAL_USER: 'someone',
    CAPITAL_PASSWORD: 'secret',
  };
  const res = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: REPO,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  const output = `${res.stdout || ''}${res.stderr || ''}`;
  check('generic CAPITAL_API_KEY is rejected by the loader', /LOADER_REJECTED/.test(output), output.slice(0, 300));
  check(
    'the rejection names the demo-specific variable',
    /CAPITAL_API_KEY_DEMO/.test(output),
    output.slice(0, 300),
  );
  check(
    'the rejection explains why the generic key is refused',
    /live credentials/i.test(output),
    output.slice(0, 300),
  );
  check(
    'the loader reads no credential from a generic key',
    !/LOADER_ACCEPTED/.test(output),
  );
}

// ---------------------------------------------------------------------------
console.log('\n1b. The clock probe issues requests before credentials are set');
// ---------------------------------------------------------------------------
{
  // This was discovered by a failing test: --calibrate never calls authenticate(), so bounds that
  // only exist after setCredentials() are absent when the probe runs. They must be constructor state.
  check(
    'request bounds are constructor state, not credential state',
    /this\.eventLogger = options\.eventLogger \|\| null;[\s\S]{0,400}?this\.requestTimeoutMs = options\.requestTimeoutMs/.test(source),
  );
  check(
    'setCredentials no longer references options',
    !/setCredentials\(creds\)[\s\S]{0,300}?options\.maxRequests/.test(source),
  );
  const res = spawnSync(process.execPath, [OBSERVER, '--calibrate'], {
    cwd: REPO,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, HOME_FALLBACK: '1' },
    encoding: 'utf8',
    timeout: 30000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  check(
    'the probe no longer crashes on an undefined delay argument',
    !/ERR_INVALID_ARG_TYPE/.test(out),
    out.slice(0, 300),
  );
}

// ---------------------------------------------------------------------------
console.log('\n2. Cleanup must be judged, not assumed');
// ---------------------------------------------------------------------------
{
  check(
    'cleanupPosition does not delete the id unconditionally',
    !/this\.ownedPositions\.delete\(dealId\);\s*\n\s*\}\s*\n\s*\n\s*async cleanupWorkingOrder/.test(source) &&
      /const closed = res\.status === 200/.test(source),
  );
  check(
    'a failed close is pushed to cleanupFailures',
    /this\.cleanupFailures\.push\(\{[^}]*kind: 'POSITION'/s.test(source),
  );
  check(
    'a consumed working order (404) is recorded, not treated as success',
    /res\.status === 404/.test(source) && /already consumed by triggering/.test(source),
  );
  check(
    'the position close reason names the submission-id hazard',
    /may be a SUBMISSION id/.test(source),
  );
}

// ---------------------------------------------------------------------------
console.log('\n3. Resolution derives from the observed final snapshot');
// ---------------------------------------------------------------------------
{
  check(
    'observed positions are read from the final snapshot',
    /const observedPositions = \(finalSnapshot\?\.positions/.test(source),
  );
  check(
    'the manifest uses the observed arrays, not the tracking sets',
    /unresolved_positions: observedPositions/.test(source) &&
      !/unresolved_positions: Array\.from\(this\.ownedPositions\)/.test(source),
  );
  check(
    'manifest cleanup.succeeded requires zero failures AND zero leftovers',
    /succeeded: this\.cleanupFailures\.length === 0 && observedPositions\.length === 0/.test(source),
  );
}

// ---------------------------------------------------------------------------
console.log('\n4. The success message is gated');
// ---------------------------------------------------------------------------
{
  check(
    'an unconditional success string is gone',
    !/Pilot completed successfully without errors or leftover positions/.test(source),
  );
  check(
    'success requires zero leftovers and zero failed cleanup instructions',
    /leftovers === 0 && failures === 0/.test(source),
  );
  check(
    'an unclean run sets a non-zero exit code',
    /process\.exitCode = 2/.test(source),
  );
}

// ---------------------------------------------------------------------------
console.log('\n5. Bounded execution');
// ---------------------------------------------------------------------------
{
  check('a request budget exists', /maxRequests/.test(source) && /REQUEST BUDGET EXCEEDED/.test(source));
  check('requests are counted', /this\.requestCount = \(this\.requestCount \|\| 0\) \+ 1/.test(source));
  check('a hard fetch timeout exists', /AbortSignal\.timeout\(this\.requestTimeoutMs\)/.test(source));
  check('redirects are still refused', /redirect: 'error'/.test(source));
}

// ---------------------------------------------------------------------------
console.log('\n6. Stream coverage');
// ---------------------------------------------------------------------------
{
  check(
    'non-quote/non-confirmation frames are recorded',
    /event_type: 'STREAMING_OTHER'/.test(source),
  );
  check(
    'unparseable frames are recorded as evidence',
    /event_type: 'STREAMING_UNPARSEABLE'/.test(source),
  );
  check(
    'the empty confirmation-stream catch is gone',
    !/event_type: 'STREAMING_CONFIRMATION'[\s\S]{0,400}?\}\s*\}\s*\} catch \{\s*\/\/ ignore/.test(source),
  );
}

// ---------------------------------------------------------------------------
console.log('\n7. Clock probe is dispatch-aligned');
// ---------------------------------------------------------------------------
{
  check(
    'wall anchors are sampled at actual dispatch, after the rate-limit wait',
    /const t_send = nowMono\(\);[\s\S]{0,400}?const t_send_wall = Date\.now\(\);/.test(source),
  );
  check(
    'calibrateClock consumes the request anchors rather than sampling its own',
    /res\.timings\.t_send_wall/.test(source) && /res\.timings\.t_recv_wall/.test(source),
  );
  check(
    'calibrateClock no longer samples wall time before the call',
    !/const t_send_wall = Date\.now\(\);\s*\n\s*const res = await this\.client\.request\('\/api\/v1\/time'\)/.test(source),
  );
  check(
    'the offset is labelled as a midpoint estimate with a stated limitation',
    /Only meaningful if the return path is symmetric/.test(source),
  );
}

// ---------------------------------------------------------------------------
console.log('\n8. The offline analyzer makes no network calls');
// ---------------------------------------------------------------------------
{
  check('analyzer does not import http/https/net', !/from 'node:(http|https|net)'/.test(analyzerSource));
  check('analyzer does not call fetch', !/\bfetch\s*\(/.test(analyzerSource));
  check(
    'analyzer only reads from the research data directory',
    /DATA_DIR = path\.join\(REPO, 'docs', 'research', 'capital-demo-order-data'\)/.test(analyzerSource),
  );
  check(
    'analyzer declares zero network calls in its output',
    /network_calls: 0/.test(analyzerSource),
  );
}

// ---------------------------------------------------------------------------
console.log('\n9. Analyzer claim checks still pass end-to-end');
// ---------------------------------------------------------------------------
{
  const res = spawnSync(process.execPath, [ANALYZER, '--check'], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  check('analyzer --check exits 0', res.status === 0, out.slice(-300));
  const m = out.match(/(\d+)\/(\d+) passed/);
  check('all analyzer claims pass', !!m && m[1] === m[2], m ? m[0] : 'no summary line');
  check('the claim tally is 19/19', !!m && m[2] === '19', m ? m[0] : '');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
