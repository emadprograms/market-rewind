import type { RawBar, Timeframe } from '../types';

export function resampleData(data: RawBar[], timeframe: Timeframe): RawBar[] {
  const start = performance.now();
  if (!data || data.length === 0) return [];
  if (timeframe === '1min') return data;

  const resampled: RawBar[] = [];
  const tfMap: Record<Timeframe, number> = {
    '1min': 1,
    '5min': 5,
    '15min': 15,
    '30min': 30,
    '1H': 60,
    '1D': 1440
  };

  const durationMin = tfMap[timeframe] || 1;
  let currentBucket: RawBar | null = null;

  data.forEach((bar) => {
    const date = new Date(bar.time.replace(' ', 'T') + 'Z');
    const timestamp = date.getTime();
    
    let bucketTimeStr: string;
    
    if (timeframe === '1D') {
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      bucketTimeStr = `${yyyy}-${mm}-${dd} 12:00:00`;
    } else {
      const bucketStartMs = Math.floor(timestamp / (durationMin * 60000)) * (durationMin * 60000);
      const bucketDate = new Date(bucketStartMs);
      
      const yyyy = bucketDate.getUTCFullYear();
      const mm = String(bucketDate.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(bucketDate.getUTCDate()).padStart(2, '0');
      const hh = String(bucketDate.getUTCHours()).padStart(2, '0');
      const min = String(bucketDate.getUTCMinutes()).padStart(2, '0');
      bucketTimeStr = `${yyyy}-${mm}-${dd} ${hh}:${min}:00`;
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
        session: bar.session
      };
    } else {
      currentBucket.high = Math.max(currentBucket.high, bar.high);
      currentBucket.low = Math.min(currentBucket.low, bar.low);
      currentBucket.close = bar.close;
      currentBucket.volume += bar.volume;
    }
  });

  if (currentBucket) resampled.push(currentBucket);
  const end = performance.now();
  console.log(`[Performance] resampleData took ${(end - start).toFixed(2)}ms`);
  return resampled;
}
