import initSqlJs from "sql.js";

let dbInstance = null;
let SQL = null;

/**
 * Initializes sql.js engine.
 * Manually fetches the WASM binary and passes it directly, bypassing all
 * locateFile resolution issues with Vite's ESM bundler.
 */
async function getSqlJs() {
  if (SQL) return SQL;
  
  const wasmResp = await fetch('/sql-wasm.wasm');
  if (!wasmResp.ok) throw new Error(`WASM fetch failed: ${wasmResp.status}`);
  const wasmBinary = await wasmResp.arrayBuffer();
  
  SQL = await initSqlJs({ wasmBinary });
  return SQL;
}

/**
 * Tries to load database from OPFS persistent storage.
 */
async function loadFromOPFS() {
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

/**
 * Saves a new database ArrayBuffer to OPFS and loads it into memory.
 */
export async function loadDatabaseFromFile(file) {
  try {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    
    // Save to OPFS so it survives a page reload
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle("market_data.db", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
    console.log("Database saved to OPFS successfully.");

    // Load into sql.js
    const sqlJs = await getSqlJs();
    dbInstance = new sqlJs.Database(data);
    return true;
  } catch (error) {
    console.error("Failed to load uploaded file:", error);
    throw error;
  }
}

/**
 * Initializes the database from existing OPFS cache.
 * Called automatically on app startup. Returns null if no localized file is found.
 */
export async function initDB() {
  if (dbInstance) return dbInstance;
  
  const sqlJs = await getSqlJs();
  
  // Try cached copy from OPFS
  const data = await loadFromOPFS();
  
  if (data) {
    dbInstance = new sqlJs.Database(data);
    console.log("Database loaded from local storage.");
    return dbInstance;
  }
  
  console.log("No local database found. Needs manual upload.");
  return null;
}

/**
 * Checks if DB is loaded
 */
export function isDBLoaded() {
  return dbInstance !== null;
}

/**
 * Fetches data from the LOCAL database.
 */
export async function fetchMarketData(ticker, dateIso) {
  const db = await initDB();
  if (!db) return [];
  
  try {
    const results = db.exec(
      `SELECT timestamp, open, high, low, close, volume, session 
       FROM market_data 
       WHERE symbol = ? AND timestamp LIKE ? 
       ORDER BY timestamp`,
      [ticker, `${dateIso}%`]
    );
    
    if (!results || results.length === 0) return [];
    
    return results[0].values.map(([timestamp, open, high, low, close, volume, session]) => ({
      time: timestamp,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      session: session
    }));
  } catch (error) {
    console.error('Failed to fetch local market data:', error);
    return [];
  }
}

/**
 * Fetches all available tickers from the LOCAL database.
 */
export async function fetchTickers() {
  const db = await initDB();
  if (!db) return [];
  
  try {
    const results = db.exec('SELECT DISTINCT symbol FROM market_data ORDER BY symbol');
    if (!results || results.length === 0) return [];
    return results[0].values.map(row => row[0]);
  } catch (error) {
    console.error('Failed to fetch local tickers:', error);
    throw error; // Rethrow to ensure App.jsx exits loading state
  }
}
