/**
 * Streaming Client for Market Rewind.
 * Communicates with the DuckDB streaming backend service (REST & WebSocket).
 */
import type { MarketTick, RawBar, Timeframe } from '../types';

const API_BASE_URL = typeof window !== 'undefined' ? (window.location.origin) : 'http://localhost:8765';
const WS_BASE_URL = typeof window !== 'undefined' 
  ? (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host
  : 'ws://localhost:8765';

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
      return data as BackendStatus;
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
      return await res.json();
    } catch (e) {
      console.warn('Could not fetch symbols from streaming service:', e);
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

    try {
      const res = await fetch(`${API_BASE_URL}/api/ticks?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn('Error fetching ticks:', e);
      return [];
    }
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
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      timeframe: options.timeframe || '1min',
      limit: String(options.limit || 5000),
    });
    if (options.startTime) params.append('start_time', options.startTime);
    if (options.endTime) params.append('end_time', options.endTime);

    try {
      const res = await fetch(`${API_BASE_URL}/api/candles?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data || []).map((row: any) => ({
        time: row.time.replace('T', ' ').slice(0, 19),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume || 0),
        session: 'REG',
        tickCount: Number(row.tick_count || 1),
      }));
    } catch (e) {
      console.warn('Error fetching dynamic candles from streaming service:', e);
      return [];
    }
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
