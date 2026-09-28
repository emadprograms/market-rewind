import type { RawBar, Timeframe } from '../types';
import { TF_SECONDS } from '../types';
import { isRthBar } from './timezones';

export function resampleData(data: RawBar[], timeframe: Timeframe): RawBar[] {
  const start = performance.now();
  if (!data || data.length === 0) return [];
  if (timeframe === '1min' && (!data[0]?.time.includes('.') && data[0]?.time.endsWith(':00'))) {
    // If data is already 1-minute aligned and requested timeframe is 1min, pass through
    // But if data contains sub-minute bars/ticks, resample it.
    const hasSubMinute = data.some(b => !b.time.endsWith(':00'));
    if (!hasSubMinute) return data;
  }

  const resampled: RawBar[] = [];
  const durationSec = TF_SECONDS[timeframe] || 60;
  let currentBucket: RawBar | null = null;

  data.forEach((bar) => {
    if (timeframe === '1D' && !isRthBar(bar)) {
      return;
    }

    const rawTime = bar.time.includes('T') ? bar.time : bar.time.replace(' ', 'T') + (bar.time.includes('Z') ? '' : 'Z');
    const date = new Date(rawTime);
    const timestamp = date.getTime();

    let bucketTimeStr: string;

    if (timeframe === '1D') {
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      bucketTimeStr = `${yyyy}-${mm}-${dd} 12:00:00`;
    } else {
      const bucketStartMs = Math.floor(timestamp / (durationSec * 1000)) * (durationSec * 1000);
      const bucketDate = new Date(bucketStartMs);

      const yyyy = bucketDate.getUTCFullYear();
      const mm = String(bucketDate.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(bucketDate.getUTCDate()).padStart(2, '0');
      const hh = String(bucketDate.getUTCHours()).padStart(2, '0');
      const min = String(bucketDate.getUTCMinutes()).padStart(2, '0');
      const ss = String(bucketDate.getUTCSeconds()).padStart(2, '0');
      bucketTimeStr = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }

    if (!currentBucket || currentBucket.time !== bucketTimeStr) {
      if (currentBucket) resampled.push(currentBucket);
      currentBucket = {
        time: bucketTimeStr,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        session: timeframe === '1D' ? 'REG' : bar.session,
        tickCount: bar.tickCount || 1,
      };
    } else {
      currentBucket.high = Math.max(currentBucket.high, bar.high);
      currentBucket.low = Math.min(currentBucket.low, bar.low);
      currentBucket.close = bar.close;
      currentBucket.volume += bar.volume;
      currentBucket.tickCount = (currentBucket.tickCount || 1) + (bar.tickCount || 1);
    }
  });

  if (currentBucket) resampled.push(currentBucket);
  const end = performance.now();
  console.log(`[Performance] resampleData took ${(end - start).toFixed(2)}ms`);
  return resampled;
}
