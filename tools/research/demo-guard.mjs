// Demo isolation guard, URL validation, ledger, and redaction logic
// For Capital.com demo order observation study.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEMO_REST_ORIGIN = 'https://demo-api-capital.backend-capital.com';
export const DEMO_REST_HOSTNAME = 'demo-api-capital.backend-capital.com';
export const DEMO_STREAMING_URL = 'wss://api-streaming-capital.backend-capital.com/connect';
export const DEMO_STREAMING_HOSTNAME = 'api-streaming-capital.backend-capital.com';

/**
 * Validates a REST request target and returns a sanitized full URL.
 * Fails closed if anything deviates from the exact demo host, https scheme, port 443, or /api/v1/ path.
 */
export function validateDemoRestUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('DEMO GUARD REJECT: Empty URL or path provided');
  }

  const raw = input.trim();

  // Reject protocol-relative URLs
  if (raw.startsWith('//')) {
    throw new Error('DEMO GUARD REJECT: Protocol-relative URLs are forbidden');
  }

  // If path given, construct candidate URL
  let candidateUrlStr;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    candidateUrlStr = raw;
  } else {
    // Relative path
    const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
    candidateUrlStr = `${DEMO_REST_ORIGIN}${normalizedPath}`;
  }

  let parsed;
  try {
    parsed = new URL(candidateUrlStr);
  } catch (err) {
    throw new Error(`DEMO GUARD REJECT: Malformed URL "${raw}": ${err.message}`);
  }

  // Scheme check
  if (parsed.protocol !== 'https:') {
    throw new Error(`DEMO GUARD REJECT: Protocol must be https:, got "${parsed.protocol}"`);
  }

  // Hostname check: exact match required
  if (parsed.hostname !== DEMO_REST_HOSTNAME) {
    throw new Error(`DEMO GUARD REJECT: Hostname must be strictly "${DEMO_REST_HOSTNAME}", got "${parsed.hostname}"`);
  }

  // Port check: default (443 / empty)
  if (parsed.port !== '' && parsed.port !== '443') {
    throw new Error(`DEMO GUARD REJECT: Non-standard port "${parsed.port}" not allowed`);
  }

  // Userinfo check
  if (parsed.username || parsed.password) {
    throw new Error('DEMO GUARD REJECT: Embedded userinfo in URL is forbidden');
  }

  // Path check: must begin with /api/v1/
  if (!parsed.pathname.startsWith('/api/v1/')) {
    throw new Error(`DEMO GUARD REJECT: Path must begin with "/api/v1/", got "${parsed.pathname}"`);
  }

  return parsed.toString();
}

/**
 * Validates the streaming WebSocket target URL.
 */
export function validateDemoStreamingUrl(input) {
  if (input !== DEMO_STREAMING_URL) {
    throw new Error(`DEMO GUARD REJECT: Streaming URL must be strictly "${DEMO_STREAMING_URL}", got "${input}"`);
  }
  return input;
}

/**
 * Pseudonymizes sensitive account IDs deterministically for reports and logs.
 */
export function pseudonymizeAccount(accountId) {
  if (!accountId) return 'acc_unknown';
  const hash = crypto.createHash('sha256').update(String(accountId)).digest('hex').slice(0, 8);
  return `acc_demo_${hash}`;
}

/**
 * Deep redaction of objects, strings, and headers to scrub auth tokens, credentials, and PII.
 */
export function redact(value, maxDepth = 10) {
  if (value === null || value === undefined) return value;
  if (maxDepth <= 0) return '[REDACTED_MAX_DEPTH]';

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => redact(item, maxDepth - 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const lower = k.toLowerCase();
      if (
        lower.includes('password') ||
        lower.includes('secret') ||
        lower.includes('api-key') ||
        lower.includes('api_key') ||
        lower.includes('apikey') ||
        lower.includes('authorization') ||
        lower === 'cst' ||
        lower === 'x-security-token' ||
        lower === 'cf-access-client-secret' ||
        lower === 'token'
      ) {
        out[k] = '[REDACTED]';
      } else if (lower.includes('identifier') || lower.includes('username') || lower.includes('email')) {
        out[k] = typeof v === 'string' && v.length > 3 ? `${v.slice(0, 2)}***@sanitized` : '[REDACTED]';
      } else if (lower === 'accountid' || lower === 'currentaccountid') {
        out[k] = pseudonymizeAccount(v);
      } else {
        out[k] = redact(v, maxDepth - 1);
      }
    }
    return out;
  }

  return value;
}

function redactString(str) {
  // If string contains CST or security token header-like format, redact it
  let sanitized = str
    .replace(/(X-CAP-API-KEY\s*[:=]\s*)([^\s,]+)/gi, '$1[REDACTED]')
    .replace(/(CST\s*[:=]\s*)([^\s,]+)/gi, '$1[REDACTED]')
    .replace(/(X-SECURITY-TOKEN\s*[:=]\s*)([^\s,]+)/gi, '$1[REDACTED]')
    .replace(/(CF-Access-Client-Secret\s*[:=]\s*)([^\s,]+)/gi, '$1[REDACTED]')
    .replace(/("password"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"')
    .replace(/("identifier"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"');

  return sanitized;
}

/**
 * Creates an append-only, synchronously-flushed mutation ledger.
 */
export class MutationLedger {
  constructor(ledgerPath) {
    this.ledgerPath = ledgerPath;
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    // Touch file if not exists
    if (!fs.existsSync(ledgerPath)) {
      fs.writeFileSync(ledgerPath, '', 'utf8');
    }
  }

  record(entry) {
    const record = {
      record_id: crypto.randomUUID(),
      timestamp_utc: new Date().toISOString(),
      monotonic_ms: Number(process.hrtime.bigint()) / 1_000_000,
      ...redact(entry)
    };

    const line = JSON.stringify(record) + '\n';
    // Append and sync to disk immediately
    const fd = fs.openSync(this.ledgerPath, 'a');
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    return record;
  }

  readAll() {
    if (!fs.existsSync(this.ledgerPath)) return [];
    const lines = fs.readFileSync(this.ledgerPath, 'utf8').split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l));
  }
}
