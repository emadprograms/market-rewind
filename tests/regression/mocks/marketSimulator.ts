/**
 * marketSimulator.ts
 * ---------------------------------------------------------------------------
 * Deterministic, fully-offline synthetic market for the Market Rewind replay
 * journey Playwright suite.
 *
 * A single source of truth (a seeded random-walk price series per symbol+day)
 * is used to derive BOTH:
 *   • raw tick-by-tick prints (served by `/api/ticks`), and
 *   • OHLCV candles at ANY requested timeframe (served by `/api/candles` and
 *     `/api/streaming/candles`).
 *
 * Determinism: each trading day's data is a PURE function of (symbol, date) —
 * the seed depends only on those two values. A given calendar day therefore
 * always produces identical prices no matter which request/window generated it,
 * which keeps multi-day history stable across initial load + infinite scroll.
 *
 * Time handling mirrors the app exactly (see src/lib/timezones.ts):
 *   • ticks/candles are stamped in UTC ("YYYY-MM-DD HH:MM:SS[.mmm]")
 *   • the "09:20 ET" entry anchor and the RTH window are converted ET→UTC
 *     using a DST-aware offset, so the data lines up with the app's cursor.
 */

export interface SyntheticTick {
  time: string; // "YYYY-MM-DD HH:MM:SS.mmm" (UTC)
  symbol: string;
  price: number;
  volume: number;
  bid: number;
  ask: number;
  session: 'REG' | 'PRE' | 'POST';
  source: 'STREAMING';
}

/** 1-minute bar — the canonical intraday resolution we aggregate everything from. */
export interface SyntheticBar {
  time: string; // "YYYY-MM-DD HH:MM:SS" (UTC, minute-aligned)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: string;
}

/** Candle row exactly as the DuckDB backend would return it. */
export interface CandleRow {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: string;
  tick_count: number;
}

/** Everything synthesised for one (symbol, trading-day). */
export interface DayMarket {
  symbol: string;
  date: string;
  ticks: SyntheticTick[];
  minuteBars: SyntheticBar[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Realistic base prices so range assertions (e.g. SPY 700–850) hold. */
export const BASE_PRICES: Record<string, number> = {
  SPY: 768,
  QQQ: 515,
  AAPL: 255,
  MSFT: 505,
  AMD: 210,
  NVDA: 178,
  TSLA: 262,
  GOOGL: 195,
  AMZN: 228,
  MU: 108,
};

/** The symbols advertised by `/api/symbols`. */
export const MOCK_SYMBOLS = Object.keys(BASE_PRICES);

/** US market holidays observed by the mock (kept intentionally small). */
const HOLIDAYS = new Set<string>([
  '2026-09-07', // Labor Day
  '2025-07-04',
  '2025-12-25',
  '2026-01-01',
]);

/** Entry anchor (ET) the app defaults to and the RTH close. */
const ET_OPEN = '09:20';
const ET_RTH_OPEN = '09:30';
const ET_CLOSE = '16:00';

/** Tick cadence in seconds. 1s = dense "tick-by-tick"; raise to shrink payloads. */
const TICK_INTERVAL_SEC = Number(process.env.MOCK_TICK_INTERVAL_SEC || 1);

/** How many prior trading days of history to synthesise (chart "context"). */
const PRIOR_TRADING_DAYS = 10;

// ---------------------------------------------------------------------------
// Small deterministic PRNG (mulberry32) + string hash
// ---------------------------------------------------------------------------

function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Time helpers (DST-aware, mirroring src/lib/timezones.ts)
// ---------------------------------------------------------------------------

function etOffsetHours(dateStr: string): number {
  const probe = new Date(`${dateStr}T14:00:00Z`);
  const nyHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(probe),
    10,
  );
  return 14 - nyHour;
}

/** UTC epoch ms for a given calendar date + ET wall-clock time. */
function etToUtcMs(dateStr: string, etTime: string): number {
  const [hh, mm] = etTime.split(':').map(Number);
  const localMs = new Date(
    `${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
  ).getTime();
  return localMs + etOffsetHours(dateStr) * 3600000;
}

/** "YYYY-MM-DD HH:MM:SS.mmm" (UTC) from epoch ms. */
function msToTickTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 23);
}

/** "YYYY-MM-DD HH:MM:SS" (UTC) from epoch ms. */
function msToBarTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** Calendar date ("YYYY-MM-DD", UTC) for an epoch ms. */
function utcDateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ET calendar date ("YYYY-MM-DD") for a UTC epoch ms. */
function etDateOf(utcMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(utcMs));
}

export function isWeekend(dateStr: string): boolean {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

export function isTradingDay(dateStr: string): boolean {
  return !isWeekend(dateStr) && !HOLIDAYS.has(dateStr);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Core per-day generator
// ---------------------------------------------------------------------------

const dayCache = new Map<string, DayMarket>();

function buildDay(symbol: string, date: string): DayMarket {
  const sym = symbol.toUpperCase();
  const empty: DayMarket = { symbol: sym, date, ticks: [], minuteBars: [] };
  if (!isTradingDay(date)) return empty;

  const base = BASE_PRICES[sym] ?? 100;
  const rng = mulberry32(hashString(`${sym}:${date}`));

  const openMs = etToUtcMs(date, ET_OPEN);
  const rthOpenMs = etToUtcMs(date, ET_RTH_OPEN);
  const closeMs = etToUtcMs(date, ET_CLOSE);

  // Independent per-day shape: a daily open offset plus an intraday drift.
  const openOffset = (rng() - 0.5) * base * 0.01; // ±0.5% open vs base
  const dayOpen = base + openOffset;
  const dayDrift = (rng() - 0.5) * base * 0.012; // ±0.6% across the session
  const totalSec = Math.max(1, Math.floor((closeMs - openMs) / 1000));

  const ticks: SyntheticTick[] = [];
  const minuteMap = new Map<
    number,
    { open: number; high: number; low: number; close: number; volume: number; session: string; count: number }
  >();

  const emit = (tMs: number, p: number, vol: number, session: 'PRE' | 'REG') => {
    const minuteKey = Math.floor(tMs / 60000) * 60000;
    let b = minuteMap.get(minuteKey);
    if (!b) {
      b = { open: p, high: p, low: p, close: p, volume: 0, session, count: 0 };
      minuteMap.set(minuteKey, b);
    }
    b.high = Math.max(b.high, p);
    b.low = Math.min(b.low, p);
    b.close = p;
    b.volume += vol;
    b.count += 1;
  };

  // Dense tick-by-tick walk from the 09:20 anchor through the RTH close.
  // Ticks span the pre-open window (for the tape + forming candle), but completed
  // minute bars are only built from the regular session (09:30 ET onward) so the
  // historical chart's completed candles start at the RTH open.
  for (let s = 0; s <= totalSec; s += TICK_INTERVAL_SEC) {
    const tMs = openMs + s * 1000;
    const progress = s / totalSec;
    const noise = (rng() - 0.5) * base * 0.0009;
    const p = round2(dayOpen + dayDrift * progress + noise);
    const vol = Math.floor(15 + rng() * 485);
    const session = tMs < rthOpenMs ? 'PRE' : 'REG';
    ticks.push({
      time: msToTickTime(tMs),
      symbol: sym,
      price: p,
      volume: vol,
      bid: round2(p - 0.01),
      ask: round2(p + 0.01),
      session,
      source: 'STREAMING',
    });
    if (tMs >= rthOpenMs) emit(tMs, p, vol, session); // completed bars: RTH only
  }

  const minuteBars: SyntheticBar[] = [];
  for (const [minuteKey, b] of minuteMap) {
    minuteBars.push({
      time: msToBarTime(minuteKey),
      open: round2(b.open),
      high: round2(b.high),
      low: round2(b.low),
      close: round2(b.close),
      volume: Math.round(b.volume),
      session: b.session,
    });
  }
  minuteBars.sort((a, b) => a.time.localeCompare(b.time));

  return { symbol: sym, date, ticks, minuteBars };
}

export function getDay(symbol: string, date: string): DayMarket {
  const key = `${symbol.toUpperCase()}:${date}`;
  let d = dayCache.get(key);
  if (!d) {
    d = buildDay(symbol, date);
    dayCache.set(key, d);
  }
  return d;
}

// ---------------------------------------------------------------------------
// API-shaped queries
// ---------------------------------------------------------------------------

const parseUtc = (s: string): number =>
  new Date(s.includes('T') ? s : s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).getTime();

/** API timeframe token → seconds (86400 sentinel means "daily"). */
export function tfTokenToSeconds(token: string): number {
  switch (token) {
    case '1s':
      return 1;
    case '5s':
      return 5;
    case '15s':
      return 15;
    case '30s':
      return 30;
    case '1m':
    case '1min':
      return 60;
    case '5m':
    case '5min':
      return 300;
    case '15m':
    case '15min':
      return 900;
    case '30m':
    case '30min':
      return 1800;
    case '1h':
      return 3600;
    case '1d':
      return 86400; // daily sentinel
    default:
      return 60;
  }
}

/** Every calendar date (inclusive) spanned by [startMs, endMs]. */
function datesInRange(startMs: number, endMs: number): string[] {
  const dates: string[] = [];
  let cur = utcDateOf(startMs);
  const end = utcDateOf(endMs);
  // Guard against pathological ranges.
  let guard = 0;
  while (cur <= end && guard < 400) {
    dates.push(cur);
    const next = new Date(`${cur}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cur = next.toISOString().slice(0, 10);
    guard++;
  }
  return dates;
}

/** Ascending list of up to `count` trading days ending at `endDate` (inclusive). */
function tradingDaysUpTo(endDate: string, count: number): string[] {
  const days: string[] = [];
  const d = new Date(`${endDate}T12:00:00Z`);
  let guard = 0;
  while (days.length < count && guard < 400) {
    const ds = d.toISOString().slice(0, 10);
    if (isTradingDay(ds)) days.push(ds);
    d.setUTCDate(d.getUTCDate() - 1);
    guard++;
  }
  return days.reverse();
}

/** Ticks within [startMs, endMs] (defaults: unbounded), ascending, limit/offset aware. */
export function queryTicks(
  symbol: string,
  opts: { startMs?: number; endMs?: number; limit?: number; offset?: number },
): SyntheticTick[] {
  const startMs = opts.startMs ?? -Infinity;
  const endMs = opts.endMs ?? Infinity;
  const dates =
    opts.startMs !== undefined || opts.endMs !== undefined
      ? datesInRange(startMs === -Infinity ? endMs - 30 * 86400000 : startMs, endMs)
      : tradingDaysUpTo(utcDateOf(Date.now()), PRIOR_TRADING_DAYS);

  const out: SyntheticTick[] = [];
  for (const date of dates) {
    for (const t of getDay(symbol, date).ticks) {
      const ms = parseUtc(t.time);
      if (ms >= startMs && ms <= endMs) out.push(t);
    }
  }
  out.sort((a, b) => a.time.localeCompare(b.time));
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? out.length;
  return out.slice(offset, offset + limit);
}

interface Bucket {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: string;
  tick_count: number;
}

/**
 * Aggregate a symbol's data into OHLCV candles at `tfSeconds`, restricted to
 * [startMs, endMs]. Daily (86400) buckets are grouped by ET calendar date and
 * labelled "YYYY-MM-DD 12:00:00" so they survive the app's UTC resampler.
 */
export function queryCandles(
  symbol: string,
  tfSeconds: number,
  opts: { startMs?: number; endMs?: number; limit?: number },
): CandleRow[] {
  const endMs = opts.endMs ?? Date.now();
  const startMs = opts.startMs ?? endMs - 40 * 86400000;

  // Which calendar days contribute?
  let dates: string[];
  if (opts.startMs !== undefined) {
    dates = datesInRange(startMs, endMs);
  } else {
    // Initial load / history: last N trading days up to the end bound.
    dates = tradingDaysUpTo(utcDateOf(endMs), PRIOR_TRADING_DAYS);
  }

  const useTicks = tfSeconds < 60;
  type Src = { tMs: number; o: number; h: number; l: number; c: number; v: number; session: string };
  const source: Src[] = [];

  for (const date of dates) {
    const day = getDay(symbol, date);
    if (useTicks) {
      for (const t of day.ticks) {
        const tMs = parseUtc(t.time);
        if (tMs < startMs || tMs > endMs) continue;
        source.push({ tMs, o: t.price, h: t.price, l: t.price, c: t.price, v: t.volume, session: t.session });
      }
    } else {
      for (const b of day.minuteBars) {
        const tMs = parseUtc(b.time);
        if (tMs < startMs || tMs > endMs) continue;
        source.push({ tMs, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, session: b.session });
      }
    }
  }

  const buckets = new Map<string, Bucket>();
  const add = (key: string, labelTime: string, s: Src) => {
    let b = buckets.get(key);
    if (!b) {
      b = { time: labelTime, open: s.o, high: s.h, low: s.l, close: s.c, volume: 0, session: s.session, tick_count: 0 };
      buckets.set(key, b);
    }
    b.high = Math.max(b.high, s.h);
    b.low = Math.min(b.low, s.l);
    b.close = s.c;
    b.volume += s.v;
    b.tick_count += 1;
  };

  if (tfSeconds === 86400) {
    for (const s of source) {
      const etDate = etDateOf(s.tMs);
      add(`d:${etDate}`, `${etDate} 12:00:00`, s);
    }
  } else {
    const bucketMs = tfSeconds * 1000;
    for (const s of source) {
      const bMs = Math.floor(s.tMs / bucketMs) * bucketMs;
      add(`t:${bMs}`, msToBarTime(bMs), s);
    }
  }

  const rows = [...buckets.values()].sort((a, b) => a.time.localeCompare(b.time));
  const limit = opts.limit ?? 0;
  // Honour `limit` by keeping the most recent `limit` bars (backend behaviour).
  return limit && rows.length > limit ? rows.slice(rows.length - limit) : rows;
}

/** Latest `limit` ticks for the tape endpoint (most recent day with data). */
export function queryTape(symbol: string, endMs: number, limit: number): SyntheticTick[] {
  const ticks = queryTicks(symbol, { endMs, limit: 100000 });
  return ticks.slice(Math.max(0, ticks.length - limit));
}
