const KNOWN_UTC_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOT', 'DOGE', 'AVAX', 'LINK', 'LTC'
]);

export function getTzForTicker(ticker: string): string {
  if (!ticker) return 'UTC';
  
  const t = ticker.toUpperCase();
  
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

  return 'America/New_York';
}

export function getTzLabel(tz: string): string {
  return tz === 'America/New_York' ? 'ET' : 'UTC';
}
