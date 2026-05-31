import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import type { RawBar } from "../types";

let dbInstance: Database | null = null;
let SQL: SqlJsStatic | null = null;

async function getSqlJs() {
  if (SQL) return SQL;
  
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

export async function loadDatabaseFromFile(file: File): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle("market_data.db", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
    console.log("Database saved to OPFS successfully.");

    const sqlJs = await getSqlJs();
    dbInstance = new sqlJs.Database(data);
    return true;
  } catch (error) {
    console.error("Failed to load uploaded file:", error);
    throw error;
  }
}

export async function initDB(): Promise<Database | null> {
  if (dbInstance) return dbInstance;
  
  const sqlJs = await getSqlJs();
  
  const data = await loadFromOPFS();
  
  if (data) {
    dbInstance = new sqlJs.Database(data);
    console.log("Database loaded from local storage.");
    return dbInstance;
  }
  
  console.log("No local database found. Needs manual upload.");
  return null;
}

export function isDBLoaded(): boolean {
  return dbInstance !== null;
}

export async function fetchMarketData(ticker: string, dateIso: string, daysBack = 30): Promise<RawBar[]> {
  const db = await initDB();
  if (!db) return [];
  
  try {
    const results = db.exec(
      `SELECT timestamp, open, high, low, close, volume, session 
       FROM market_data 
       WHERE symbol = ? 
         AND timestamp >= datetime(?, '-${daysBack} days')
         AND timestamp <= ? 
       ORDER BY timestamp`,
      [ticker, `${dateIso} 00:00:00`, `${dateIso} 23:59:59`]
    );
    
    if (!results || results.length === 0) return [];
    
    return results[0].values.map(([timestamp, open, high, low, close, volume, session]) => ({
      time: timestamp as string,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      session: session as string
    }));
  } catch (error) {
    console.error('Failed to fetch local market data:', error);
    return [];
  }
}

export async function fetchHistoricalChunk(ticker: string, endTimestamp: string, daysBack = 30): Promise<RawBar[]> {
  const db = await initDB();
  if (!db) return [];
  
  try {
    const results = db.exec(
      `SELECT timestamp, open, high, low, close, volume, session 
       FROM market_data 
       WHERE symbol = ? 
         AND timestamp >= datetime(?, '-${daysBack} days')
         AND timestamp < ? 
       ORDER BY timestamp`,
      [ticker, endTimestamp, endTimestamp]
    );
    
    if (!results || results.length === 0) return [];
    
    return results[0].values.map(([timestamp, open, high, low, close, volume, session]) => ({
      time: timestamp as string,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      session: session as string
    }));
  } catch (error) {
    console.error('Failed to fetch historical chunk:', error);
    return [];
  }
}

export async function fetchTickers(): Promise<string[]> {
  const db = await initDB();
  if (!db) return [];
  
  try {
    const results = db.exec('SELECT DISTINCT symbol FROM market_data ORDER BY symbol');
    if (!results || results.length === 0) return [];
    return results[0].values.map(row => row[0] as string);
  } catch (error) {
    console.error('Failed to fetch local tickers:', error);
    throw error;
  }
}
