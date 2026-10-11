// Offline tests verifying demo transport isolation, redactor, and ledger integrity
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateDemoRestUrl,
  validateDemoStreamingUrl,
  redact,
  pseudonymizeAccount,
  MutationLedger,
  DEMO_REST_ORIGIN
} from './demo-guard.mjs';

function runTests() {
  console.log('🧪 Starting Demo Isolation Offline Tests...');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  // 1. Valid paths
  test('Accepts valid relative path /api/v1/time', () => {
    const url = validateDemoRestUrl('/api/v1/time');
    assert.equal(url, 'https://demo-api-capital.backend-capital.com/api/v1/time');
  });

  test('Accepts valid relative path api/v1/session', () => {
    const url = validateDemoRestUrl('api/v1/session');
    assert.equal(url, 'https://demo-api-capital.backend-capital.com/api/v1/session');
  });

  test('Accepts valid full demo URL', () => {
    const url = validateDemoRestUrl('https://demo-api-capital.backend-capital.com/api/v1/positions');
    assert.equal(url, 'https://demo-api-capital.backend-capital.com/api/v1/positions');
  });

  // 2. Reject Live Host
  test('Rejects live host (api-capital.backend-capital.com)', () => {
    assert.throws(
      () => validateDemoRestUrl('https://api-capital.backend-capital.com/api/v1/positions'),
      /DEMO GUARD REJECT: Hostname must be strictly/
    );
  });

  // 3. Reject Lookalike subdomains & suffix attacks
  test('Rejects lookalike domain suffix attack', () => {
    assert.throws(
      () => validateDemoRestUrl('https://demo-api-capital.backend-capital.com.evil.com/api/v1/positions'),
      /DEMO GUARD REJECT: Hostname must be strictly/
    );
  });

  test('Rejects lookalike domain prefix attack', () => {
    assert.throws(
      () => validateDemoRestUrl('https://attacker-demo-api-capital.backend-capital.com/api/v1/positions'),
      /DEMO GUARD REJECT: Hostname must be strictly/
    );
  });

  // 4. Reject Protocol-relative URL
  test('Rejects protocol-relative URL to live host', () => {
    assert.throws(
      () => validateDemoRestUrl('//api-capital.backend-capital.com/api/v1/positions'),
      /DEMO GUARD REJECT: Protocol-relative URLs are forbidden/
    );
  });

  // 5. Reject Insecure HTTP Scheme
  test('Rejects plaintext HTTP scheme', () => {
    assert.throws(
      () => validateDemoRestUrl('http://demo-api-capital.backend-capital.com/api/v1/positions'),
      /DEMO GUARD REJECT: Protocol must be https:/
    );
  });

  // 6. Reject Non-standard Port
  test('Rejects non-standard port', () => {
    assert.throws(
      () => validateDemoRestUrl('https://demo-api-capital.backend-capital.com:8443/api/v1/positions'),
      /DEMO GUARD REJECT: Non-standard port/
    );
  });

  // 7. Reject Embedded Userinfo
  test('Rejects embedded credentials / userinfo', () => {
    assert.throws(
      () => validateDemoRestUrl('https://user:pass@demo-api-capital.backend-capital.com/api/v1/positions'),
      /DEMO GUARD REJECT: Embedded userinfo/
    );
  });

  // 8. Reject Path Traversal or Non-v1 path
  test('Rejects non-/api/v1/ path', () => {
    assert.throws(
      () => validateDemoRestUrl('/api/v2/positions'),
      /DEMO GUARD REJECT: Path must begin with "\/api\/v1\/"/
    );
  });

  // 9. Streaming WebSocket Target Validation
  test('Validates exact streaming WebSocket target', () => {
    const ws = validateDemoStreamingUrl('wss://api-streaming-capital.backend-capital.com/connect');
    assert.equal(ws, 'wss://api-streaming-capital.backend-capital.com/connect');
  });

  test('Rejects unauthorized streaming WebSocket target', () => {
    assert.throws(
      () => validateDemoStreamingUrl('wss://api-streaming-live.backend-capital.com/connect'),
      /DEMO GUARD REJECT: Streaming URL must be strictly/
    );
  });

  // 10. Redaction of sensitive tokens and passwords
  test('Redacts tokens, API keys, passwords, client secrets in objects', () => {
    const sensitive = {
      CST: 'dummy-cst-token-123456789',
      'X-SECURITY-TOKEN': 'dummy-sec-token-987654321',
      'X-CAP-API-KEY': 'api-key-xyz-123',
      'CF-Access-Client-Secret': 'super-secret-access',
      password: 'MyPassword123!',
      identifier: 'trader@example.com',
      accountId: '12345678',
      safeField: 'EURUSD'
    };

    const sanitized = redact(sensitive);
    assert.equal(sanitized.CST, '[REDACTED]');
    assert.equal(sanitized['X-SECURITY-TOKEN'], '[REDACTED]');
    assert.equal(sanitized['X-CAP-API-KEY'], '[REDACTED]');
    assert.equal(sanitized['CF-Access-Client-Secret'], '[REDACTED]');
    assert.equal(sanitized.password, '[REDACTED]');
    assert.equal(sanitized.safeField, 'EURUSD');
    assert.ok(sanitized.accountId.startsWith('acc_demo_'));
    assert.ok(!JSON.stringify(sanitized).includes('dummy-cst'));
    assert.ok(!JSON.stringify(sanitized).includes('MyPassword123!'));
  });

  // 11. Redaction of raw log strings
  test('Redacts sensitive headers from raw strings', () => {
    const rawLog = 'Sending headers CST: mysecret123, X-CAP-API-KEY: keyabc, "password": "mypass"';
    const cleaned = redact(rawLog);
    assert.ok(!cleaned.includes('mysecret123'));
    assert.ok(!cleaned.includes('keyabc'));
    assert.ok(!cleaned.includes('mypass'));
  });

  // 12. Mutation Ledger Durability and Sync
  test('Mutation ledger synchronously writes and flushes intent', () => {
    const testLedgerPath = path.resolve('tools/research/.test-ledger.jsonl');
    if (fs.existsSync(testLedgerPath)) fs.unlinkSync(testLedgerPath);

    const ledger = new MutationLedger(testLedgerPath);
    const entry = ledger.record({
      mutation_type: 'ORDER_INTENT',
      epic: 'BTCUSD',
      direction: 'BUY',
      size: 0.01,
      api_key: 'secret_key'
    });

    const items = ledger.readAll();
    assert.equal(items.length, 1);
    assert.equal(items[0].epic, 'BTCUSD');
    assert.equal(items[0].api_key, '[REDACTED]');
    assert.ok(items[0].timestamp_utc);
    assert.ok(items[0].monotonic_ms);

    if (fs.existsSync(testLedgerPath)) fs.unlinkSync(testLedgerPath);
  });

  console.log(`\n🎉 All ${passed}/${total} offline tests passed successfully!`);
}

runTests();
