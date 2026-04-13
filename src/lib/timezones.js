/**
 * DETECTOR: Heuristic to determine if a ticker is a US Individual Stock (ET)
 * or a Global Asset like an ETF/Crypto (UTC).
 */

const KNOWN_UTC_TICKERS = new Set([
  'SPY', 'QQQ', 'DIA', 'IWM', 'VXX', 'UVXY', 'VIX',
  'XLF', 'XLK', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLU', 'XLRE',
  'TLT', 'GLD', 'SLV', 'EEM', 'EFA', 'IYE', 'EWG', 'EWJ', 'EWZ'
]);

export function getTzForTicker(ticker) {
  if (!ticker) return 'UTC';
  
  const t = ticker.toUpperCase();
  
  // 1. Explicit Crypto Handlers
  if (t === 'ETH' || t === 'BTC' || t.includes('USD') || t.includes('/')) {
    return 'UTC';
  }
  
  // 2. Explicit ETF List
  if (KNOWN_UTC_TICKERS.has(t)) {
    return 'UTC';
  }
  
  // 3. Heuristic: Index/Future/Forex style identifiers usually stay UTC in this architecture
  if (t.startsWith('^') || t.startsWith('/') || t.startsWith('=')) {
    return 'UTC';
  }

  // 4. Default: Assume individual US Stocks trade and are charted in ET
  return 'America/New_York';
}

export function getTzLabel(tz) {
  return tz === 'America/New_York' ? 'ET' : 'UTC';
}
