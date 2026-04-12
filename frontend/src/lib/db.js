import { connect } from "@tursodatabase/sync-wasm";

let dbInstance = null;

const url = import.meta.env.VITE_TURSO_DB_URL || '';
const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN || '';

/**
 * Initializes and returns the local-first database instance.
 */
export async function getDB() {
  if (dbInstance) return dbInstance;

  if (!url || !authToken) {
    throw new Error('TURSO_DB_URL or TURSO_AUTH_TOKEN is missing. Please check your .env file.');
  }

  try {
    // This creates/connects to a persistent local.db file in OPFS
    dbInstance = await connect({
      path: "market_rewind_local.db",
      url: url.replace('libsql://', 'https://'),
      authToken: authToken,
    });
    return dbInstance;
  } catch (error) {
    console.error("Failed to initialize sync-wasm DB:", error);
    throw error;
  }
}

/**
 * Manually pulls changes from the remote Turso database.
 */
export async function syncWithRemote() {
  const db = await getDB();
  console.log("Starting manual sync (pull) from Turso...");
  await db.pull();
  console.log("Sync complete.");
}

/**
 * Fetches data from the LOCAL replica.
 */
export async function fetchMarketData(ticker, dateIso) {
  const db = await getDB();
  try {
    // Note: sync-wasm execute might return different format than standard client
    // typically it returns { columns: [], rows: [] }
    const rs = await db.execute({
      sql: `SELECT timestamp, open, high, low, close, volume, session 
            FROM market_data 
            WHERE symbol = ? AND timestamp LIKE ? 
            ORDER BY timestamp`,
      args: [ticker, `${dateIso}%`]
    });
    
    return rs.rows.map(row => {
        // Handle both object-based and array-based row formats if necessary
        // Most wasm drivers return arrays for rows.
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
