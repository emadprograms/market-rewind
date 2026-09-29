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

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false
});

let lastDay = -1;
let dayOffset = 0; // in minutes

export function getSessionType(timestamp: number, ticker?: string): 'PRE' | 'RTH' | 'POST' | 'OTHER' {
  if (ticker) {
    const tz = getTzForTicker(ticker);
    if (tz === 'UTC') return 'RTH';
  }

  const date = new Date(timestamp * 1000);
  const day = Math.floor(timestamp / 86400);
  
  if (day !== lastDay) {
      // Recalculate offset for the day
      const nyStr = formatter.format(date); // "H:MM" or "HH:MM"
      const [h, m] = nyStr.split(':').map(Number);
      const utcHours = date.getUTCHours();
      const utcMinutes = date.getUTCMinutes();
      
      const nyTotal = h * 60 + m;
      const utcTotal = utcHours * 60 + utcMinutes;
      
      dayOffset = nyTotal - utcTotal;
      // Handle wrap around (day boundary)
      if (dayOffset > 720) dayOffset -= 1440;
      if (dayOffset < -720) dayOffset += 1440;
      
      lastDay = day;
  }
  
  const totalMinutesUTC = date.getUTCHours() * 60 + date.getUTCMinutes();
  let totalMinutes = totalMinutesUTC + dayOffset;
  if (totalMinutes < 0) totalMinutes += 1440;
  if (totalMinutes >= 1440) totalMinutes -= 1440;

  if (totalMinutes >= 240 && totalMinutes < 570) return 'PRE';
  if (totalMinutes >= 570 && totalMinutes < 960) return 'RTH';
  if (totalMinutes >= 960 && totalMinutes < 1200) return 'POST';
  return 'OTHER';
}

/**
 * Determines if a bar belongs to Regular Trading Hours (RTH).
 * Checks the session field first ('REG' or 'RTH'), then falls back to timestamp-based session calculation.
 */
export function isRthBar(bar: { time: string; session?: string }, ticker?: string, timeframe?: string): boolean {
  const normalizedTime = bar.time.includes('T') ? bar.time.replace('T', ' ') : bar.time;
  const isDaily = timeframe === '1D' ||
                  /^\d{4}-\d{2}-\d{2}$/.test(bar.time.trim()) || 
                  normalizedTime.endsWith(' 00:00:00') || 
                  normalizedTime.endsWith(' 12:00:00') ||
                  normalizedTime.endsWith(' 04:00:00') ||
                  normalizedTime.endsWith(' 05:00:00');

  if (isDaily) {
    if (bar.session) {
      const s = bar.session.toUpperCase();
      // If daily bar contains regular trading hours, preserve it
      if (s.includes('REG') || s.includes('RTH')) {
        return true;
      }
      // If daily bar is strictly outside regular trading hours (e.g. only PRE or only POST)
      if (s.includes('PRE') || s.includes('POST') || s.includes('ETH') || s === 'OTHER') {
        return false;
      }
    }
    // Daily bars without explicit session (or default daily aggregates) are preserved
    return true;
  }

  // Intraday bars: check session first
  if (bar.session) {
    const s = bar.session.toUpperCase();
    if (s.includes('PRE') || s.includes('POST') || s.includes('ETH') || s === 'OTHER') {
      return false;
    }
    if (s === 'REG' || s === 'RTH' || s.includes('REG')) {
      return true;
    }
  }

  const rawTime = bar.time.includes('T') ? bar.time : bar.time.replace(' ', 'T') + (bar.time.includes('Z') ? '' : 'Z');
  const ms = new Date(rawTime).getTime();
  if (isNaN(ms)) return true;
  return getSessionType(Math.floor(ms / 1000), ticker) === 'RTH';
}

/**
 * Determines if a tick belongs to Regular Trading Hours (RTH).
 */
export function isRthTick(tick: { time: string | number; session?: string; symbol?: string }, ticker?: string): boolean {
  if (tick.session) {
    const s = tick.session.toUpperCase();
    if (s.includes('PRE') || s.includes('POST') || s.includes('ETH') || s === 'OTHER') {
      return false;
    }
    if (s === 'REG' || s === 'RTH' || s.includes('REG')) {
      return true;
    }
  }

  let ms: number;
  if (typeof tick.time === 'number') {
    ms = tick.time < 1e11 ? tick.time * 1000 : tick.time;
  } else {
    const rawTime = tick.time.includes('T') ? tick.time : tick.time.replace(' ', 'T') + (tick.time.includes('Z') ? '' : 'Z');
    ms = new Date(rawTime).getTime();
  }

  if (isNaN(ms)) return true;
  return getSessionType(Math.floor(ms / 1000), tick.symbol || ticker) === 'RTH';
}
