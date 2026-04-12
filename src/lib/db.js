import initSqlJs from "sql.js";

let dbInstance = null;
let SQL = null;

const REPO_URL = "https://github.com/emadprograms/market-rewind/releases/download/latest-data/market_data.db";

/**
 * Initializes sql.js engine.
 * The WASM file is served from public/sql-wasm.wasm (same origin, no CDN).
 */
async function getSqlJs() {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    locateFile: () => '/sql-wasm.wasm'
  });
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
 * Downloads the latest database from GitHub Releases and saves to OPFS.
 * Returns the raw bytes so the caller can open the DB immediately.
 */
async function downloadFromGitHub() {
  console.log("Downloading master data from GitHub Releases...");
  const response = await fetch(REPO_URL);
  if (!response.ok) throw new Error(`GitHub download failed: ${response.status}`);
  
  const buffer = await response.arrayBuffer();
  const data = new Uint8Array(buffer);
  
  // Persist to OPFS for next time
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle("market_data.db", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
    console.log("Saved to OPFS for offline use.");
  } catch (e) {
    console.warn("OPFS save failed (will re-download next time):", e);
  }
  
  return data;
}

/**
 * Initializes the database. Tries OPFS first, falls back to GitHub download.
 * This is called automatically on app startup.
 */
export async function initDB() {
  if (dbInstance) return dbInstance;
  
  const sqlJs = await getSqlJs();
  
  // 1. Try cached copy from OPFS
  let data = await loadFromOPFS();
  
  // 2. If no cache, download from GitHub
  if (!data) {
    console.log("No local cache found. Downloading from GitHub...");
    data = await downloadFromGitHub();
  }
  
  dbInstance = new sqlJs.Database(data);
  console.log("Database ready.");
  return dbInstance;
}

/**
 * Forces a fresh download from GitHub (for manual refresh if needed).
 */
export async function forceRefresh() {
  const sqlJs = await getSqlJs();
  const data = await downloadFromGitHub();
  dbInstance = new sqlJs.Database(data);
  return dbInstance;
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
 * Fetches all available tickers from the LOCAL symbol_map.
 */
export async function fetchTickers() {
  const db = await initDB();
  if (!db) return [];
  
  try {
    const results = db.exec('SELECT user_ticker FROM symbol_map ORDER BY user_ticker');
    if (!results || results.length === 0) return [];
    return results[0].values.map(row => row[0]);
  } catch (error) {
    console.error('Failed to fetch local tickers:', error);
    return [];
  }
}
