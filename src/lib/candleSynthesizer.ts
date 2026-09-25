/**
 * Real-time Candle Synthesizer.
 * Aggregates high-frequency market ticks into OHLCV candles
 * on-the-fly for any timeframe (1s, 5s, 15s, 1min, etc.).
 */
import type { MarketTick, RawBar, Timeframe } from '../types';
import { TF_SECONDS } from '../types';

export function getBucketTimestamp(time: string | number, timeframe: Timeframe): string {
  const date = typeof time === 'number' 
    ? new Date(time) 
    : new Date(String(time).replace(' ', 'T') + (String(time).includes('Z') ? '' : 'Z'));
  
  const ms = date.getTime();
  if (isNaN(ms)) {
    return typeof time === 'string' ? time.slice(0, 19) : new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  const durationSec = TF_SECONDS[timeframe] || 60;

  if (timeframe === '1D') {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} 00:00:00`;
  }

  const bucketStartMs = Math.floor(ms / (durationSec * 1000)) * (durationSec * 1000);
  const bDate = new Date(bucketStartMs);

  const yyyy = bDate.getUTCFullYear();
  const mm = String(bDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(bDate.getUTCDate()).padStart(2, '0');
  const hh = String(bDate.getUTCHours()).padStart(2, '0');
  const min = String(bDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(bDate.getUTCSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

export function applyTickToCandles(
  candles: RawBar[],
  tick: MarketTick,
  timeframe: Timeframe
): RawBar[] {
  if (!tick || isNaN(tick.price)) return candles;

  const bucketTime = getBucketTimestamp(tick.time, timeframe);
  const tickVol = tick.volume !== undefined && tick.volume !== null ? tick.volume : 1.0;
  const session = tick.session || 'REG';

  if (!candles || candles.length === 0) {
    return [
      {
        time: bucketTime,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tickVol,
        session,
        tickCount: 1,
      },
    ];
  }

  const lastCandle = candles[candles.length - 1];

  if (lastCandle.time === bucketTime) {
    const updatedLast: RawBar = {
      ...lastCandle,
      high: Math.max(lastCandle.high, tick.price),
      low: Math.min(lastCandle.low, tick.price),
      close: tick.price,
      volume: Number((lastCandle.volume + tickVol).toFixed(4)),
      tickCount: (lastCandle.tickCount || 1) + 1,
    };
    return [...candles.slice(0, -1), updatedLast];
  } else {
    const newCandle: RawBar = {
      time: bucketTime,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: tickVol,
      session,
      tickCount: 1,
    };
    return [...candles, newCandle];
  }
}

export function buildCandlesFromTicks(
  ticks: MarketTick[],
  timeframe: Timeframe
): RawBar[] {
  let candles: RawBar[] = [];
  for (const tick of ticks) {
    candles = applyTickToCandles(candles, tick, timeframe);
  }
  return candles;
}
