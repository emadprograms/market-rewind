/**
 * Harness for the 1D canvas-formation regression suite.
 *
 * WHY THIS EXISTS
 *
 * Every existing multi-chart test asserts on `useChartData().chartData` — the React *snapshot*.
 * During playback that snapshot is deliberately frozen (PERF-01) and the canvas is driven by
 * `useChartLifecycle` subscriber 6, which writes straight to the lightweight-charts series. A
 * defect in that path is invisible to snapshot assertions, which is how "the 1D candle only appears
 * when I pause" survived a green suite.
 *
 * These fakes record what is actually written to the series, and they enforce the two
 * lightweight-charts invariants the real library enforces, so an illegal write fails the test
 * instead of silently vanishing from the chart:
 *
 *   - `setData()` requires strictly ascending, unique times.
 *   - `update()` may only replace the last bar or append a newer one; updating an older time throws.
 */
import { vi } from 'vitest';
import type { MarketTick, RawBar } from '../../../src/types';

export interface FakeSeries {
  bars: any[];
  writes: Array<{ op: 'setData' | 'update'; bar: any }>;
  errors: string[];
  setData: (data: any[]) => void;
  update: (bar: any) => void;
  data: () => any[];
  applyOptions: ReturnType<typeof vi.fn>;
  attachPrimitive: ReturnType<typeof vi.fn>;
  detachPrimitive: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  removePriceLine: ReturnType<typeof vi.fn>;
  priceScale: () => { applyOptions: ReturnType<typeof vi.fn> };
}

export function createFakeSeries(): FakeSeries {
  const bars: any[] = [];
  const writes: Array<{ op: 'setData' | 'update'; bar: any }> = [];
  const errors: string[] = [];
  const series: FakeSeries = {
    bars,
    writes,
    errors,
    setData(data: any[]) {
      try {
        for (let i = 1; i < data.length; i++) {
          if (data[i].time <= data[i - 1].time) {
            throw new Error(
              `setData: non-ascending or duplicate time at index ${i} (${data[i - 1].time} -> ${data[i].time})`
            );
          }
        }
        bars.length = 0;
        for (const bar of data) {
          bars.push({ ...bar });
          writes.push({ op: 'setData', bar: { ...bar } });
        }
      } catch (err: any) {
        errors.push(String(err?.message || err));
        throw err;
      }
    },
    update(bar: any) {
      try {
        writes.push({ op: 'update', bar: { ...bar } });
        if (bars.length === 0) {
          bars.push({ ...bar });
          return;
        }
        const last = bars[bars.length - 1];
        if (bar.time === last.time) {
          bars[bars.length - 1] = { ...bar };
          return;
        }
        if (bar.time > last.time) {
          bars.push({ ...bar });
          return;
        }
        throw new Error(`update: cannot update oldest data (time=${bar.time}, last=${last.time})`);
      } catch (err: any) {
        errors.push(String(err?.message || err));
        throw err;
      }
    },
    data: () => bars,
    applyOptions: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
    removePriceLine: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
  };
  return series;
}

export function createFakeChart() {
  const timeScale = {
    applyOptions: vi.fn(),
    getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 100 })),
    getVisibleRange: vi.fn(() => null),
    setVisibleLogicalRange: vi.fn(),
    scrollToRealTime: vi.fn(),
    scrollToPosition: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    subscribeVisibleTimeRangeChange: vi.fn(),
    unsubscribeVisibleTimeRangeChange: vi.fn(),
    fitContent: vi.fn(),
    resetTimeScale: vi.fn(),
    coordinateToTime: vi.fn(() => null),
    timeToCoordinate: vi.fn(() => null),
    logicalToCoordinate: vi.fn(() => null),
    width: 800,
  };
  const priceScale = { applyOptions: vi.fn(), width: vi.fn(() => 60) };
  return {
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: () => timeScale,
    priceScale: () => priceScale,
    subscribeClick: vi.fn(),
    unsubscribeClick: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    subscribeDblClick: vi.fn(),
    unsubscribeDblClick: vi.fn(),
    addCandlestickSeries: vi.fn(() => createFakeSeries()),
    addHistogramSeries: vi.fn(() => createFakeSeries()),
    removeSeries: vi.fn(),
    resize: vi.fn(),
    chartOptions: vi.fn(() => ({})),
    paneViews: vi.fn(() => []),
    series: vi.fn(() => []),
  };
}

export interface ChartInstance {
  chart: any;
  price: FakeSeries;
  volume: FakeSeries;
}

/** One entry per mounted chart, in mount order. Cleared by `resetChartRegistry()`. */
export const chartRegistry: ChartInstance[] = [];

export function resetChartRegistry() {
  chartRegistry.length = 0;
}

export function mountChartInstance(): ChartInstance {
  const instance: ChartInstance = {
    chart: createFakeChart(),
    price: createFakeSeries(),
    volume: createFakeSeries(),
  };
  chartRegistry.push(instance);
  return instance;
}

/* -------------------------------------------------------------------------- */
/* Fixtures: lake-shaped data for TSLA, 2026-10-05 .. 2026-10-15 (EDT, UTC-4) */
/* -------------------------------------------------------------------------- */

export const SYMBOL = 'TSLA';
export const SELECTED_DATE = '2026-10-15';

/** UTC seconds for the 1D bucket of a date (noon UTC — the app's daily convention). */
export const dailyBucketSec = (date: string): number =>
  Math.floor(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 12, 0, 0) / 1000);

export const utc = (iso: string): number => new Date(iso).getTime();

/** RTH window for an EDT date, in UTC ms. */
export const rthOpenMs = (date: string) => utc(`${date}T13:30:00Z`);
export const rthCloseMs = (date: string) => utc(`${date}T20:00:00Z`);

/**
 * One minute bar, shaped exactly as `streamingClient.getCandles` delivers intraday candles:
 * the service's candle projection returns no `session` column, and the client must NOT invent one
 * (see tests/unit/streamingClientSession.test.ts). A fabricated `'REG'` here would make every
 * overnight/pre/post minute claim to be RTH and defeat the filter under test.
 */
function minute(time: string, open: number, high: number, low: number, close: number, volume: number): RawBar {
  return { time, open, high, low, close, volume, tickCount: 20, symbol: SYMBOL } as RawBar;
}

/**
 * 1-minute bars for one UTC day, covering overnight / pre-market / RTH / post-market.
 * ETH prices are deliberately far outside the RTH range so any leak into a daily candle is
 * unmistakable: overnight 100, pre-market 110, post-market 240, RTH 250..260.
 */
export function minuteBarsForDay(date: string, opts: { lastUtcHour?: number } = {}): RawBar[] {
  const bars: RawBar[] = [];
  const lastHour = opts.lastUtcHour ?? 23;
  for (let h = 0; h <= lastHour; h++) {
    for (let m = 0; m < 60; m++) {
      const time = `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
      const minutes = h * 60 + m;
      if (minutes < 8 * 60) {
        // Overnight (previous ET evening) — 100 level
        bars.push(minute(time, 100, 100.5, 99.5, 100.2, 10));
      } else if (minutes < 13 * 60 + 30) {
        // Pre-market — 110 level
        bars.push(minute(time, 110, 110.5, 109.5, 110.2, 20));
      } else if (minutes < 20 * 60) {
        // RTH — 250..260, opens at 250, peaks at 260 (16:00 UTC), trough 249 (14:00 UTC), closes 255
        let open = 252;
        let high = 252.5;
        let low = 251.5;
        let close = 252.2;
        if (h === 13 && m === 30) { open = 250; high = 251; low = 250; close = 250.5; }
        if (h === 14 && m === 0) { open = 251; high = 251.2; low = 249; close = 249.8; }
        if (h === 16 && m === 0) { open = 259; high = 260; low = 258.8; close = 259.7; }
        if (h === 19 && m === 59) { open = 255.1; high = 255.4; low = 254.9; close = 255; }
        bars.push(minute(time, open, high, low, close, 1000));
      } else {
        // Post-market — 240 level
        bars.push(minute(time, 240, 240.5, 239.5, 240.2, 30));
      }
    }
  }
  return bars;
}

/** The exact RTH-only aggregate of `minuteBarsForDay` (the value the backend's tf=1d returns). */
export const RTH_DAILY = {
  open: 250,
  high: 260,
  low: 249,
  close: 255,
  volume: 390 * 1000, // 390 RTH minutes x 1000
};

/**
 * Daily bars as `/api/streaming/candles?tf=1d&session=REG` returns them after client
 * normalisation: midnight-UTC timestamps, session defaulted to REG.
 */
export function dailyBars(dates: string[]): RawBar[] {
  return dates.map((date) => ({
    time: `${date} 00:00:00`,
    open: RTH_DAILY.open,
    high: RTH_DAILY.high,
    low: RTH_DAILY.low,
    close: RTH_DAILY.close,
    volume: RTH_DAILY.volume,
    session: 'REG',
    tickCount: 39000,
    symbol: SYMBOL,
  } as RawBar));
}

/** Session tape for the selected date: pre-market (PRE) then RTH (REG) prints. */
export function ticksForDay(date: string, opts: { lastUtcMinute?: number } = {}): MarketTick[] {
  const ticks: MarketTick[] = [];
  const lastMinute = opts.lastUtcMinute ?? 14 * 60 + 30;
  // Pre-market prints: 13:00 .. 13:29 UTC — outside RTH, price level 110.
  for (let m = 13 * 60; m < 13 * 60 + 30; m += 5) {
    ticks.push({
      time: `${date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:10.000`,
      symbol: SYMBOL,
      price: 110,
      volume: 50,
      session: 'PRE',
    } as MarketTick);
  }
  // RTH prints: 13:30 .. lastMinute UTC — price walks 251 -> 256.
  let i = 0;
  for (let m = 13 * 60 + 30; m <= lastMinute; m += 1) {
    ticks.push({
      time: `${date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:05.000`,
      symbol: SYMBOL,
      price: Number((251 + (i % 6) * 1).toFixed(2)),
      volume: 100,
      session: 'REG',
    } as MarketTick);
    i++;
  }
  return ticks;
}

/** History dates used by the fixtures (weekdays only). */
export const HISTORY_DATES = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'];
