/**
 * apiMock.ts
 * ---------------------------------------------------------------------------
 * Playwright network-layer mock for the Market Rewind replay journey suite.
 *
 * The app talks to a DuckDB streaming service over REST. In the browser every
 * request is relative to `window.location.origin`, so we intercept the calls
 * with `page.route` BEFORE they reach the Vite proxy and answer them with the
 * deterministic synthetic market from `marketSimulator.ts`. This makes the
 * entire replay + trading journey runnable with zero external dependencies.
 *
 * Endpoints mocked:
 *   GET /api/status                     → health probe (useDatabase)
 *   GET /api/symbols                    → symbol list (useDatabase)
 *   GET /api/symbols/:sym               → per-symbol metadata
 *   GET /api/ticks                      → raw tick prints (App + useChartData)
 *   GET /api/candles                    → intraday/daily OHLCV (useChartData + useMarketSimulator)
 *   GET /api/streaming/candles          → sub-second OHLCV (useChartData)
 *   GET /api/stream/tape                → Time & Sales tape (getLiveTape)
 */

import type { Page, Route } from '@playwright/test';
import {
  MOCK_SYMBOLS,
  BASE_PRICES,
  queryTicks,
  queryCandles,
  queryTape,
  tfTokenToSeconds,
  isTradingDay,
} from './marketSimulator';

export interface MockMarketOptions {
  /** Symbols advertised by /api/symbols. Defaults to the full mock universe. */
  symbols?: string[];
  /** Force /api/status to report the backend offline (boot-failure scenarios). */
  offline?: boolean;
  /** Return empty tick + candle payloads (simulates a truly empty market). */
  emptyMarket?: boolean;
  /** Simulate network latency (ms) applied to every response. */
  latencyMs?: number;
  /** Total tick count advertised in the status payload. */
  tickCount?: number;
}

export interface MockMarketHandle {
  /** Per-endpoint request counters, keyed by a short name. */
  counts: Record<string, number>;
  /** Last query params seen for a given endpoint (handy for assertions). */
  lastTicksQuery: URLSearchParams | null;
  lastCandlesQuery: URLSearchParams | null;
}

const json = (route: Route, body: unknown, latencyMs = 0) => {
  const fulfill = () =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  if (latencyMs > 0) setTimeout(fulfill, latencyMs);
  else fulfill();
};

/** Parse an app-supplied "YYYY-MM-DD HH:MM:SS[.mmm]" (UTC) string to epoch ms. */
function toMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZ = normalized.includes('Z') ? normalized : normalized + 'Z';
  const ms = new Date(withZ).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

export async function installApiMocks(page: Page, options: MockMarketOptions = {}): Promise<MockMarketHandle> {
  const symbols = options.symbols ?? MOCK_SYMBOLS;
  const latency = options.latencyMs ?? 0;
  const tickCount = options.tickCount ?? 40_900_000;

  const handle: MockMarketHandle = {
    counts: {},
    lastTicksQuery: null,
    lastCandlesQuery: null,
  };
  const bump = (name: string) => (handle.counts[name] = (handle.counts[name] ?? 0) + 1);

  // --- Health probe -------------------------------------------------------
  await page.route(/\/api\/status(\?|$)/, (route) => {
    bump('status');
    if (options.offline) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'OFFLINE' }) });
    }
    return json(
      route,
      {
        status: 'OK',
        streaming_db: {
          path: 'mock://streaming.duckdb',
          exists: true,
          size_bytes: 1_234_567_890,
          tick_count: tickCount,
        },
      },
      latency,
    );
  });

  // --- Symbol list --------------------------------------------------------
  await page.route(/\/api(\/streaming)?\/symbols(\?|$)/, (route) => {
    bump('symbols');
    return json(
      route,
      symbols.map((s) => ({
        symbol: s,
        tick_count: tickCount,
        first_tick: '2025-01-02 14:30:00',
        last_tick: '2026-09-25 20:00:00',
      })),
      latency,
    );
  });

  // --- Per-symbol metadata ------------------------------------------------
  await page.route(/\/api\/symbols\/[^/?]+/, (route) => {
    bump('symbolSummary');
    const url = new URL(route.request().url());
    const sym = decodeURIComponent(url.pathname.split('/').pop() || '').toUpperCase();
    return json(
      route,
      {
        symbol: sym,
        tick_count: BASE_PRICES[sym] ? tickCount : 0,
        first_tick: '2025-01-02 14:30:00',
        last_tick: '2026-09-25 20:00:00',
      },
      latency,
    );
  });

  // --- Raw ticks ----------------------------------------------------------
  await page.route(/\/api\/ticks(\?|$)/, (route) => {
    bump('ticks');
    const url = new URL(route.request().url());
    const q = url.searchParams;
    handle.lastTicksQuery = new URLSearchParams(q);
    const symbol = (q.get('symbol') || 'SPY').toUpperCase();
    const ticks = options.emptyMarket
      ? []
      : queryTicks(symbol, {
          startMs: toMs(q.get('start_time')),
          endMs: toMs(q.get('end_time')),
          limit: q.get('limit') ? Number(q.get('limit')) : undefined,
          offset: q.get('offset') ? Number(q.get('offset')) : undefined,
        });
    return json(route, ticks, latency);
  });

  // --- Streaming candles (intraday, daily, sub-second) ---------------------
  await page.route(/\/api\/streaming\/candles(\?|$)/, (route) => {
    bump('streamingCandles');
    const url = new URL(route.request().url());
    const q = url.searchParams;
    handle.lastCandlesQuery = new URLSearchParams(q);
    const symbol = (q.get('symbol') || 'SPY').toUpperCase();
    const tf = tfTokenToSeconds(q.get('tf') || q.get('timeframe') || '1m');
    const rows = options.emptyMarket
      ? []
      : queryCandles(symbol, tf, {
          startMs: toMs(q.get('start')),
          endMs: toMs(q.get('end')),
          limit: q.get('limit') ? Number(q.get('limit')) : undefined,
        });
    return json(route, rows, latency);
  });

  // --- Intraday / daily candles ------------------------------------------
  await page.route(/\/api\/candles(\?|$)/, (route) => {
    bump('candles');
    const url = new URL(route.request().url());
    const q = url.searchParams;
    handle.lastCandlesQuery = new URLSearchParams(q);
    const symbol = (q.get('symbol') || 'SPY').toUpperCase();
    const tf = tfTokenToSeconds(q.get('tf') || q.get('timeframe') || '1m');
    const rows = options.emptyMarket
      ? []
      : queryCandles(symbol, tf, {
          startMs: toMs(q.get('start')),
          endMs: toMs(q.get('end')),
          limit: q.get('limit') ? Number(q.get('limit')) : undefined,
        });
    return json(route, rows, latency);
  });

  // --- Time & Sales tape --------------------------------------------------
  await page.route(/\/api\/stream\/tape(\?|$)/, (route) => {
    bump('tape');
    const url = new URL(route.request().url());
    const q = url.searchParams;
    const symbol = (q.get('symbol') || 'SPY').toUpperCase();
    const limit = q.get('limit') ? Number(q.get('limit')) : 50;
    const rows = options.emptyMarket ? [] : queryTape(symbol, Date.now() + 86_400_000, limit);
    return json(route, rows, latency);
  });

  return handle;
}

/** Convenience: is the given date a trading day in the mock universe? */
export function mockIsTradingDay(date: string): boolean {
  return isTradingDay(date);
}
