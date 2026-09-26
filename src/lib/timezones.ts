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

export function getUtcTimeFromEt(dateStr: string, etTimeStr: string): string {
  const probeDate = new Date(`${dateStr}T14:00:00Z`);
  const nyHour = new Intl.DateTimeFormat('en-US', { 
    timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' 
  }).format(probeDate);
  const offsetHours = 14 - parseInt(nyHour, 10);
  const [hh, mm] = etTimeStr.split(':');
  const localMs = new Date(`${dateStr}T${hh}:${mm}:00Z`).getTime();
  const targetUtcDate = new Date(localMs + (offsetHours * 3600000));
  return targetUtcDate.toISOString().replace('T', ' ').substring(0, 19);
}
