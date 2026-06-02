import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import type { RawBar } from "../../types";

let dbInstance: Database | null = null;
let SQL: SqlJsStatic | null = null;

async function getSqlJs() {
  if (SQL) return SQL;
  
  // In a worker, we can fetch the wasm binary
  const wasmResp = await fetch('/sql-wasm.wasm');
  if (!wasmResp.ok) throw new Error(`WASM fetch failed: ${wasmResp.status}`);
  const wasmBinary = await wasmResp.arrayBuffer();
  
  SQL = await initSqlJs({ wasmBinary });
  return SQL;
}

async function loadFromOPFS(): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle("market_data.db");
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

async function ensureDB(): Promise<Database | null> {
  if (dbInstance) return dbInstance;
  
  const sqlJs = await getSqlJs();
  const data = await loadFromOPFS();
  
  if (data) {
    dbInstance = new sqlJs.Database(data);
    return dbInstance;
  }
  
  return null;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      case 'INIT_DB': {
        const db = await ensureDB();
        self.postMessage({ 
          id, 
          type: 'INIT_DB_RESPONSE', 
          payload: { success: !!db } 
        });
        break;
      }

      case 'LOAD_DB_FILE': {
        const { buffer } = payload; // ArrayBuffer
        const data = new Uint8Array(buffer);
        
        // Save to OPFS for persistence
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle("market_data.db", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(buffer);
        await writable.close();

        const sqlJs = await getSqlJs();
        dbInstance = new sqlJs.Database(data);
        
        self.postMessage({ id, type: 'LOAD_DB_FILE_RESPONSE', payload: { success: true } });
        break;
      }

      case 'FETCH_MARKET_DATA': {
        const { ticker, dateIso, daysBack = 30 } = payload;
        const db = await ensureDB();
        if (!db) throw new Error("Database not initialized");

        const results = db.exec(
          `SELECT timestamp, open, high, low, close, volume, session 
           FROM market_data 
           WHERE symbol = ? 
             AND timestamp >= datetime(?, '-${daysBack} days')
             AND timestamp <= ? 
           ORDER BY timestamp`,
          [ticker, `${dateIso} 00:00:00`, `${dateIso} 23:59:59`]
        );

        if (!results || results.length === 0) {
          self.postMessage({ id, type: 'FETCH_MARKET_DATA_RESPONSE', payload: [] });
        } else {
          const data = results[0].values.map(([timestamp, open, high, low, close, volume, session]) => ({
            time: timestamp as string,
            open: Number(open),
            high: Number(high),
            low: Number(low),
            close: Number(close),
            volume: Number(volume),
            session: session as string
          })) as RawBar[];
          self.postMessage({ id, type: 'FETCH_MARKET_DATA_RESPONSE', payload: data });
        }
        break;
      }

      case 'FETCH_HISTORICAL_CHUNK': {
        const { ticker, endTimestamp, daysBack = 30 } = payload;
        const db = await ensureDB();
        if (!db) throw new Error("Database not initialized");

        const results = db.exec(
          `SELECT timestamp, open, high, low, close, volume, session 
           FROM market_data 
           WHERE symbol = ? 
             AND timestamp >= datetime(?, '-${daysBack} days')
             AND timestamp < ? 
           ORDER BY timestamp`,
          [ticker, endTimestamp, endTimestamp]
        );

        if (!results || results.length === 0) {
          self.postMessage({ id, type: 'FETCH_HISTORICAL_CHUNK_RESPONSE', payload: [] });
        } else {
          const data = results[0].values.map(([timestamp, open, high, low, close, volume, session]) => ({
            time: timestamp as string,
            open: Number(open),
            high: Number(high),
            low: Number(low),
            close: Number(close),
            volume: Number(volume),
            session: session as string
          })) as RawBar[];
          self.postMessage({ id, type: 'FETCH_HISTORICAL_CHUNK_RESPONSE', payload: data });
        }
        break;
      }

      case 'FETCH_TICKERS': {
        const db = await ensureDB();
        if (!db) throw new Error("Database not initialized");

        const results = db.exec('SELECT DISTINCT symbol FROM market_data ORDER BY symbol');
        if (!results || results.length === 0) {
          self.postMessage({ id, type: 'FETCH_TICKERS_RESPONSE', payload: [] });
        } else {
          const tickers = results[0].values.map(row => row[0] as string);
          self.postMessage({ id, type: 'FETCH_TICKERS_RESPONSE', payload: tickers });
        }
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error: any) {
    self.postMessage({ 
      id, 
      type: 'ERROR', 
      payload: { message: error.message || 'Unknown error occurred in DB worker' } 
    });
  }
};
