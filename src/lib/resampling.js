/**
 * Resamples 1-minute market data into larger timeframes.
 * @param {Array} data - Array of 1m OHLCV objects.
 * @param {string} timeframe - Target timeframe (e.g., '5min', '15min', '1H', '1D').
 */
export function resampleData(data, timeframe) {
  if (!data || data.length === 0) return [];
  if (timeframe === '1min') return data;

  const resampled = [];
  const tfMap = {
    '5min': 5,
    '15min': 15,
    '30min': 30,
    '1H': 60,
    '1D': 1440
  };

  const durationMin = tfMap[timeframe] || 1;
  let currentBucket = null;

  data.forEach((bar) => {
    const date = new Date(bar.time.replace(' ', 'T') + 'Z');
    const timestamp = date.getTime();
    
    // Group into duration-sized buckets
    const bucketStartMs = Math.floor(timestamp / (durationMin * 60000)) * (durationMin * 60000);
    const bucketDate = new Date(bucketStartMs);
    
    // Format back to DB style "YYYY-MM-DD HH:MM:00" to keep replay engine happy
    const yyyy = bucketDate.getUTCFullYear();
    const mm = String(bucketDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(bucketDate.getUTCDate()).padStart(2, '0');
    const hh = String(bucketDate.getUTCHours()).padStart(2, '0');
    const min = String(bucketDate.getUTCMinutes()).padStart(2, '0');
    const bucketTimeStr = `${yyyy}-${mm}-${dd} ${hh}:${min}:00`;

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
  return resampled;
}
