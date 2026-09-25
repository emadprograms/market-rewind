/**
 * Streaming Client for Market Rewind.
 * Communicates with the DuckDB streaming backend service (REST & WebSocket).
 */
import type { MarketTick, RawBar, Timeframe } from '../types';

const API_BASE_URL = typeof window !== 'undefined' ? (window.location.origin) : 'http://localhost:8000';
const WS_BASE_URL = typeof window !== 'undefined' 
  ? (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host
  : 'ws://localhost:8000';

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
  historical_db: {
    path: string;
    exists: boolean;
    size_bytes: number;
    candle_count: number;
  };
}

class StreamingClient {
  private isOnline: boolean | null = null;

  async checkStatus(): Promise<BackendStatus | null> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/status`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.isOnline = true;

      // Normalize between data-harvester format and standalone streaming_service format
      const streamingInfo = data.streaming || data.streaming_db || {};
      const historicalInfo = data.historical || data.historical_db || {};

      const normalized: BackendStatus = {
        status: data.status || 'OK',
        streaming_db: {
          path: streamingInfo.path || '',
          exists: Boolean(streamingInfo.exists ?? true),
          size_bytes: streamingInfo.size_bytes || (streamingInfo.size_mb ? Math.round(streamingInfo.size_mb * 1024 * 1024) : 0),
          tick_count: streamingInfo.tick_count ?? streamingInfo.ticks_rows ?? 0,
        },
        historical_db: {
          path: historicalInfo.path || '',
          exists: Boolean(historicalInfo.exists ?? true),
          size_bytes: historicalInfo.size_bytes || (historicalInfo.size_mb ? Math.round(historicalInfo.size_mb * 1024 * 1024) : 0),
          candle_count: historicalInfo.candle_count ?? historicalInfo.market_data_rows ?? 0,
        }
      };

      return normalized;
    } catch {
      this.isOnline = false;
      return null;
    }
  }

  get isServiceOnline(): boolean {
    return this.isOnline === true;
  }

  async getSymbols(): Promise<SymbolMetadata[]> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/symbols`);
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
      const res = await fetch(`${API_BASE_URL}/api/symbols/${encodeURIComponent(symbol)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async getTicks(
    symbol: string,
    options: {
      startTime?: string;
      endTime?: string;
      limit?: number;
      offset?: number;
      direction?: 'asc' | 'desc';
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

    // 1. Try standard /api/ticks
    try {
      const res = await fetch(`${API_BASE_URL}/api/ticks?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        rawTicks = Array.isArray(data) ? data : (data.ticks || []);
      }
    } catch {
      // Fallback to tape endpoint
    }

    // 2. Fallback to /api/stream/tape (data-harvester endpoint)
    if (!rawTicks || rawTicks.length === 0) {
      try {
        const tapeRes = await fetch(`${API_BASE_URL}/api/stream/tape?symbol=${encodeURIComponent(symbol.toUpperCase())}&limit=${options.limit || 10000}`);
        if (tapeRes.ok) {
          const tapeData = await tapeRes.json();
          rawTicks = Array.isArray(tapeData) ? tapeData : (tapeData.ticks || []);
        }
      } catch {
        // ignore
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

  async getCandles(
    symbol: string,
    options: {
      timeframe?: Timeframe;
      startTime?: string;
      endTime?: string;
      limit?: number;
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
    const limit = options.limit || 5000;
    const isSubSecond = ['1s', '5s', '15s', '30s'].includes(tf);

    let rawList: any[] = [];

    if (isSubSecond) {
      // Sub-second timeframes only exist in streaming DuckDB
      try {
        const streamParams = new URLSearchParams({
          symbol: sym,
          tf: apiTf,
          timeframe: apiTf,
          limit: String(limit),
        });
        if (options.startTime) streamParams.append('start', options.startTime);
        if (options.endTime) streamParams.append('end', options.endTime);

        const res = await fetch(`${API_BASE_URL}/api/streaming/candles?${streamParams.toString()}`);
        if (res.ok) {
          const data = await res.json();
          rawList = data.candles || [];
        }
      } catch {
        // ignore
      }
    } else {
      // Standard timeframes: query historical DuckDB for historical context
      let histCandles: any[] = [];
      try {
        const params = new URLSearchParams({
          symbol: sym,
          tf: apiTf,
          timeframe: apiTf,
          limit: String(limit),
        });
        if (options.startTime) params.append('start', options.startTime);
        if (options.endTime) params.append('end', options.endTime);

        const res = await fetch(`${API_BASE_URL}/api/candles?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          histCandles = Array.isArray(data) ? data : (data.candles || []);
        }
      } catch {
        // ignore
      }

      // Also fetch live/streaming candles (matching requested range if provided)
      let streamCandles: any[] = [];
      try {
        const streamParams = new URLSearchParams({
          symbol: sym,
          tf: apiTf,
          timeframe: apiTf,
          limit: '1000',
        });
        if (options.startTime) streamParams.append('start', options.startTime);
        if (options.endTime) streamParams.append('end', options.endTime);

        const res = await fetch(`${API_BASE_URL}/api/streaming/candles?${streamParams.toString()}`);
        if (res.ok) {
          const data = await res.json();
          streamCandles = data.candles || [];
        }
      } catch {
        // ignore
      }

      // Combine historical + streaming without duplicates
      const candleMap = new Map<string, any>();
      for (const c of histCandles) {
        const key = c.time_str || String(c.time);
        candleMap.set(key, c);
      }
      for (const c of streamCandles) {
        const key = c.time_str || String(c.time);
        candleMap.set(key, c);
      }

      rawList = Array.from(candleMap.values());
    }

    return (rawList || []).map((row: any) => {
      let timeStr = '';
      if (row.time_str) {
        timeStr = row.time_str;
      } else if (typeof row.time === 'string') {
        timeStr = row.time.replace('T', ' ').slice(0, 19);
      } else if (typeof row.time === 'number') {
        timeStr = new Date(row.time * 1000).toISOString().replace('T', ' ').slice(0, 19);
      } else if (row.timestamp) {
        timeStr = String(row.timestamp).replace('T', ' ').slice(0, 19);
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
      ws = new WebSocket(`${WS_BASE_URL}/ws/replay`);

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
