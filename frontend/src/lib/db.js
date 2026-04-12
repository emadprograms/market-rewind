import { createClient } from '@libsql/client/web';

// Note: In a real Vercel deployment, these would be process.env.VITE_TURSO_DB_URL
// For Vite development, they are import.meta.env.VITE_TURSO_DB_URL
const url = import.meta.env.VITE_TURSO_DB_URL || '';
const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN || '';

if (!url) {
    console.warn('VITE_TURSO_DB_URL is not defined in environment variables.');
}

export const db = createClient({
  url: url.replace('libsql://', 'https://'),
  authToken: authToken,
});

/**
 * Fetches 1-minute data for a ticker and date.
 */
export async function fetchMarketData(ticker, dateIso) {
  try {
    const rs = await db.execute({
      sql: `SELECT timestamp, open, high, low, close, volume, session 
            FROM market_data 
            WHERE symbol = ? AND timestamp LIKE ? 
            ORDER BY timestamp`,
      args: [ticker, `${dateIso}%`]
    });
    
    return rs.rows.map(row => ({
      time: row.timestamp,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      session: row.session
    }));
  } catch (error) {
    console.error('Failed to fetch market data:', error);
    return [];
  }
}

/**
 * Fetches all available tickers from symbol_map.
 */
export async function fetchTickers() {
  try {
    const rs = await db.execute('SELECT user_ticker FROM symbol_map ORDER BY user_ticker');
    return rs.rows.map(row => row.user_ticker);
  } catch (error) {
    console.error('Failed to fetch tickers:', error);
    return [];
  }
}
