import initSqlJs from "sql.js";

let dbInstance = null;
let SQL = null;

const REPO_URL = "https://github.com/emadprograms/market-rewind/releases/download/latest-data/market_data.db";

/**
 * Downloads the master database from GitHub and saves it to OPFS.
 */
export async function refreshMasterData() {
  console.log("Fetching master data from GitHub...");
  try {
    const response = await fetch(REPO_URL);
    if (!response.ok) throw new Error("Failed to download master data from GitHub.");
    
    const buffer = await response.arrayBuffer();
    
    // Write to OPFS for persistent storage
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle("market_data.db", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
    
    console.log("Master data updated in local storage.");
    
    // Force reconnect next time
    dbInstance = null;
    
    // Return the buffer so we can use it immediately
    return buffer;
  } catch (error) {
    console.error("Master Refresh Error:", error);
    throw error;
  }
}

/**
 * Initializes sql.js engine.
 */
async function getSqlJs() {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    // Load the WASM binary from CDN
    locateFile: (file) => `https://sql.js.org/dist/${file}`
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
    return null; // File doesn't exist yet
  }
}

/**
 * Initializes and returns the local database instance.
 */
export async function getDB() {
  if (dbInstance) return dbInstance;

  const sqlJs = await getSqlJs();
  
  // Try loading from OPFS first
  const data = await loadFromOPFS();
  
  if (data) {
    dbInstance = new sqlJs.Database(data);
    console.log("Database loaded from local storage.");
  } else {
    console.log("No local data found. Click 'Fetch latest from GitHub' to download.");
    return null;
  }
  
  return dbInstance;
}

/**
 * Fetches data from the LOCAL database.
 */
export async function fetchMarketData(ticker, dateIso) {
  const db = await getDB();
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
  const db = await getDB();
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
