/**
 * DETECTOR: Heuristic to determine if a ticker is a US Individual Stock (ET)
 * or a Global Asset like an ETF/Crypto (UTC).
 */

// Tickers that definitely use UTC (Crypto)
const KNOWN_UTC_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOT', 'DOGE', 'AVAX', 'LINK', 'LTC'
]);

export function getTzForTicker(ticker) {
  if (!ticker) return 'UTC';
  
  const t = ticker.toUpperCase();
  
  // 1. Explicit Crypto / Forex / Global Handlers (UTC)
  if (
    t.includes('USD') || 
    t.includes('/') || 
    KNOWN_UTC_TICKERS.has(t) ||
    t.startsWith('^') || 
    t.startsWith('/') || 
    t.startsWith('=')
  ) {
    return 'UTC';
  }

  // 4. Default: Stocks and ETFs trade in Eastern Time
  return 'America/New_York';
}

export function getTzLabel(tz) {
  return tz === 'America/New_York' ? 'ET' : 'UTC';
}
