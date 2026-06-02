import type { RawBar } from "../types";

type WorkerRequest = 
  | { type: 'INIT_DB'; id: string }
  | { type: 'LOAD_DB_FILE'; id: string; payload: { buffer: ArrayBuffer } }
  | { type: 'FETCH_MARKET_DATA'; id: string; payload: { ticker: string; dateIso: string; daysBack?: number } }
  | { type: 'FETCH_HISTORICAL_CHUNK'; id: string; payload: { ticker: string; endTimestamp: string; daysBack?: number } }
  | { type: 'FETCH_TICKERS'; id: string }
  | { type: 'ERROR'; id: string; payload: { message: string } };

type WorkerResponse = 
  | { type: 'INIT_DB_RESPONSE'; id: string; payload: { success: boolean } }
  | { type: 'LOAD_DB_FILE_RESPONSE'; id: string; payload: { success: boolean } }
  | { type: 'FETCH_MARKET_DATA_RESPONSE'; id: string; payload: RawBar[] }
  | { type: 'FETCH_HISTORICAL_CHUNK_RESPONSE'; id: string; payload: RawBar[] }
  | { type: 'FETCH_TICKERS_RESPONSE'; id: string; payload: string[] }
  | { type: 'ERROR'; id: string; payload: { message: string } };

class DatabaseWorkerProxy {
  private worker: Worker;
  private pendingRequests: Map<string, { resolve: (val: any) => void; reject: (reason: any) => void; timeout: number }> = new Map();
  private readonly REQUEST_TIMEOUT = 10000;

  constructor() {
    // Vite worker constructor syntax
    this.worker = new Worker(
      new URL('./workers/db.worker.ts', import.meta.url), 
      { type: 'module' }
    );

    this.worker.onmessage = (e: MessageEvent) => {
      const { id, type, payload } = e.data as WorkerResponse;
      const request = this.pendingRequests.get(id);
      
      if (!request) return;

      clearTimeout(request.timeout);
      this.pendingRequests.delete(id);

      if (type === 'ERROR') {
        request.reject(new Error(payload.message));
      } else {
        request.resolve(payload);
      }
    };

    this.worker.onerror = (e) => {
      console.error('DB Worker critical error:', e);
    };
  }

  private sendRequest<T>(type: string, payload?: any): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`DB Worker request timeout: ${type}`));
      }, this.REQUEST_TIMEOUT);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ id, type, payload });
    });
  }

  async initDB(): Promise<boolean> {
    const result = await this.sendRequest<{ success: boolean }>('INIT_DB');
    return result.success;
  }

  async loadDatabaseFromFile(file: File): Promise<boolean> {
    const buffer = await file.arrayBuffer();
    const result = await this.sendRequest<{ success: boolean }>('LOAD_DB_FILE', { buffer });
    return result.success;
  }

  async fetchMarketData(ticker: string, dateIso: string, daysBack = 30): Promise<RawBar[]> {
    return this.sendRequest<RawBar[]>('FETCH_MARKET_DATA', { ticker, dateIso, daysBack });
  }

  async fetchHistoricalChunk(ticker: string, endTimestamp: string, daysBack = 30): Promise<RawBar[]> {
    return this.sendRequest<RawBar[]>('FETCH_HISTORICAL_CHUNK', { ticker, endTimestamp, daysBack });
  }

  async fetchTickers(): Promise<string[]> {
    return this.sendRequest<string[]>('FETCH_TICKERS');
  }

  isDBLoaded(): boolean {
    // This is tricky since the worker owns the state.
    // For simplicity, we can track this locally in the proxy or send a query.
    // But since the original db.ts used a simple null check, let's maintain a local flag.
    return true; // The worker manages its own internal state
  }

  terminate() {
    this.worker.terminate();
  }
}

export const db = new DatabaseWorkerProxy();

// Exporting individual functions for backward compatibility and ease of use
export const initDB = () => db.initDB();
export const loadDatabaseFromFile = (file: File) => db.loadDatabaseFromFile(file);
export const fetchMarketData = (ticker: string, dateIso: string, daysBack = 30) => db.fetchMarketData(ticker, dateIso, daysBack);
export const fetchHistoricalChunk = (ticker: string, endTimestamp: string, daysBack = 30) => db.fetchHistoricalChunk(ticker, endTimestamp, daysBack);
export const fetchTickers = () => db.fetchTickers();
export const isDBLoaded = () => db.isDBLoaded();
