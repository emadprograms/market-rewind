import type { MarketTick, RawBar, Timeframe } from '../types';
import { TF_SECONDS } from '../types';
import { isoToMs, msToIso } from '../store/usePlaybackStore';
import { getBucketTimestamp } from './candleSynthesizer';

/**
 * Synthesizes 4 realistic micro-ticks per minute from 1-minute OHLCV bars.
 * Allows replaying any historical day/symbol tick-by-tick even when raw tick data is absent.
 */
export function synthesizeTicksFromBars(bars: RawBar[], symbol: string): MarketTick[] {
  const ticks: MarketTick[] = [];
  const sym = symbol.toUpperCase();

  for (const bar of bars) {
    if (!bar || isNaN(bar.open) || isNaN(bar.close)) continue;

    const baseMs = isoToMs(bar.time);
    if (!baseMs) continue;

    const vol = Math.max(1, bar.volume || 1);
    const quarterVol = Number((vol / 4).toFixed(2));
    const session = bar.session || 'REG';

    // Intraminute price path: Open -> First Extreme -> Second Extreme -> Close
    const isBullish = bar.close >= bar.open;
    const firstExtreme = isBullish ? bar.low : bar.high;
    const secondExtreme = isBullish ? bar.high : bar.low;

    // Tick 1: Open at :00.000
    ticks.push({
      time: msToIso(baseMs) + '.000',
      symbol: sym,
      price: bar.open,
      volume: quarterVol,
      bid: Number((bar.open - 0.01).toFixed(2)),
      ask: Number((bar.open + 0.01).toFixed(2)),
      session,
      source: 'SYNTHETIC',
    });

    // Tick 2: First Extreme at :15.000
    ticks.push({
      time: msToIso(baseMs + 15000) + '.000',
      symbol: sym,
      price: firstExtreme,
      volume: quarterVol,
      bid: Number((firstExtreme - 0.01).toFixed(2)),
      ask: Number((firstExtreme + 0.01).toFixed(2)),
      session,
      source: 'SYNTHETIC',
    });

    // Tick 3: Second Extreme at :35.000
    ticks.push({
      time: msToIso(baseMs + 35000) + '.000',
      symbol: sym,
      price: secondExtreme,
      volume: quarterVol,
      bid: Number((secondExtreme - 0.01).toFixed(2)),
      ask: Number((secondExtreme + 0.01).toFixed(2)),
      session,
      source: 'SYNTHETIC',
    });

    // Tick 4: Close at :55.000
    ticks.push({
      time: msToIso(baseMs + 55000) + '.000',
      symbol: sym,
      price: bar.close,
      volume: quarterVol,
      bid: Number((bar.close - 0.01).toFixed(2)),
      ask: Number((bar.close + 0.01).toFixed(2)),
      session,
      source: 'SYNTHETIC',
    });
  }

  return ticks;
}

/**
 * Builds a forming candle from a slice of ticks within a timeframe bucket.
 * Accurately tracks Open, High, Low, Close, and cumulative Volume across all ticks in the bucket.
 */
export function buildCandleFromTickSlice(
  ticks: MarketTick[],
  startIndex: number,
  endIndex: number,
  bucketTime: string,
  session: string = 'REG'
): RawBar | null {
  if (!ticks || startIndex > endIndex || startIndex < 0 || endIndex >= ticks.length) {
    return null;
  }

  let open = NaN;
  let high = -Infinity;
  let low = Infinity;
  let close = NaN;
  let volume = 0;
  let tickCount = 0;

  for (let i = startIndex; i <= endIndex; i++) {
    const t = ticks[i];
    if (!t || isNaN(t.price)) continue;

    if (tickCount === 0) {
      open = t.price;
      high = t.price;
      low = t.price;
    } else {
      if (t.price > high) high = t.price;
      if (t.price < low) low = t.price;
    }
    close = t.price;
    const vol = t.volume !== undefined && t.volume !== null ? t.volume : 1.0;
    volume += vol;
    tickCount++;
  }

  if (tickCount === 0) return null;

  return {
    time: bucketTime,
    open,
    high,
    low,
    close,
    volume: Number(volume.toFixed(4)),
    session,
    tickCount,
  };
}
