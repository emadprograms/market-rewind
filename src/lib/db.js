import { connect } from "@tursodatabase/database-wasm";

let dbInstance = null;

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
    
    // Write to OPFS
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle("market_data.db", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
    
    console.log("Master data updated in local storage.");
    
    // Force reconnect next time
    dbInstance = null;
  } catch (error) {
    console.error("Master Refresh Error:", error);
    throw error;
  }
}

/**
 * Initializes and returns the local database instance.
 */
export async function getDB() {
  if (dbInstance) return dbInstance;

  try {
    // Connect to the file in OPFS
    // Note: If the file doesn't exist yet, we should probably trigger a refresh.
    dbInstance = await connect("market_data.db");
    return dbInstance;
  } catch (error) {
    console.error("Failed to connect to local DB:", error);
    throw error;
  }
}

/**
 * Fetches data from the LOCAL replica.
 */
export async function fetchMarketData(ticker, dateIso) {
  const db = await getDB();
  try {
    const rs = await db.execute({
      sql: `SELECT timestamp, open, high, low, close, volume, session 
            FROM market_data 
            WHERE symbol = ? AND timestamp LIKE ? 
            ORDER BY timestamp`,
      args: [ticker, `${dateIso}%`]
    });
    
    return rs.rows.map(row => {
        const [timestamp, open, high, low, close, volume, session] = Array.isArray(row) ? row : 
            [row.timestamp, row.open, row.high, row.low, row.close, row.volume, row.session];
        
        return {
            time: timestamp,
            open: Number(open),
            high: Number(high),
            low: Number(low),
            close: Number(close),
            volume: Number(volume),
            session: session
        };
    });
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
  try {
    const rs = await db.execute('SELECT user_ticker FROM symbol_map ORDER BY user_ticker');
    return rs.rows.map(row => Array.isArray(row) ? row[0] : row.user_ticker);
  } catch (error) {
    console.error('Failed to fetch local tickers:', error);
    return [];
  }
}
