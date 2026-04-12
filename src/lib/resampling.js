/**
 * Resamples 1-minute market data into larger timeframes.
 * @param {Array} data - Array of 1m OHLCV objects.
 * @param {string} timeframe - Target timeframe (e.g., '5min', '15min', '1H', '1D').
 */
export function resampleData(data, timeframe) {
  if (!data || data.length === 0) return [];
  if (timeframe === '1min') return data;

  const resampled = [];
  let currentBucket = null;
  let bucketDuration = 0;

  // Map timeframe string to minutes
  const tfMap = {
    '5min': 5,
    '15min': 15,
    '30min': 30,
    '1H': 60,
    '1D': 1440
  };

  const durationMin = tfMap[timeframe] || 1;

  data.forEach((bar) => {
    const timestamp = new Date(bar.time);
    // Calculate the start of the bucket (e.g., floor to 5 minutes)
    const bucketTime = new Date(Math.floor(timestamp.getTime() / (durationMin * 60000)) * (durationMin * 60000));
    const bucketIso = bucketTime.toISOString();

    if (!currentBucket || currentBucket.time !== bucketIso) {
      if (currentBucket) {
        resampled.push(currentBucket);
      }
      currentBucket = {
        time: bucketIso,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        color: bar.close >= bar.open ? 'rgba(38, 166, 154, 0.8)' : 'rgba(239, 83, 80, 0.8)'
      };
    } else {
      currentBucket.high = Math.max(currentBucket.high, bar.high);
      currentBucket.low = Math.min(currentBucket.low, bar.low);
      currentBucket.close = bar.close;
      currentBucket.volume += bar.volume;
      currentBucket.color = currentBucket.close >= currentBucket.open ? 'rgba(38, 166, 154, 0.8)' : 'rgba(239, 83, 80, 0.8)';
    }
  });

  if (currentBucket) {
    resampled.push(currentBucket);
  }

  return resampled;
}
