/**
 * Streaming Client for Market Rewind.
 * Pure DuckDB streaming client communicating with streaming.duckdb backend service.
 */
import type { MarketTick, RawBar, Timeframe } from '../types';

declare const process: any;

export const STORAGE_KEY_STREAMING_URL = 'market_rewind_duckdb_url';

export interface SymbolMetadata {
  symbol: string;
  tick_count: number;
  first_tick: string | null;
  last_tick: string | null;
}

export interface BackendStatus {
  status: string;
  streaming_db: {
    path: string;
    exists: boolean;
    size_bytes: number;
    tick_count: number;
  };
}

export const TAILSCALE_STREAMING_IP = '100.72.128.22';
export const TAILSCALE_STREAMING_MAGICDNS = 'arshad-pc-1';
export const DEFAULT_STREAMING_URL = `http://${TAILSCALE_STREAMING_IP}:8420`;

/**
 * Pure helper to resolve the default streaming URL given environment, hostname, or storage.
 */
export function resolveServiceUrl(options?: {
  hostname?: string;
  protocol?: string;
  savedUrl?: string | null;
  envUrl?: string;
  isTest?: boolean;
}): string {
  // 1. User's saved preference in localStorage takes precedence
  if (options?.savedUrl && options.savedUrl.trim()) {
    return options.savedUrl.trim();
  }

  // 2. Explicit environment variable override
  if (options?.envUrl && options.envUrl.trim()) {
    return options.envUrl.trim();
  }

  // 3. In unit test environment without explicit host override, default to localhost:8420 for mock servers
  if (options?.isTest) {
    return 'http://localhost:8420';
  }

  // 4. In browser context: If accessing from a non-localhost host (like 100.72.128.22 or arshad-pc-1), match its port 8420
  if (options?.hostname && options.hostname !== 'localhost' && options.hostname !== '127.0.0.1') {
    const proto = options.protocol === 'https:' ? 'https:' : 'http:';
    return `${proto}//${options.hostname}:8420`;
  }

  // 5. Default Tailscale streaming host when running on client/localhost
  return DEFAULT_STREAMING_URL;
}

/**
 * Gets the current default streaming URL based on localStorage, window.location, or environment.
 */
export function getDefaultStreamingUrl(): string {
  let savedUrl: string | null = null;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      savedUrl = window.localStorage.getItem(STORAGE_KEY_STREAMING_URL);
    } catch {
      // LocalStorage access may be restricted
    }
  }

  const isTest = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || Boolean(process.env?.VITEST));
  const hostname = typeof window !== 'undefined' && window.location ? window.location.hostname : undefined;
  const protocol = typeof window !== 'undefined' && window.location ? window.location.protocol : undefined;
  const envUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_STREAMING_URL)
    || (typeof process !== 'undefined' ? process.env?.VITE_STREAMING_URL : undefined);

  return resolveServiceUrl({
    hostname,
    protocol,
    savedUrl,
    envUrl,
    isTest: isTest && !savedUrl,
  });
}

/**
 * Gets the smart default host URL (e.g. http://<hostname>:8420) ignoring localStorage.
 * Useful for the "Current Host" reset preset.
 */
export function getHostDefaultStreamingUrl(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
      return `${proto}//${window.location.hostname}:8420`;
    }
  }
  return DEFAULT_STREAMING_URL;
}

/**
 * Normalizes user-input URL string into clean HTTP and WebSocket URLs.
 * Handles missing protocol (defaults to http://), trailing slashes, and protocol translation.
 */
export function normalizeServiceUrl(rawUrl: string): { httpUrl: string; wsUrl: string } {
  let cleaned = (rawUrl || '').trim();
  if (!cleaned) {
    cleaned = getDefaultStreamingUrl();
  }

  // Handle bare hostname/IP like "100.85.12.34:8420" or "localhost:8420"
  if (!/^https?:\/\//i.test(cleaned)) {
    if (/^wss:\/\//i.test(cleaned)) {
      cleaned = cleaned.replace(/^wss:\/\//i, 'https://');
    } else if (/^ws:\/\//i.test(cleaned)) {
      cleaned = cleaned.replace(/^ws:\/\//i, 'http://');
    } else {
      cleaned = `http://${cleaned}`;
    }
  }

  // Strip trailing slashes
  cleaned = cleaned.replace(/\/+$/, '');

  // Derive WebSocket URL
  let wsUrl: string;
  if (cleaned.startsWith('https://')) {
    wsUrl = cleaned.replace(/^https:\/\//i, 'wss://');
  } else {
    wsUrl = cleaned.replace(/^http:\/\//i, 'ws://');
  }

  return { httpUrl: cleaned, wsUrl };
}

export class StreamingClient {
  private isOnline: boolean | null = null;
  private _baseUrl: string;
  private _wsUrl: string;
  private listeners: Set<(url: string) => void> = new Set();

  constructor() {
    const initial = normalizeServiceUrl(getDefaultStreamingUrl());
    this._baseUrl = initial.httpUrl;
    this._wsUrl = initial.wsUrl;
  }

  getBaseUrl(): string {
    return this._baseUrl;
  }

  getWsUrl(): string {
    return this._wsUrl;
  }

  /**
   * Sets a new service URL at runtime, persists it to localStorage,
   * resets connection status, and notifies all registered subscribers.
   */
  setServiceUrl(rawUrl: string): { httpUrl: string; wsUrl: string } {
    const normalized = normalizeServiceUrl(rawUrl);
    this._baseUrl = normalized.httpUrl;
    this._wsUrl = normalized.wsUrl;
    this.isOnline = null;

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_KEY_STREAMING_URL, normalized.httpUrl);
      } catch {
        // LocalStorage may fail in restricted context
      }
    }

    this.notifyListeners();
    return normalized;
  }

  /**
   * Clears saved preference from localStorage and resets to host default.
   */
  resetToDefaultUrl(): { httpUrl: string; wsUrl: string } {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(STORAGE_KEY_STREAMING_URL);
      } catch {
        // ignore
      }
    }

    const hostDefault = getHostDefaultStreamingUrl();
    const normalized = normalizeServiceUrl(hostDefault);
    this._baseUrl = normalized.httpUrl;
    this._wsUrl = normalized.wsUrl;
    this.isOnline = null;

    this.notifyListeners();
    return normalized;
  }

  /**
   * Subscribes to changes to the streaming service URL.
   * Returns an unsubscribe function.
   */
  subscribeUrlChange(listener: (url: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this._baseUrl);
      } catch (err) {
        console.error('Error in streamingClient url listener:', err);
      }
    }
  }

  async checkStatus(urlOverride?: string): Promise<BackendStatus | null> {
    const targetUrl = urlOverride ? normalizeServiceUrl(urlOverride).httpUrl : this.getBaseUrl();
    try {
      const res = await fetch(`${targetUrl}/api/status`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!urlOverride) {
        this.isOnline = true;
      }

      const streamingInfo = data.streaming || data.streaming_db || {};

      const normalized: BackendStatus = {
        status: data.status || 'OK',
        streaming_db: {
          path: streamingInfo.path || '',
          exists: Boolean(streamingInfo.exists ?? true),
          size_bytes: streamingInfo.size_bytes || (streamingInfo.size_mb ? Math.round(streamingInfo.size_mb * 1024 * 1024) : 0),
          tick_count: streamingInfo.tick_count ?? streamingInfo.ticks_rows ?? 0,
        },
      };

      return normalized;
    } catch {
      if (!urlOverride) {
        this.isOnline = false;
      }
      return null;
    }
  }

  get isServiceOnline(): boolean {
    return this.isOnline === true;
  }

  async getSymbols(): Promise<SymbolMetadata[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/symbols`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.symbols || []);
      return list.map((item: any) => {
        if (typeof item === 'string') {
          return { symbol: item, tick_count: 0, first_tick: null, last_tick: null };
        }
        const sym = item.symbol || item.display_name || item.massive_ticker || item.ticker || '';
        return {
          symbol: sym,
          tick_count: item.tick_count || 0,
          first_tick: item.first_tick || null,
          last_tick: item.last_tick || null,
        };
      }).filter((s: SymbolMetadata) => Boolean(s.symbol));
    } catch (e) {
      if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
        console.warn('Could not fetch symbols from streaming service:', e);
      }
      return [];
    }
  }

  async getSymbolSummary(symbol: string): Promise<any | null> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/symbols/${encodeURIComponent(symbol)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Queries raw ticks from streaming.duckdb.
   * Strictly enforces date/time bounding. If no ticks match the requested range,
   * returns an empty array (never falls back to unconstrained future tape).
   */
  async getTicks(
    symbol: string,
    options: {
      startTime?: string;
      endTime?: string;
      limit?: number;
      offset?: number;
      direction?: 'asc' | 'desc';
      signal?: AbortSignal;
    } = {}
  ): Promise<MarketTick[]> {
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      limit: String(options.limit || 10000),
      offset: String(options.offset || 0),
      direction: options.direction || 'asc',
    });
    if (options.startTime) params.append('start_time', options.startTime);
    if (options.endTime) params.append('end_time', options.endTime);

    let rawTicks: any[] = [];
    const timeoutSignal = AbortSignal.timeout(10000);
    const fetchSignal = options.signal
      ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([options.signal, timeoutSignal]) : options.signal)
      : timeoutSignal;

    try {
      const res = await fetch(`${this.getBaseUrl()}/api/ticks?${params.toString()}`, {
        signal: fetchSignal,
      });
      if (res.ok) {
        const data = await res.json();
        rawTicks = Array.isArray(data) ? data : (data.ticks || []);
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.warn(`Failed to fetch ticks for ${symbol}:`, e);
      }
    }

    const mapped: MarketTick[] = (rawTicks || []).map((t: any) => {
      let timeStr = '';
      if (typeof t.time === 'string') {
        timeStr = t.time;
      } else if (typeof t.timestamp === 'string') {
        timeStr = t.timestamp;
      } else if (t.time_str) {
        timeStr = t.time_str;
      } else if (typeof t.time === 'number') {
        const ms = t.time < 1e11 ? t.time * 1000 : t.time;
        timeStr = new Date(ms).toISOString().replace('T', ' ').slice(0, 23);
      }
      timeStr = timeStr.replace('T', ' ');

      return {
        time: timeStr,
        price: Number(t.price),
        volume: Number(t.volume ?? t.size ?? 1),
        bid: t.bid !== undefined && t.bid !== null ? Number(t.bid) : undefined,
        ask: t.ask !== undefined && t.ask !== null ? Number(t.ask) : undefined,
        symbol: t.symbol || symbol.toUpperCase(),
        session: t.session || 'REG',
        source: t.source || 'STREAMING',
      };
    }).filter(t => Boolean(t.time) && !isNaN(t.price));

    mapped.sort((a, b) => a.time.localeCompare(b.time));
    return mapped;
  }

  /**
   * Fetches latest live tape ticks specifically for Time & Sales drawer.
   */
  async getLiveTape(symbol: string, limit: number = 50): Promise<MarketTick[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/stream/tape?symbol=${encodeURIComponent(symbol.toUpperCase())}&limit=${limit}`);
      if (!res.ok) return [];
      const data = await res.json();
      const raw = Array.isArray(data) ? data : (data.ticks || []);
      return raw.map((t: any) => ({
        time: (t.timestamp || t.time || '').replace('T', ' '),
        price: Number(t.price),
        volume: Number(t.volume ?? t.size ?? 1),
        bid: t.bid !== undefined && t.bid !== null ? Number(t.bid) : undefined,
        ask: t.ask !== undefined && t.ask !== null ? Number(t.ask) : undefined,
        symbol: t.symbol || symbol.toUpperCase(),
        session: t.session || 'REG',
        source: t.source || 'CAPITAL',
      })).filter((t: any) => Boolean(t.time) && !isNaN(t.price))
        .sort((a: any, b: any) => a.time.localeCompare(b.time));
    } catch {
      return [];
    }
  }

  /**
   * Fetches candles aggregated directly from streaming.duckdb via time_bucket().
   * Runs exclusively on streaming.duckdb for all timeframes (sub-second to daily).
   */
  async getCandles(
    symbol: string,
    options: {
      timeframe?: Timeframe;
      startTime?: string;
      endTime?: string;
      limit?: number;
      session?: string;
      signal?: AbortSignal;
    } = {}
  ): Promise<RawBar[]> {
    const sym = symbol.toUpperCase();
    const tf = options.timeframe || '1min';
    const TIMEFRAME_TO_API: Record<string, string> = {
      '1s': '1s',
      '5s': '5s',
      '15s': '15s',
      '30s': '30s',
      '1min': '1m',
      '5min': '5m',
      '15min': '15m',
      '30min': '30m',
      '1H': '1h',
      '1D': '1d',
    };
    const apiTf = TIMEFRAME_TO_API[tf] || (tf.toLowerCase().includes('d') ? '1d' : tf.toLowerCase().includes('h') ? '1h' : '1m');
    const limit = options.limit || 15000;

    const isSubSecond = ['1s', '5s', '15s', '30s'].includes(tf);
    const endpoint = isSubSecond ? `${this.getBaseUrl()}/api/streaming/candles` : `${this.getBaseUrl()}/api/candles`;

    const params = new URLSearchParams({
      symbol: sym,
      tf: apiTf,
      timeframe: apiTf,
      limit: String(limit),
    });
    if (options.session) {
      params.append('session', options.session);
    } else if (tf === '1D' || apiTf === '1d') {
      params.append('session', 'REG');
    }
    if (options.startTime) params.append('start', options.startTime);
    if (options.endTime) params.append('end', options.endTime);

    let rawList: any[] = [];
    const timeoutSignal = AbortSignal.timeout(8000);
    const fetchSignal = options.signal
      ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([options.signal, timeoutSignal]) : options.signal)
      : timeoutSignal;

    try {
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        signal: fetchSignal,
      });
      if (res.ok) {
        const data = await res.json();
        rawList = Array.isArray(data) ? data : (data.candles || []);
      }
    } catch (e: any) {
      const isAborted = e?.name === 'AbortError' || options.signal?.aborted;
      const isTimeout = e?.name === 'TimeoutError' || timeoutSignal.aborted;
      if (isAborted || isTimeout) {
        return [];
      }
      console.warn(`Failed to fetch candles from ${endpoint} for ${symbol}:`, e);
      const fallbackEndpoint = isSubSecond ? `${this.getBaseUrl()}/api/candles` : `${this.getBaseUrl()}/api/streaming/candles`;
      try {
        const fallbackTimeout = AbortSignal.timeout(8000);
        const fallbackSignal = options.signal
          ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([options.signal, fallbackTimeout]) : options.signal)
          : fallbackTimeout;
        const streamRes = await fetch(`${fallbackEndpoint}?${params.toString()}`, {
          signal: fallbackSignal,
        });
        if (streamRes.ok) {
          const data = await streamRes.json();
          rawList = Array.isArray(data) ? data : (data.candles || []);
        }
      } catch (err2: any) {
        if (err2?.name !== 'AbortError') {
          console.warn(`Failed to fetch candles from fallback ${fallbackEndpoint} for ${symbol}:`, err2);
        }
      }
    }

    return (rawList || []).map((row: any) => {
      let timeStr = '';
      if (typeof row.time === 'number') {
        const ms = row.time < 1e11 ? row.time * 1000 : row.time;
        timeStr = new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
      } else if (typeof row.time === 'string') {
        timeStr = row.time.replace('T', ' ').slice(0, 19);
      } else if (row.timestamp) {
        const d = new Date(row.timestamp);
        if (!isNaN(d.getTime())) {
          timeStr = d.toISOString().replace('T', ' ').slice(0, 19);
        } else {
          timeStr = String(row.timestamp).replace('T', ' ').slice(0, 19);
        }
      } else if (row.time_str) {
        timeStr = row.time_str;
      }

      return {
        time: timeStr,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume || 0),
        session: row.session || 'REG',
        tickCount: Number(row.tick_count || 1),
      };
    }).sort((a, b) => a.time.localeCompare(b.time));
  }

  createReplayWebSocket(handlers: {
    onTick: (tick: MarketTick, index: number) => void;
    onStatus: (status: any) => void;
    onError?: (err: any) => void;
  }) {
    let ws: WebSocket | null = null;
    let isConnected = false;

    const connect = () => {
      ws = new WebSocket(`${this.getWsUrl()}/ws/replay`);

      ws.onopen = () => {
        isConnected = true;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'tick') {
            handlers.onTick(msg.tick, msg.index);
          } else if (msg.type === 'status') {
            handlers.onStatus(msg);
          } else if (msg.type === 'error' && handlers.onError) {
            handlers.onError(msg.message);
          }
        } catch (e) {
          console.error('Error parsing WS replay message:', e);
        }
      };

      ws.onerror = (e) => {
        if (handlers.onError) handlers.onError(e);
      };

      ws.onclose = () => {
        isConnected = false;
      };
    };

    connect();

    return {
      load: (symbol: string, startTime?: string, limit: number = 20000) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'load', symbol, start_time: startTime, limit }));
        }
      },
      play: () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'play' }));
        }
      },
      pause: () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'pause' }));
        }
      },
      step: (direction: 'forward' | 'backward' = 'forward') => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'step', direction }));
        }
      },
      setSpeed: (speed: number) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'set_speed', speed }));
        }
      },
      seek: (timestamp: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'seek', timestamp }));
        }
      },
      close: () => {
        if (ws) ws.close();
      },
    };
  }
}

export const streamingClient = new StreamingClient();
