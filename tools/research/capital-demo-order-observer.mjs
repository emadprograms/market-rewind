#!/usr/bin/env node

/**
 * Standalone Capital.com DEMO API Order Observer.
 * Locked strictly to DEMO environment. Fail-closed transport.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DEMO_REST_ORIGIN,
  DEMO_STREAMING_URL,
  validateDemoRestUrl,
  validateDemoStreamingUrl,
  redact,
  pseudonymizeAccount,
  MutationLedger
} from './demo-guard.mjs';

/**
 * OFFLINE KILL SWITCH — `CAPITAL_DEMO_OFFLINE=1`.
 *
 * When set, this process is forbidden from opening any connection to the demo API: REST requests
 * throw before they are issued and the streaming socket refuses to connect. It exists because the
 * collector's own test suite has to exercise the transport's failure paths, and that must be possible
 * without any chance of reaching Capital.com. It is a defence in depth, not a replacement for the
 * demo-only URL validation in `demo-guard.mjs`: the mutation guard decides *what* may be sent, this
 * decides *whether anything may be sent at all*.
 *
 * Read at call time (not import time) so a parent process can set it for a child.
 */
export function isOffline() {
  return String(process.env.CAPITAL_DEMO_OFFLINE || '').trim() === '1';
}

const OFFLINE_ERROR =
  'OFFLINE_MODE: CAPITAL_DEMO_OFFLINE=1 forbids network access. No request was issued and no ' +
  'connection was opened. Unset it only when a human intends to talk to the demo API.';

// Environment & Credential loader
export function loadDemoCredentials() {
  const envSources = [
    path.resolve('.env'),
    path.resolve('../trading-terminal/.env'),
    path.resolve('../trading-terminal/.env.local')
  ];

  // REPAIR (credential scope): only demo-specific names are accepted. The previous loader fell
  // back to a generic CAPITAL_API_KEY, which can resolve to LIVE credentials — unacceptable for a
  // collector whose whole safety story is "demo only".
  const loaded = {
    apiKey: process.env.CAPITAL_API_KEY_DEMO,
    user: process.env.CAPITAL_USER_DEMO || process.env.VITE_CAPITAL_USER,
    password: process.env.CAPITAL_PASSWORD_DEMO || process.env.VITE_CAPITAL_PASSWORD,
    cfClientId: process.env.VITE_CF_ACCESS_CLIENT_ID,
    cfClientSecret: process.env.VITE_CF_ACCESS_CLIENT_SECRET
  };

  for (const envPath of envSources) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');

        if (!loaded.apiKey && key === 'CAPITAL_API_KEY_DEMO') loaded.apiKey = val;
        if (!loaded.user && (key === 'VITE_CAPITAL_USER' || key === 'CAPITAL_USER' || key === 'CAPITAL_USER_DEMO')) loaded.user = val;
        if (!loaded.password && (key === 'VITE_CAPITAL_PASSWORD' || key === 'CAPITAL_PASSWORD' || key === 'CAPITAL_PASSWORD_DEMO')) loaded.password = val;
        if (!loaded.cfClientId && key === 'VITE_CF_ACCESS_CLIENT_ID') loaded.cfClientId = val;
        if (!loaded.cfClientSecret && key === 'VITE_CF_ACCESS_CLIENT_SECRET') loaded.cfClientSecret = val;
      }
    }
  }

  if (!loaded.apiKey || !loaded.user || !loaded.password) {
    throw new Error(
      'DEMO CREDENTIALS MISSING: set CAPITAL_API_KEY_DEMO plus demo user/password. ' +
      'A generic CAPITAL_API_KEY is deliberately NOT accepted, because it may resolve to live credentials.'
    );
  }

  return loaded;
}

// Monotonic clock helper
function nowMono() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

// Rate-limited HTTP client with strict demo validation and no redirects
class DemoHttpClient {
  constructor(options = {}) {
    this.minIntervalMs = options.minIntervalMs || 260; // >4 req/s max
    this.lastRequestStartMono = 0;
    this.cst = null;
    this.securityToken = null;
    this.apiKey = null;
    this.cfClientId = null;
    this.cfClientSecret = null;
    this.eventLogger = options.eventLogger || null;
    // REPAIR (bounded execution): these bounds must be initialised in the CONSTRUCTOR, because
    // requests can be issued before credentials are set (the clock probe does exactly that).
    this.requestCount = 0;
    this.maxRequests = options.maxRequests || 500;   // hard ceiling per run
    this.requestTimeoutMs = options.requestTimeoutMs || 15000;
  }

  setTokens(cst, securityToken) {
    this.cst = cst;
    this.securityToken = securityToken;
  }

  setCredentials(creds) {
    this.apiKey = creds.apiKey;
    this.cfClientId = creds.cfClientId;
    this.cfClientSecret = creds.cfClientSecret;
  }

  async _waitRateLimit() {
    const elapsed = nowMono() - this.lastRequestStartMono;
    if (elapsed < this.minIntervalMs) {
      const waitTime = Math.ceil(this.minIntervalMs - elapsed);
      await new Promise(r => setTimeout(r, waitTime));
    }
    this.lastRequestStartMono = nowMono();
  }

  async request(pathOrUrl, options = {}) {
    // REPAIR (bounded execution): a run must not be able to place an unbounded number of requests,
    // and no single request may hang forever. Both bounds are deliberately generous but finite.
    this.requestCount = (this.requestCount || 0) + 1;
    if (this.requestCount > this.maxRequests) {
      throw new Error(`REQUEST BUDGET EXCEEDED: ${this.requestCount} > maxRequests=${this.maxRequests}. Aborting to avoid unbounded demo mutation.`);
    }

    await this._waitRateLimit();

    const validatedUrl = validateDemoRestUrl(pathOrUrl);
    const method = (options.method || 'GET').toUpperCase();
    const t_intent = options.t_intent || nowMono();
    const t_send = nowMono();
    // REPAIR (dispatch alignment): the wall-clock anchor must be sampled at the SAME instant as the
    // monotonic dispatch anchor, i.e. after _waitRateLimit() has already elapsed. Sampling it before
    // the rate-limit wait (as calibrateClock used to) makes the reported RTT and the offset describe
    // two different intervals.
    const t_send_wall = Date.now();

    const headers = {
      'Content-Type': 'application/json',
      'X-CAP-API-KEY': this.apiKey,
      ...(options.headers || {})
    };

    if (this.cfClientId) headers['CF-Access-Client-Id'] = this.cfClientId;
    if (this.cfClientSecret) headers['CF-Access-Client-Secret'] = this.cfClientSecret;
    if (this.cst) headers['CST'] = this.cst;
    if (this.securityToken) headers['X-SECURITY-TOKEN'] = this.securityToken;

    let response;
    let t_headers;
    let t_body;
    let bodyText = '';
    let json = null;
    let error = null;

    // SAFETY: the last point before a socket is opened. Everything above this line — argument
    // handling, the request budget, the rate-limit wait and demo-URL validation — runs exactly as it
    // does online, so an offline test still exercises those paths and still fails if one of them
    // breaks. Below this line, nothing may touch the network.
    if (isOffline()) throw new Error(OFFLINE_ERROR);

    try {
      response = await fetch(validatedUrl, {
        method,
        headers,
        body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
        redirect: 'error', // strict: fail on redirect
        // REPAIR (bounded execution): without a timeout a stalled socket hangs the whole run
        // between two mutations, leaving positions open with no artifact written.
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });

      t_headers = nowMono();
      bodyText = await response.text();
      t_body = nowMono();

      if (bodyText) {
        try {
          json = JSON.parse(bodyText);
        } catch {
          // not JSON
        }
      }
    } catch (err) {
      error = err;
      t_body = nowMono();
    }

    const t_parsed = nowMono();
    const t_recv_wall = Date.now();

    // Extract updated CST or security tokens if returned
    if (response) {
      const newCst = response.headers.get('CST');
      const newSec = response.headers.get('X-SECURITY-TOKEN');
      if (newCst) this.cst = newCst;
      if (newSec) this.securityToken = newSec;
    }

    const eventRecord = {
      event_type: 'REST_REQUEST',
      url: validatedUrl,
      method,
      status: response ? response.status : null,
      status_text: response ? response.statusText : null,
      t_intent_mono: t_intent,
      t_send_mono: t_send,
      t_send_wall_ms: t_send_wall,
      t_recv_wall_ms: t_recv_wall,
      t_headers_mono: t_headers || null,
      t_body_mono: t_body,
      t_parsed_mono: t_parsed,
      post_response_ms: t_body - t_send,
      headers_latency_ms: t_headers ? t_headers - t_send : null,
      body_size_bytes: bodyText.length,
      error_message: error ? error.message : null,
      response_data: redact(json || bodyText)
    };

    if (this.eventLogger) {
      this.eventLogger(eventRecord);
    }

    if (error) {
      throw error;
    }

    return {
      status: response.status,
      headers: response.headers,
      body: json,
      rawBody: bodyText,
      timings: {
        t_intent,
        t_send,
        t_headers,
        t_body,
        t_parsed,
        t_send_wall,
        t_recv_wall,
        rtt: t_body - t_send
      }
    };
  }
}

// WebSocket Streaming observer
class DemoStreamingObserver {
  constructor(options = {}) {
    this.wsUrl = validateDemoStreamingUrl(DEMO_STREAMING_URL);
    this.ws = null;
    this.cst = null;
    this.securityToken = null;
    this.epic = null;
    this.quoteLogger = options.quoteLogger || null;
    this.eventLogger = options.eventLogger || null;
    this.lastQuote = null;
    this.quotes = [];
  }

  connect(cst, securityToken, epic) {
    this.cst = cst;
    this.securityToken = securityToken;
    this.epic = epic;

    return new Promise((resolve, reject) => {
      try {
        if (isOffline()) throw new Error(OFFLINE_ERROR);
        this.ws = new WebSocket(this.wsUrl);
      } catch (err) {
        return reject(err);
      }

      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timed out'));
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this._authenticateAndSubscribe();
        resolve();
      };

      this.ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this.ws.onerror = (err) => {
        if (this.eventLogger) {
          this.eventLogger({
            event_type: 'STREAMING_ERROR',
            timestamp_utc: new Date().toISOString(),
            error: String(err)
          });
        }
      };

      this.ws.onclose = (event) => {
        if (this.eventLogger) {
          this.eventLogger({
            event_type: 'STREAMING_CLOSED',
            timestamp_utc: new Date().toISOString(),
            code: event.code,
            reason: event.reason
          });
        }
      };
    });
  }

  _authenticateAndSubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Ping / Auth
    this.ws.send(JSON.stringify({
      destination: 'ping',
      correlationId: crypto.randomUUID(),
      cst: this.cst,
      securityToken: this.securityToken
    }));

    // Subscribe to confirms
    this.ws.send(JSON.stringify({
      destination: 'confirms.subscribe',
      correlationId: crypto.randomUUID(),
      cst: this.cst,
      securityToken: this.securityToken,
      payload: {}
    }));

    // Subscribe to market quotes
    if (this.epic) {
      this.ws.send(JSON.stringify({
        destination: 'marketData.subscribe',
        correlationId: crypto.randomUUID(),
        cst: this.cst,
        securityToken: this.securityToken,
        payload: {
          epics: [this.epic]
        }
      }));
    }
  }

  _handleMessage(raw) {
    const t_recv_mono = nowMono();
    const t_recv_utc = new Date().toISOString();

    try {
      const msg = JSON.parse(raw);
      if (msg.destination === 'quote' && msg.payload) {
        const quoteRecord = {
          epic: msg.payload.epic,
          bid: Number(msg.payload.bid),
          ask: Number(msg.payload.ofr),
          server_timestamp_ms: msg.payload.timestamp,
          t_recv_utc,
          t_recv_mono
        };
        this.lastQuote = quoteRecord;
        this.quotes.push(quoteRecord);
        if (this.quoteLogger) {
          this.quoteLogger(quoteRecord);
        }
      } else if (msg.destination === 'confirms') {
        if (this.eventLogger) {
          this.eventLogger({
            event_type: 'STREAMING_CONFIRMATION',
            t_recv_utc,
            t_recv_mono,
            payload: redact(msg.payload)
          });
        }
      } else {
        // REPAIR (stream coverage): anything that is not a quote or a confirmation — including
        // subscription acknowledgements and subscription ERRORS — used to be dropped silently.
        // That is why the pilot capture contains no evidence about whether confirms.subscribe
        // was ever accepted.
        if (this.eventLogger) {
          this.eventLogger({
            event_type: 'STREAMING_OTHER',
            destination: msg.destination || null,
            correlationId: msg.correlationId || null,
            t_recv_utc,
            t_recv_mono,
            payload: redact(msg.payload ?? msg)
          });
        }
      }
    } catch (err) {
      // REPAIR (stream coverage): an unparseable or error frame is evidence, not noise.
      if (this.eventLogger) {
        this.eventLogger({
          event_type: 'STREAMING_UNPARSEABLE',
          t_recv_utc,
          t_recv_mono,
          error_message: err ? err.message : 'parse failure',
          raw: redact(String(raw).slice(0, 500))
        });
      }
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Observer Runner
export class CapitalDemoOrderObserver {
  constructor(options = {}) {
    this.runId = options.runId || new Date().toISOString().replace(/[:.]/g, '-');
    this.outDir = path.resolve(`docs/research/capital-demo-order-data/${this.runId}`);
    fs.mkdirSync(this.outDir, { recursive: true });

    this.eventsPath = path.join(this.outDir, 'events.jsonl');
    this.quotesPath = path.join(this.outDir, 'quotes.jsonl');
    this.ledgerPath = path.join(this.outDir, 'mutation-ledger.jsonl');
    this.ordersCsvPath = path.join(this.outDir, 'orders.csv');
    this.manifestPath = path.join(this.outDir, 'manifest.json');
    this.baselinePath = path.join(this.outDir, 'baseline.json');
    this.finalStatePath = path.join(this.outDir, 'final-state.json');
    this.readmePath = path.join(this.outDir, 'README.md');

    this.ledger = new MutationLedger(this.ledgerPath);
    this.eventsFd = fs.openSync(this.eventsPath, 'a');
    this.quotesFd = fs.openSync(this.quotesPath, 'a');

    this.client = new DemoHttpClient({
      eventLogger: (event) => this.logEvent(event)
    });

    this.streaming = new DemoStreamingObserver({
      quoteLogger: (quote) => this.logQuote(quote),
      eventLogger: (event) => this.logEvent(event)
    });

    this.orders = [];
    this.ownedPositions = new Set();
    this.ownedWorkingOrders = new Set();
    // REPAIR: cleanup outcomes and failures are tracked separately so a run can no longer report
    // success while instructions failed. Previously failures were invisible and ids were dropped
    // from the tracking sets regardless of the response.
    this.cleanupOutcomes = [];
    this.cleanupFailures = [];
    this.streamingMessages = [];
  }

  logEvent(record) {
    const entry = {
      event_id: crypto.randomUUID(),
      timestamp_utc: new Date().toISOString(),
      monotonic_ms: nowMono(),
      ...redact(record)
    };
    fs.writeSync(this.eventsFd, JSON.stringify(entry) + '\n');
  }

  logQuote(record) {
    fs.writeSync(this.quotesFd, JSON.stringify(record) + '\n');
  }

  // 1. Clock Calibration (10 samples)
  async calibrateClock(count = 10) {
    console.log(`⏱ Calibrating clock with ${count} probes to /api/v1/time...`);
    const samples = [];

    for (let i = 0; i < count; i++) {
      const res = await this.client.request('/api/v1/time');

      // REPAIR (dispatch alignment): both anchors come from the request itself, so the interval
      // measured here is exactly the interval the RTT describes. Previously t_send_wall was sampled
      // BEFORE request() performed its rate-limit wait, while `rtt` began after that wait — making
      // offset and uncertainty describe a longer interval than the probe.
      const t_send_wall = res.timings.t_send_wall;
      const t_recv_wall = res.timings.t_recv_wall;
      const rttExact = t_recv_wall - t_send_wall;
      const t_mid_wall = (t_send_wall + t_recv_wall) / 2;

      // Extract server time from body
      const serverTimeMs = res.body && (res.body.serverTime || res.body.time);
      let offset = null;
      if (serverTimeMs) {
        offset = serverTimeMs - t_mid_wall;
      }

      samples.push({
        probe: i + 1,
        rtt_ms: rttExact,
        rtt_monotonic_ms: res.timings.rtt,
        t_send_wall,
        t_recv_wall,
        serverTimeMs,
        offset_ms: offset,
        // The true uncertainty of a midpoint estimate is half the round trip, measured on the
        // same clock as the anchors.
        uncertainty_ms: rttExact / 2,
        clock_domain: 'local_wall_vs_server',
        note: 'Midpoint offset estimate. Only meaningful if the return path is symmetric, which this probe cannot establish.'
      });
    }

    const rtts = samples.map(s => s.rtt_ms).sort((a, b) => a - b);
    const minRtt = rtts[0];
    const medianRtt = rtts[Math.floor(rtts.length / 2)];
    const validOffsets = samples.map(s => s.offset_ms).filter(o => o !== null).sort((a, b) => a - b);
    const medianOffset = validOffsets.length ? validOffsets[Math.floor(validOffsets.length / 2)] : null;

    console.log(`  Clock results: min RTT = ${minRtt.toFixed(2)} ms, median RTT = ${medianRtt.toFixed(2)} ms, estimated offset = ${medianOffset !== null ? medianOffset.toFixed(2) : 'n/a'} ms`);
    return {
      samples,
      minRtt,
      medianRtt,
      medianOffset
    };
  }

  // 2. Authenticate Demo Session
  async authenticate() {
    console.log('🔑 Authenticating demo session on demo-api-capital.backend-capital.com...');
    const creds = loadDemoCredentials();
    this.client.setCredentials(creds);

    const res = await this.client.request('/api/v1/session', {
      method: 'POST',
      body: {
        identifier: creds.user,
        password: creds.password
      }
    });

    if (res.status !== 200) {
      throw new Error(`Authentication failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }

    const activeAccountId = res.body.accountId || (res.body.accounts && res.body.accounts[0]?.accountId);
    console.log(`  Authenticated successfully. Pseudonymized Account: ${pseudonymizeAccount(activeAccountId)}`);
    return {
      pseudonymousAccount: pseudonymizeAccount(activeAccountId),
      rawAccount: activeAccountId,
      sessionDetails: redact(res.body)
    };
  }

  // 3. Snapshot Baseline
  async snapshotState() {
    console.log('📸 Taking account baseline snapshot...');
    const accRes = await this.client.request('/api/v1/accounts');
    const posRes = await this.client.request('/api/v1/positions');
    const woRes = await this.client.request('/api/v1/workingorders');

    const snapshot = {
      timestamp_utc: new Date().toISOString(),
      accounts: redact(accRes.body),
      positions: redact(posRes.body),
      workingOrders: redact(woRes.body)
    };

    return snapshot;
  }

  // 4. Discover Open Instruments
  async discoverInstruments() {
    console.log('🔍 Discovering tradeable instruments on weekend demo...');
    const candidates = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'LTCUSD', 'EURUSD'];
    const results = [];

    for (const epic of candidates) {
      try {
        const res = await this.client.request(`/api/v1/markets/${epic}`);
        if (res.status === 200 && res.body) {
          const snapshot = res.body.snapshot || {};
          const rules = res.body.dealingRules || {};
          const isTradeable = snapshot.marketStatus === 'TRADEABLE';
          results.push({
            epic,
            marketStatus: snapshot.marketStatus,
            isTradeable,
            bid: snapshot.bid,
            ask: snapshot.offer,
            minDealSize: rules.minDealSize?.value || 0.01,
            minSizeIncrement: rules.minSizeIncrement?.value || 0.01,
            minStepDistance: rules.minStepDistance?.value || 1,
            decimalPlaces: snapshot.decimalPlacesFactor || 2
          });
        }
      } catch (err) {
        console.warn(`  Failed inspecting epic ${epic}: ${err.message}`);
      }
    }

    return results;
  }

  // Helper to poll confirm with robust fallback
  async pollConfirm(dealReference, maxAttempts = 15) {
    let lastBody = null;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 400));
      const res = await this.client.request(`/api/v1/confirms/${dealReference}`);
      if (res.status === 200 && res.body) {
        lastBody = res.body;
        const status = res.body.dealStatus || res.body.status;
        if (status && status !== 'PENDING') {
          return res.body;
        }
      }
    }
    return lastBody;
  }

  // Find active position dealId by epic if not found in confirm
  async findPositionDealId(epic) {
    const res = await this.client.request('/api/v1/positions');
    if (res.status === 200 && res.body?.positions) {
      const match = res.body.positions.find(p => (p.position?.epic === epic || p.epic === epic));
      if (match) return match.position?.dealId || match.dealId;
    }
    return null;
  }

  // Find active working order dealId by epic if not found in confirm
  async findWorkingOrderDealId(epic) {
    const res = await this.client.request('/api/v1/workingorders');
    if (res.status === 200 && res.body?.workingOrders) {
      const match = res.body.workingOrders.find(w => (w.workingOrderData?.epic === epic || w.epic === epic));
      if (match) return match.workingOrderData?.dealId || match.dealId;
    }
    return null;
  }

  // Stage 1 Pilot: Market, Limit, Stop
  async runPilot(selectedEpic = 'BTCUSD') {
    console.log(`🚀 Commencing Stage 1 Pilot Experiments on ${selectedEpic}...`);
    const instrumentInfo = (await this.discoverInstruments()).find(i => i.epic === selectedEpic);
    if (!instrumentInfo || !instrumentInfo.isTradeable) {
      throw new Error(`Epic ${selectedEpic} is not tradeable. MarketStatus: ${instrumentInfo?.marketStatus}`);
    }

    const minSize = instrumentInfo.minDealSize || 0.01;
    console.log(`  Instrument ${selectedEpic} is TRADEABLE. Min size: ${minSize}, Bid: ${instrumentInfo.bid}, Ask: ${instrumentInfo.ask}`);

    // Connect WebSocket streaming
    console.log('📡 Starting quote & confirmation WebSocket stream...');
    await this.streaming.connect(this.client.cst, this.client.securityToken, selectedEpic);

    // Wait 3 seconds to accumulate quote stream
    await new Promise(r => setTimeout(r, 3000));
    console.log(`  Streaming active. Last observed quote: Bid=${this.streaming.lastQuote?.bid}, Ask=${this.streaming.lastQuote?.ask}`);

    // --- EXPERIMENT 1: MARKET BUY ---
    console.log('\n--- Experiment 1: Market BUY ---');
    await this._runMarketSample('BUY', selectedEpic, minSize);

    // Pause between samples
    await new Promise(r => setTimeout(r, 2000));

    // --- EXPERIMENT 2: RESTING LIMIT ORDER ---
    console.log('\n--- Experiment 2: Resting Limit Order ---');
    await this._runLimitSample('BUY', selectedEpic, minSize, instrumentInfo);

    // Pause between samples
    await new Promise(r => setTimeout(r, 2000));

    // --- EXPERIMENT 3: RESTING STOP ORDER ---
    console.log('\n--- Experiment 3: Resting Stop Order ---');
    await this._runStopSample('BUY', selectedEpic, minSize, instrumentInfo);

    console.log('\n🎉 Pilot run finished! Writing final state and report data...');
  }

  async _runMarketSample(direction, epic, size) {
    const sampleId = `PILOT-MKT-${direction}-${Date.now()}`;
    const preQuote = this.streaming.lastQuote;
    const t_intent = nowMono();

    // 1. Record intent to ledger
    this.ledger.record({
      mutation_type: 'INTENT_SUBMIT_MARKET',
      sample_id: sampleId,
      direction,
      epic,
      size,
      pre_quote: preQuote
    });

    // 2. Submit order
    const res = await this.client.request('/api/v1/positions', {
      method: 'POST',
      body: { epic, direction, size },
      t_intent
    });

    const dealReference = res.body?.dealReference;
    const postResponseMs = res.timings.rtt;

    let confirm = null;
    let dealId = null;
    let fillPrice = null;
    let fillObservedMono = null;

    if (dealReference) {
      this.ledger.record({
        mutation_type: 'MARKET_SUBMITTED',
        sample_id: sampleId,
        dealReference,
        status: res.status
      });

      confirm = await this.pollConfirm(dealReference);
      fillObservedMono = nowMono();

      if (confirm) {
        dealId = confirm.dealId || (confirm.affectedDeals && confirm.affectedDeals[0]?.dealId);
        if (!dealId) {
          dealId = await this.findPositionDealId(epic);
        }
        fillPrice = confirm.level;
        if (dealId) this.ownedPositions.add(dealId);

        this.ledger.record({
          mutation_type: 'MARKET_CONFIRMED',
          sample_id: sampleId,
          dealReference,
          dealId,
          fillPrice,
          dealStatus: confirm.dealStatus,
          status: confirm.status
        });
      }
    }

    const submitToFillMs = fillObservedMono ? fillObservedMono - res.timings.t_send : null;
    console.log(`  Market ${direction} result: dealReference=${dealReference}, dealId=${dealId}, fillPrice=${fillPrice}, POST ms=${postResponseMs.toFixed(1)}, submit-to-fill ms=${submitToFillMs?.toFixed(1) || 'n/a'}`);

    this.orders.push({
      sample_id: sampleId,
      order_type: 'MARKET',
      direction,
      epic,
      size,
      level: 'N/A',
      pre_quote_bid: preQuote?.bid,
      pre_quote_ask: preQuote?.ask,
      post_response_ms: postResponseMs.toFixed(1),
      submit_to_fill_ms: submitToFillMs ? submitToFillMs.toFixed(1) : 'N/A',
      dealReference,
      dealId,
      fill_price: fillPrice || 'N/A',
      outcome: confirm?.dealStatus || (res.status === 200 ? 'SUBMITTED' : 'FAILED')
    });

    // Cleanup: Close position
    if (dealId) {
      console.log(`  Closing position ${dealId}...`);
      await this.cleanupPosition(dealId, sampleId);
    }
  }

  async _runLimitSample(direction, epic, size, info) {
    const sampleId = `PILOT-LMT-${direction}-${Date.now()}`;
    const preQuote = this.streaming.lastQuote;
    const currentPrice = direction === 'BUY' ? preQuote?.ask : preQuote?.bid;

    // Resting level: for BUY limit, set below market (e.g. 50 ticks below)
    const tick = info.minStepDistance || 1;
    const offset = tick * 30;
    const targetLevel = direction === 'BUY' ? Number((currentPrice - offset).toFixed(info.decimalPlaces)) : Number((currentPrice + offset).toFixed(info.decimalPlaces));

    const t_intent = nowMono();
    this.ledger.record({
      mutation_type: 'INTENT_SUBMIT_LIMIT',
      sample_id: sampleId,
      direction,
      epic,
      size,
      level: targetLevel,
      pre_quote: preQuote
    });

    const res = await this.client.request('/api/v1/workingorders', {
      method: 'POST',
      body: {
        epic,
        direction,
        size,
        level: targetLevel,
        type: 'LIMIT'
      },
      t_intent
    });

    const dealReference = res.body?.dealReference;
    const postResponseMs = res.timings.rtt;
    let confirm = null;
    let dealId = null;

    if (dealReference) {
      this.ledger.record({
        mutation_type: 'LIMIT_SUBMITTED',
        sample_id: sampleId,
        dealReference,
        status: res.status
      });

      confirm = await this.pollConfirm(dealReference);
      if (confirm) {
        dealId = confirm.dealId || (confirm.affectedDeals && confirm.affectedDeals[0]?.dealId);
        if (!dealId) {
          dealId = await this.findWorkingOrderDealId(epic);
        }
        if (dealId) this.ownedWorkingOrders.add(dealId);

        this.ledger.record({
          mutation_type: 'LIMIT_CONFIRMED_WORKING',
          sample_id: sampleId,
          dealReference,
          dealId,
          dealStatus: confirm.dealStatus,
          status: confirm.status
        });
      }
    }

    console.log(`  Limit ${direction} working order placed: level=${targetLevel}, dealReference=${dealReference}, dealId=${dealId}, POST ms=${postResponseMs.toFixed(1)}`);

    // Bounded waiting (10 seconds)
    console.log('  Observing resting limit for 10 seconds...');
    await new Promise(r => setTimeout(r, 10000));

    // Cleanup: Cancel working order
    if (dealId) {
      console.log(`  Canceling resting limit order ${dealId}...`);
      await this.cleanupWorkingOrder(dealId, sampleId);
    }

    this.orders.push({
      sample_id: sampleId,
      order_type: 'LIMIT',
      direction,
      epic,
      size,
      level: targetLevel,
      pre_quote_bid: preQuote?.bid,
      pre_quote_ask: preQuote?.ask,
      post_response_ms: postResponseMs.toFixed(1),
      submit_to_fill_ms: 'UNTRIGGERED_RESTING',
      dealReference,
      dealId,
      fill_price: 'N/A',
      outcome: confirm?.dealStatus || 'CANCELLED_CLEANUP'
    });
  }

  async _runStopSample(direction, epic, size, info) {
    const sampleId = `PILOT-STP-${direction}-${Date.now()}`;
    const preQuote = this.streaming.lastQuote;
    const currentPrice = direction === 'BUY' ? preQuote?.ask : preQuote?.bid;

    // Resting level: for BUY stop, set above market (e.g. 50 ticks above)
    const tick = info.minStepDistance || 1;
    const offset = tick * 30;
    const targetLevel = direction === 'BUY' ? Number((currentPrice + offset).toFixed(info.decimalPlaces)) : Number((currentPrice - offset).toFixed(info.decimalPlaces));

    const t_intent = nowMono();
    this.ledger.record({
      mutation_type: 'INTENT_SUBMIT_STOP',
      sample_id: sampleId,
      direction,
      epic,
      size,
      level: targetLevel,
      pre_quote: preQuote
    });

    const res = await this.client.request('/api/v1/workingorders', {
      method: 'POST',
      body: {
        epic,
        direction,
        size,
        level: targetLevel,
        type: 'STOP'
      },
      t_intent
    });

    const dealReference = res.body?.dealReference;
    const postResponseMs = res.timings.rtt;
    let confirm = null;
    let dealId = null;

    if (dealReference) {
      this.ledger.record({
        mutation_type: 'STOP_SUBMITTED',
        sample_id: sampleId,
        dealReference,
        status: res.status
      });

      confirm = await this.pollConfirm(dealReference);
      if (confirm) {
        dealId = confirm.dealId || (confirm.affectedDeals && confirm.affectedDeals[0]?.dealId);
        if (!dealId) {
          dealId = await this.findWorkingOrderDealId(epic);
        }
        if (dealId) this.ownedWorkingOrders.add(dealId);

        this.ledger.record({
          mutation_type: 'STOP_CONFIRMED_WORKING',
          sample_id: sampleId,
          dealReference,
          dealId,
          dealStatus: confirm.dealStatus,
          status: confirm.status
        });
      }
    }

    console.log(`  Stop ${direction} working order placed: level=${targetLevel}, dealReference=${dealReference}, dealId=${dealId}, POST ms=${postResponseMs.toFixed(1)}`);

    // Bounded waiting (10 seconds)
    console.log('  Observing resting stop for 10 seconds...');
    await new Promise(r => setTimeout(r, 10000));

    // Cleanup: Cancel working order
    if (dealId) {
      console.log(`  Canceling resting stop order ${dealId}...`);
      await this.cleanupWorkingOrder(dealId, sampleId);
    }

    this.orders.push({
      sample_id: sampleId,
      order_type: 'STOP',
      direction,
      epic,
      size,
      level: targetLevel,
      pre_quote_bid: preQuote?.bid,
      pre_quote_ask: preQuote?.ask,
      post_response_ms: postResponseMs.toFixed(1),
      submit_to_fill_ms: 'UNTRIGGERED_RESTING',
      dealReference,
      dealId,
      fill_price: 'N/A',
      outcome: confirm?.dealStatus || 'CANCELLED_CLEANUP'
    });
  }

  async cleanupPosition(dealId, sampleId) {
    this.ledger.record({
      mutation_type: 'INTENT_CLEANUP_CLOSE_POSITION',
      sample_id: sampleId,
      dealId
    });

    const res = await this.client.request(`/api/v1/positions/${dealId}`, {
      method: 'DELETE'
    });

    const dealRef = res.body?.dealReference;
    let confirm = null;
    if (dealRef) {
      confirm = await this.pollConfirm(dealRef);
      this.ledger.record({
        mutation_type: 'CLEANUP_POSITION_CONFIRMED',
        sample_id: sampleId,
        dealId,
        dealReference: dealRef,
        confirm: redact(confirm)
      });
    }

    // REPAIR (cleanup must be judged, not assumed): the previous code deleted the id from the
    // tracked set unconditionally, so a 404 (as happened in the pilot) still looked like a clean
    // run. Only a confirmed CLOSED removes the position from the unresolved set.
    const closed = res.status === 200 && (!dealRef || confirm?.status === 'CLOSED');
    if (closed) {
      this.ownedPositions.delete(dealId);
      this.cleanupOutcomes.push({ kind: 'POSITION', dealId, sampleId, status: res.status, confirmed: true });
    } else {
      this.cleanupFailures.push({
        kind: 'POSITION',
        dealId,
        sampleId,
        status: res.status,
        errorCode: res.body?.errorCode || null,
        confirmStatus: confirm?.status || null,
        reason: res.status === 404
          ? 'Position id not found — the id may be a SUBMISSION id or the position was already closed.'
          : 'Cleanup did not return a confirmed CLOSED state.'
      });
    }
    return closed;
  }

  async cleanupWorkingOrder(dealId, sampleId) {
    this.ledger.record({
      mutation_type: 'INTENT_CLEANUP_CANCEL_WORKING_ORDER',
      sample_id: sampleId,
      dealId
    });

    const res = await this.client.request(`/api/v1/workingorders/${dealId}`, {
      method: 'DELETE'
    });

    // REPAIR: a 404 here is NOT a crash and NOT a success. It usually means the working order was
    // already CONSUMED by triggering (exactly what happened to the pilot's stop), which produced a
    // position that now needs closing instead. Record it and let the snapshot pass resolve it.
    if (res.status === 404) {
      this.cleanupFailures.push({
        kind: 'WORKING_ORDER',
        dealId,
        sampleId,
        status: res.status,
        errorCode: res.body?.errorCode || null,
        reason: 'Working order not found — most likely already consumed by triggering. The resulting position, if any, is resolved from the final snapshot.'
      });
      this.ownedWorkingOrders.delete(dealId);
      return false;
    }

    const dealRef = res.body?.dealReference;
    if (dealRef) {
      const confirm = await this.pollConfirm(dealRef);
      this.ledger.record({
        mutation_type: 'CLEANUP_WORKING_ORDER_CONFIRMED',
        sample_id: sampleId,
        dealId,
        dealReference: dealRef,
        confirm: redact(confirm)
      });
    }

    this.ownedWorkingOrders.delete(dealId);
  }

  async writeArtifacts(preCalibration, postCalibration, sessionInfo, baseline, finalSnapshot) {
    console.log('💾 Writing final research artifacts to disk...');

    // REPAIR (observed final state): read what the broker says, rather than trusting tracking sets.
    const observedPositions = (finalSnapshot?.positions?.positions || finalSnapshot?.positions || [])
      .map((p) => p?.position ?? p)
      .filter(Boolean)
      .map((p) => p.dealId);
    const observedWorkingOrders = (finalSnapshot?.workingOrders?.workingOrders || finalSnapshot?.workingOrders || [])
      .map((w) => w?.workingOrderData ?? w)
      .filter(Boolean)
      .map((w) => w.dealId);

    // REPAIR (outcome persistence): write the OBSERVED outcome back onto each order row, so the CSV
    // cannot end up asserting UNTRIGGERED_RESTING for an order that actually triggered and filled.
    for (const order of this.orders) {
      const matchedPosition = observedPositions.includes(order.dealId);
      const stillWorking = observedWorkingOrders.includes(order.dealId);
      if (matchedPosition && order.submit_to_fill_ms === 'UNTRIGGERED_RESTING') {
        order.outcome = 'FILLED';
        order.outcome_source = 'RECONCILED_FROM_FINAL_SNAPSHOT';
        order.outcome_note = `Original row read "${order.submit_to_fill_ms}" for submit_to_fill_ms, but a position with this working order id is present in the final snapshot.`;
        order.submit_to_fill_ms = 'OBSERVATION_GAP_NOT_EXECUTION_TIME';
      } else if (stillWorking) {
        order.outcome = 'RESTING';
      } else if (!matchedPosition && order.submit_to_fill_ms === 'UNTRIGGERED_RESTING') {
        order.outcome = 'NOT_FILLED_OR_CLOSED';
      }
    }

    // 1. orders.csv
    const csvHeaders = 'sample_id,order_type,direction,epic,size,level,pre_quote_bid,pre_quote_ask,post_response_ms,submit_to_fill_ms,dealReference,dealId,fill_price,outcome\n';
    const csvRows = this.orders.map(o =>
      [o.sample_id, o.order_type, o.direction, o.epic, o.size, o.level, o.pre_quote_bid, o.pre_quote_ask, o.post_response_ms, o.submit_to_fill_ms, o.dealReference, o.dealId, o.fill_price, o.outcome].join(',')
    ).join('\n');
    fs.writeFileSync(this.ordersCsvPath, csvHeaders + csvRows, 'utf8');

    // 2. baseline.json & final-state.json
    fs.writeFileSync(this.baselinePath, JSON.stringify(baseline, null, 2), 'utf8');
    fs.writeFileSync(this.finalStatePath, JSON.stringify(finalSnapshot, null, 2), 'utf8');

    // 3. manifest.json
    const manifest = {
      run_id: this.runId,
      timestamp_utc: new Date().toISOString(),
      environment: 'DEMO',
      demo_rest_origin: DEMO_REST_ORIGIN,
      demo_streaming_url: DEMO_STREAMING_URL,
      pseudonymous_account: sessionInfo.pseudonymousAccount,
      clock_calibration: {
        pre: preCalibration,
        post: postCalibration
      },
      order_count: this.orders.length,
      // REPAIR (observed final state): resolution is derived from the FINAL SNAPSHOT the broker
      // actually returned, not from the collector's own tracking sets. In the pilot those sets
      // were emptied by unconditional deletes while two positions were still open, so the manifest
      // claimed a clean end state the account did not have.
      unresolved_positions: observedPositions,
      unresolved_working_orders: observedWorkingOrders,
      cleanup: {
        succeeded: this.cleanupFailures.length === 0 && observedPositions.length === 0 && observedWorkingOrders.length === 0,
        outcomes: this.cleanupOutcomes,
        failures: this.cleanupFailures
      },
      streaming: {
        messages_recorded: this.streamingMessages.length,
        note: 'Non-quote, non-confirmation frames (including subscription results and errors) are now recorded as STREAMING_OTHER events.'
      }
    };
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // 4. README.md
    const readme = `# Capital.com Demo Order Observation Run ${this.runId}

## Artifact Description
- \`manifest.json\`: Run settings, clock calibration, account alias, and integrity outcomes.
- \`events.jsonl\`: Full REST and WebSocket confirmation timeline with monotonic stamps.
- \`quotes.jsonl\`: Continuous streaming tick tape captured during the run.
- \`mutation-ledger.jsonl\`: Durable, synchronously flushed mutation ledger.
- \`orders.csv\`: Tabular experiment entries and metrics.
- \`baseline.json\`: Pre-run account and order snapshot.
- \`final-state.json\`: Post-run account and order snapshot.

## Execution Guard Proof
All network communications strictly locked to:
- REST: \`${DEMO_REST_ORIGIN}\`
- Streaming: \`${DEMO_STREAMING_URL}\`
All credentials and account IDs sanitized and pseudonymized.
`;
    fs.writeFileSync(this.readmePath, readme, 'utf8');

    // Close streaming first so its onclose event can be safely logged
    this.streaming.close();
    // Allow brief event loop tick for stream termination
    await new Promise(r => setTimeout(r, 100));

    // Close open descriptors
    try { fs.closeSync(this.eventsFd); } catch {}
    try { fs.closeSync(this.quotesFd); } catch {}
    console.log(`✅ All artifacts saved in ${this.outDir}`);
  }
}

// CLI entrypoint
async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || '--pilot';

  console.log(`=== Capital.com Demo Order Observer === [Action: ${action}]`);

  const observer = new CapitalDemoOrderObserver();

  try {
    if (action === '--calibrate') {
      const cal = await observer.calibrateClock(10);
      console.log('Calibration complete:', cal);
      return;
    }

    if (action === '--discover') {
      await observer.authenticate();
      const markets = await observer.discoverInstruments();
      console.log('Tradeable instruments:', markets);
      return;
    }

    if (action === '--pilot') {
      // 1. Clock pre-calibration
      const preCal = await observer.calibrateClock(10);

      // 2. Authenticate
      const sessionInfo = await observer.authenticate();

      // 3. Baseline snapshot
      const baseline = await observer.snapshotState();

      // 4. Discover tradeable markets
      const markets = await observer.discoverInstruments();
      const openMarket = markets.find(m => m.isTradeable);
      if (!openMarket) {
        throw new Error('No tradeable markets found currently on weekend demo.');
      }
      console.log(`Targeting tradeable market: ${openMarket.epic}`);

      // 5. Run Pilot Experiments
      await observer.runPilot(openMarket.epic);

      // 6. Post-calibration
      const postCal = await observer.calibrateClock(10);

      // 7. Final snapshot
      const finalSnapshot = await observer.snapshotState();

      // 8. Write artifacts
      await observer.writeArtifacts(preCal, postCal, sessionInfo, baseline, finalSnapshot);

      // REPAIR (gated success): the previous message was unconditional. A run is only clean if the
      // final snapshot shows no positions and no working orders AND no cleanup instruction failed.
      const leftovers =
        (finalSnapshot?.positions?.positions || finalSnapshot?.positions || []).length +
        (finalSnapshot?.workingOrders?.workingOrders || finalSnapshot?.workingOrders || []).length;
      const failures = observer.cleanupFailures.length;
      if (leftovers === 0 && failures === 0) {
        console.log('\n✅ Pilot completed with a VERIFIED clean end state (no positions, no working orders, no failed cleanup).');
      } else {
        console.error(
          `\n❌ Pilot did NOT end clean: ${leftovers} leftover account object(s) and ${failures} failed cleanup instruction(s). ` +
          'Report is written but MUST NOT be treated as a clean run. See manifest.cleanup.failures.'
        );
        process.exitCode = 2;
      }
    }
  } catch (err) {
    console.error('CRITICAL RUNTIME ERROR:', err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('capital-demo-order-observer.mjs')) {
  main();
}
