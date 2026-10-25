/**
 * Regression: the 1D candle must form on the canvas *while playing*, and every completed day must
 * match the backend's RTH-only daily aggregate — in a multi-chart layout as well as a lone chart.
 *
 * User report (2026-10-17):
 *   "if I'm loading into 15th October, and if you look at 14th October's candle, that candle is
 *    wrong ... when the playback is playing the one day chart ... the latest candle, if I am in
 *    15th October, there is no candle visible, the price is moving around, and only when I pause
 *    the candle becomes visible ... it fails when there are two charts, both for the same symbol:
 *    5 minutes on the left, 1 day on the right. One day being the only chart works fine."
 *
 * Unlike tests/integration/multiChartWorkspaceReplay.test.tsx, these assertions read the bars that
 * were actually written to the price/volume series (setData/update), because during playback the
 * React snapshot is frozen by design (PERF-01) and only the series reflects what the user sees.
 */
import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useChartData } from '../../../src/hooks/useChartData';
import { useChartLifecycle } from '../../../src/hooks/useChartLifecycle';
import { streamingClient } from '../../../src/lib/streamingClient';
import { usePlaybackStore } from '../../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../../src/store/useWorkspaceStore';
import type { RawBar, Timeframe } from '../../../src/types';
import {
  chartRegistry,
  createFakeSeries,
  dailyBars,
  dailyBucketSec,
  HISTORY_DATES,
  minuteBarsForDay,
  mountChartInstance,
  resetChartRegistry,
  RTH_DAILY,
  rthOpenMs,
  SELECTED_DATE,
  SYMBOL,
  ticksForDay,
  utc,
} from './dailyChartHarness';

/* ---------------------------------------------------------------- mocks --- */

vi.mock('../../../src/lib/streamingClient', () => ({
  streamingClient: {
    getCandles: vi.fn(),
    getTicks: vi.fn(),
    getBaseUrl: vi.fn(() => 'http://localhost:8765'),
    getStatus: vi.fn(async () => ({ status: 'ok' })),
  },
}));

// Per-mount stable series, recorded in mount order (chart 0 = 5min, chart 1 = 1D).
vi.mock('../../../src/hooks/chart/useChartInit', async () => {
  const React = await import('react');
  const { mountChartInstance } = await import('./dailyChartHarness');
  return {
    useChartInit: () => {
      const ref = (React as any).useRef<any>(null);
      if (!ref.current) ref.current = mountChartInstance();
      return {
        chartRef: { current: ref.current.chart },
        priceSeriesRef: { current: ref.current.price },
        volumeSeriesRef: { current: ref.current.volume },
        lastBarSpacingRef: { current: null },
      };
    },
  };
});

vi.mock('../../../src/hooks/chart/useChartPlugins', () => ({
  useChartPlugins: () => ({
    shadingPluginRef: { current: null },
    vpPluginRef: { current: null },
    rayPluginRef: { current: null },
    rectPluginRef: { current: null },
    tradePluginRef: { current: null },
    updateShadingConfig: vi.fn(),
    pluginVersion: 0,
  }),
}));

vi.mock('../../../src/hooks/chart/useChartViewport', () => ({
  useChartViewport: () => ({
    syncViewport: vi.fn(),
    scrollToRealTime: vi.fn(),
    resetView: vi.fn(),
  }),
}));

vi.mock('../../../src/hooks/chart/useChartDrawings', () => ({
  useChartDrawings: () => undefined,
}));

/* ------------------------------------------------------------- fixtures --- */

const MINUTE_BARS: RawBar[] = [
  ...minuteBarsForDay('2026-10-13'),
  ...minuteBarsForDay('2026-10-14'),
  ...minuteBarsForDay(SELECTED_DATE),
];

const TICKS = ticksForDay(SELECTED_DATE);

/** 09:10 ET entry on the selected date (the app's default pre-open anchor). */
const ENTRY_MS = utc(`${SELECTED_DATE}T13:10:00Z`);

const FIVE_MIN_BARS: RawBar[] = Array.from({ length: 60 }, (_, i) => ({
  time: `2026-10-14 ${String(13 + Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}:00`,
  open: 250 + i * 0.1,
  high: 251 + i * 0.1,
  low: 249 + i * 0.1,
  close: 250.5 + i * 0.1,
  volume: 5000,
  session: 'REG',
  symbol: SYMBOL,
} as RawBar));

/* -------------------------------------------------------------- harness --- */

interface ChartProps {
  id: number;
  initialTf: Timeframe;
  initialEth: boolean;
  selectedDate?: string;
}

/** Live view of each mounted chart, so tests can assert on hydration/snapshot state. */
export const liveCharts: Record<number, { isHydrated: boolean; chartData: any[]; snapshotLen: number }> = {};

/** Mirrors src/components/ChartUnit.tsx: useChartData feeds useChartLifecycle. */
function ChartHarness({ id, initialTf, initialEth, selectedDate = SELECTED_DATE }: ChartProps) {
  const chartRef = useRef<any>(null);
  const priceSeriesRef = useRef<any>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tradeBadgeRef = useRef<HTMLDivElement>(null);

  const data = useChartData({
    initialTicker: SYMBOL,
    initialTf,
    initialEth,
    selectedDate,
    isReplayMode: true,
    groupColor: 'none',
    tickers: [SYMBOL],
    chartRef,
    priceSeriesRef,
    id,
  } as any);

  const lifecycle = useChartLifecycle({
    chartContainerRef,
    ticker: data.ticker,
    timeframe: data.timeframe,
    showEth: data.showEth,
    showVP: false,
    chartData: data.chartData as any,
    localMasterData: data.localMasterData,
    isReplayMode: true,
    isLoadingHistory: data.isLoadingHistory,
    pendingHistoryPrependRef: data.pendingHistoryPrependRef,
    isDrawingMode: false,
    drawType: 'ray' as any,
    rectAnchor: null,
    setRectAnchor: vi.fn() as any,
    ghostPoint: null,
    setGhostPoint: vi.fn() as any,
    drawings: { rays: [], rects: [] } as any,
    onUpdateDrawings: vi.fn(),
    activeTrade: null,
    tradeBadgeRef,
    chartRef,
    priceSeriesRef,
    onFocus: vi.fn(),
  } as any);

  liveCharts[id] = {
    isHydrated: Boolean((lifecycle as any)?.isHydrated),
    chartData: data.chartData as any[],
    snapshotLen: (data.chartData as any[]).length,
  };

  return <div className="chart-card"><div ref={chartContainerRef} data-testid={`chart-${id}`} /></div>;
}

const flush = async (ms = 30) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

/**
 * Hydration is asynchronous by design: effect 3 schedules `setIsHydrated(true)` on a
 * requestAnimationFrame. Tests must wait for it, otherwise they measure their own impatience
 * instead of product behaviour (this produced a false "candle never drawn while playing" signal).
 */
const waitForHydration = async (id: number, timeoutMs = 800) => {
  const started = Date.now();
  while (!liveCharts[id]?.isHydrated && Date.now() - started < timeoutMs) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
};

/** Advance the replay clock frame by frame, the way the playback loop does. */
const playFrames = async (timesMs: number[]) => {
  for (const t of timesMs) {
    await act(async () => {
      usePlaybackStore.getState().advanceSimulationTime(t);
    });
  }
};

const resetStores = () => {
  resetChartRegistry();
  usePlaybackStore.setState({
    replayMode: 'tick',
    currentTime: ENTRY_MS,
    isPaused: true,
    playbackSpeed: 1,
    stepMinutes: 3,
    masterData: MINUTE_BARS,
    isLoadingTicks: false,
    bufferedTicks: TICKS,
    ticksBySymbol: { [SYMBOL]: TICKS },
    latestTickBySymbol: {},
    currentTickIndex: 0,
    currentTick: null,
    totalTicks: TICKS.length,
    seekEpoch: 0,
  } as any);

  useWorkspaceStore.setState({
    tickers: { '0': SYMBOL, '1': SYMBOL },
    timeframes: { '0': '5min', '1': '1D' },
    groups: { '0': 'none', '1': 'none' },
    groupTickers: {},
  } as any);

  vi.mocked(streamingClient.getCandles).mockImplementation(async (_symbol: string, opts: any) => {
    if (opts?.timeframe === '1D') return dailyBars([...HISTORY_DATES, SELECTED_DATE]);
    if (opts?.timeframe === '5min') return FIVE_MIN_BARS;
    if (opts?.timeframe === '1min') return MINUTE_BARS;
    return [];
  });
  vi.mocked(streamingClient.getTicks).mockResolvedValue(TICKS);
};

/* ---------------------------------------------------------------- tests --- */

/** Counts rAF scheduling so we can tell "never scheduled" from "scheduled but never applied". */
let rafScheduled = 0;
let rafFired = 0;
function installRafProbe() {
  rafScheduled = 0;
  rafFired = 0;
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafScheduled++;
    return setTimeout(() => { rafFired++; cb(Date.now()); }, 0) as unknown as number;
  };
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}

describe('1D canvas formation during multi-chart playback (2026-10-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installRafProbe();
    resetStores();
  });

  it('draws the forming 2026-10-15 daily candle on the canvas WHILE PLAYING (not only after pause)', async () => {
    render(<ChartHarness id={0} initialTf={'5min' as Timeframe} initialEth={true} />);
    render(<ChartHarness id={1} initialTf={'1D' as Timeframe} initialEth={false} />);
    await flush();
    await waitForHydration(1);

    expect(chartRegistry.length).toBe(2);
    const daily = chartRegistry[1];

    // Pre-open: no candle for the selected date yet (RTH-only policy), history is present.
    const preOpenTimes = daily.price.bars.map((b) => b.time);
    expect(preOpenTimes).not.toContain(dailyBucketSec(SELECTED_DATE));
    expect(preOpenTimes.length).toBeGreaterThan(1);

    // Press play and run frames from 09:31 ET to 09:40 ET.
    await act(async () => {
      usePlaybackStore.getState().setPaused(false);
    });
    const frames = Array.from({ length: 10 }, (_, i) => rthOpenMs(SELECTED_DATE) + (i + 1) * 60000);
    await playFrames(frames);

    const rendered = daily.price.bars.map((b) => b.time);
    expect(
      rendered,
      `1D series during playback must contain the forming ${SELECTED_DATE} bucket; got ${rendered.length} bars, last=${rendered[rendered.length - 1]}`
    ).toContain(dailyBucketSec(SELECTED_DATE));

    // The candle must be a real OHLC body built from RTH prints, not a flat single-tick doji.
    const forming = daily.price.bars.find((b) => b.time === dailyBucketSec(SELECTED_DATE));
    expect(forming.high).toBeGreaterThan(forming.low);
  });

  it('renders the completed 2026-10-14 candle as the RTH-only aggregate (no overnight/pre/post leak)', async () => {
    render(<ChartHarness id={0} initialTf={'5min' as Timeframe} initialEth={true} />);
    render(<ChartHarness id={1} initialTf={'1D' as Timeframe} initialEth={false} />);
    await flush();
    await waitForHydration(1);

    await act(async () => {
      usePlaybackStore.getState().setPaused(false);
    });
    await playFrames([
      rthOpenMs(SELECTED_DATE) + 60000,
      rthOpenMs(SELECTED_DATE) + 120000,
      rthOpenMs(SELECTED_DATE) + 600000,
    ]);

    const daily = chartRegistry[1];
    const oct14 = daily.price.bars.find((b) => b.time === dailyBucketSec('2026-10-14'));
    expect(oct14, 'the 2026-10-14 daily candle must be on the canvas').toBeDefined();

    // ETH levels in the fixture: overnight 100, pre-market 110, post-market 240 — all outside RTH.
    expect(oct14!.open, '14 Oct open must be the first RTH print, not an overnight/pre-market bar').toBe(RTH_DAILY.open);
    expect(oct14!.high).toBe(RTH_DAILY.high);
    expect(oct14!.low, '14 Oct low must not be dragged down by post-market prints').toBe(RTH_DAILY.low);
    expect(oct14!.close).toBe(RTH_DAILY.close);

    const vol14 = daily.volume.bars.find((b) => b.time === dailyBucketSec('2026-10-14'));
    expect(vol14, '14 Oct volume histogram must exist').toBeDefined();
    expect(vol14!.value, '14 Oct volume must be RTH-only').toBe(RTH_DAILY.volume);
  });

  it('never issues an illegal series write (duplicate/older time) on the 1D chart', async () => {
    render(<ChartHarness id={0} initialTf={'5min' as Timeframe} initialEth={true} />);
    render(<ChartHarness id={1} initialTf={'1D' as Timeframe} initialEth={false} />);
    await flush();
    await waitForHydration(1);

    await act(async () => {
      usePlaybackStore.getState().setPaused(false);
    });
    await playFrames(Array.from({ length: 8 }, (_, i) => rthOpenMs(SELECTED_DATE) + (i + 1) * 60000));
    await act(async () => {
      usePlaybackStore.getState().setPaused(true);
    });
    await flush();

    const daily = chartRegistry[1];
    expect(daily.price.errors, `price series write errors: ${daily.price.errors.join(' | ')}`).toEqual([]);
    expect(daily.volume.errors, `volume series write errors: ${daily.volume.errors.join(' | ')}`).toEqual([]);

    const times = daily.price.bars.map((b) => b.time);
    expect(new Set(times).size, 'one bar per trading day, strictly ascending').toBe(times.length);
    expect(times[times.length - 1]).toBeLessThanOrEqual(dailyBucketSec(SELECTED_DATE));
  });

  it('behaves identically when the 1D chart is the ONLY chart (reported working case)', async () => {
    render(<ChartHarness id={0} initialTf={'1D' as Timeframe} initialEth={false} />);
    await flush();
    await waitForHydration(0);

    await act(async () => {
      usePlaybackStore.getState().setPaused(false);
    });
    await playFrames(Array.from({ length: 10 }, (_, i) => rthOpenMs(SELECTED_DATE) + (i + 1) * 60000));

    expect(chartRegistry.length).toBe(1);
    const daily = chartRegistry[0];
    const rendered = daily.price.bars.map((b) => b.time);
    expect(rendered).toContain(dailyBucketSec(SELECTED_DATE));

    const oct14 = daily.price.bars.find((b) => b.time === dailyBucketSec('2026-10-14'));
    expect(oct14).toBeDefined();
    expect(oct14!.open).toBe(RTH_DAILY.open);
    expect(oct14!.low).toBe(RTH_DAILY.low);
    expect(daily.price.errors).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * Diagnostics + the "replay ON 2026-10-14" case (ETH leak into the forming
 * daily candle via buildDailyIndex(..., '1D')).
 * ------------------------------------------------------------------------- */
import { isRthTick } from '../../../src/lib/timezones';

describe('1D diagnostics: which guard blocks the canvas path during playback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installRafProbe();
    resetStores();
  });

  it('subscriber 6 reaches the daily branch (hydrated, RTH tick, elapsed ticks available)', async () => {
    render(<ChartHarness id={0} initialTf={'5min' as Timeframe} initialEth={true} />);
    render(<ChartHarness id={1} initialTf={'1D' as Timeframe} initialEth={false} />);
    await flush();
    await waitForHydration(1);

    await act(async () => {
      usePlaybackStore.getState().setPaused(false);
    });
    await playFrames([rthOpenMs(SELECTED_DATE) + 60000, rthOpenMs(SELECTED_DATE) + 120000]);

    const st = usePlaybackStore.getState();
    const latest = st.latestTickBySymbol?.[SYMBOL] ||
      (st.currentTick?.symbol?.toUpperCase() === SYMBOL ? st.currentTick : null);
    const daily = chartRegistry[1];

    const diag = {
      isPaused: st.isPaused,
      currentTimeIso: new Date(st.currentTime || 0).toISOString(),
      snapshotLen: liveCharts[1]?.snapshotLen,
      snapshotTimes: (liveCharts[1]?.chartData || []).map((b: any) => String(b.time)),
      isHydrated: liveCharts[1]?.isHydrated,
      hasSeries: Boolean(daily?.price),
      priceLineCalls: daily?.price?.createPriceLine?.mock?.calls?.length ?? -1,
      latestTick: latest ? { time: latest.time, price: latest.price, session: (latest as any).session } : null,
      latestIsRth: latest ? isRthTick(latest as any, SYMBOL) : null,
      symbolTickCount: st.ticksBySymbol?.[SYMBOL]?.length ?? 0,
      bufferedTickCount: st.bufferedTicks?.length ?? 0,
      masterDataLen: st.masterData?.length ?? 0,
      priceWrites: daily?.price?.writes?.length ?? -1,
      renderedTimes: daily?.price?.bars?.map((b: any) => b.time) ?? [],
      seriesErrors: daily?.price?.errors ?? [],
      rafScheduled,
      rafFired,
    };
    // eslint-disable-next-line no-console
    console.log('[1D-DIAG]', JSON.stringify(diag, null, 2));

    // Preconditions the canvas path needs. Each assertion names the guard that would block.
    expect(diag.isPaused, 'store must be playing').toBe(false);
    expect(diag.snapshotLen, 'snapshot must not be empty (empty snapshot never hydrates)').toBeGreaterThan(1);
    expect(diag.isHydrated, 'effect 3 must have hydrated the series, else subscriber 6 returns early').toBe(true);
    expect(diag.latestTick, 'a latest tick for the symbol must exist').toBeTruthy();
    expect(diag.latestIsRth, 'latest tick must be RTH for the 1D path').toBe(true);
    expect(diag.symbolTickCount, 'ticksBySymbol must hold the session tape').toBeGreaterThan(0);
    expect(diag.priceLineCalls, 'subscriber 6 must have reached updateBidAskPriceLines').toBeGreaterThan(0);
  });
});

describe('1D forming candle while replaying ON 2026-10-14', () => {
  const REPLAY_DATE = '2026-10-14';
  const REPLAY_ENTRY = utc(`${REPLAY_DATE}T13:10:00Z`);
  const REPLAY_TICKS = ticksForDay(REPLAY_DATE);
  const REPLAY_MINUTES: RawBar[] = [
    ...minuteBarsForDay('2026-10-12'),
    ...minuteBarsForDay('2026-10-13'),
    ...minuteBarsForDay(REPLAY_DATE),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    installRafProbe();
    resetChartRegistry();
    usePlaybackStore.setState({
      replayMode: 'tick',
      currentTime: REPLAY_ENTRY,
      isPaused: true,
      playbackSpeed: 1,
      stepMinutes: 3,
      masterData: REPLAY_MINUTES,
      isLoadingTicks: false,
      bufferedTicks: REPLAY_TICKS,
      ticksBySymbol: { [SYMBOL]: REPLAY_TICKS },
      latestTickBySymbol: {},
      currentTickIndex: 0,
      currentTick: null,
      totalTicks: REPLAY_TICKS.length,
      seekEpoch: 0,
    } as any);
    useWorkspaceStore.setState({
      tickers: { '0': SYMBOL },
      timeframes: { '0': '1D' },
      groups: { '0': 'none' },
      groupTickers: {},
    } as any);
    vi.mocked(streamingClient.getCandles).mockImplementation(async (_s: string, opts: any) => {
      if (opts?.timeframe === '1D') return dailyBars(HISTORY_DATES); // includes the replayed day
      if (opts?.timeframe === '1min') return REPLAY_MINUTES;
      return FIVE_MIN_BARS;
    });
    vi.mocked(streamingClient.getTicks).mockResolvedValue(REPLAY_TICKS);
  });

  it('builds the forming 2026-10-14 candle from RTH bars only (open 250, not the overnight 100)', async () => {
    render(<ChartHarness id={0} initialTf={'1D' as Timeframe} initialEth={false} selectedDate={REPLAY_DATE} />);
    await flush();
    await waitForHydration(0);

    await act(async () => {
      usePlaybackStore.getState().setPaused(false);
    });
    await playFrames(Array.from({ length: 10 }, (_, i) => rthOpenMs(REPLAY_DATE) + (i + 1) * 60000));

    const daily = chartRegistry[0];
    const forming = daily.price.bars.find((b) => b.time === dailyBucketSec(REPLAY_DATE));
    const snapshotForming = (liveCharts[0]?.chartData || []).find((b: any) => String(b.time).startsWith(REPLAY_DATE));

    // eslint-disable-next-line no-console
    console.log('[1D-ON-14]', JSON.stringify({
      canvasForming: forming ?? null,
      snapshotForming: snapshotForming ?? null,
      volumeBar: daily.volume.bars.find((b) => b.time === dailyBucketSec(REPLAY_DATE)) ?? null,
    }, null, 2));

    expect(forming, 'the forming daily candle must be on the canvas during playback').toBeDefined();
    expect(forming!.open, 'daily open must be the first RTH print (250), never an overnight/pre-market bar')
      .toBe(RTH_DAILY.open);
    expect(forming!.low, 'daily low must not include the post-market 240 level').toBeGreaterThanOrEqual(RTH_DAILY.low);
  });
});

/* ---------------------------------------------------------------------------
 * Symptom B, faithful repro: the 1D snapshot comes back EMPTY (15s fetch
 * timeout, or `LakeIncompatibleSchema` because one partition has no `session`
 * column -- tf=1d is the only query that requires it). The canvas path is then
 * gated forever and the daily candle only appears when a pause rebuilds the
 * snapshot. This is layout-independent, but a second chart doubles backend load
 * (1d resolves every partition) which is why the user sees it with 2 charts.
 * ------------------------------------------------------------------------- */
describe('1D canvas path when the daily snapshot is empty (timeout / lake session error)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installRafProbe();
    resetStores();
    vi.mocked(streamingClient.getCandles).mockImplementation(async (_s: string, opts: any) => {
      if (opts?.timeframe === '1D') return []; // <- the failure the backend produces
      if (opts?.timeframe === '5min') return FIVE_MIN_BARS;
      return MINUTE_BARS;
    });
  });

  it('still forms the daily candle on the canvas while playing, from 1-minute masterData', async () => {
    render(<ChartHarness id={0} initialTf={'5min' as Timeframe} initialEth={true} />);
    render(<ChartHarness id={1} initialTf={'1D' as Timeframe} initialEth={false} />);
    await flush();
    await waitForHydration(1);

    // Precondition: the 1D snapshot really is empty, while 1m masterData is loaded.
    expect(liveCharts[1].snapshotLen).toBe(0);
    expect(usePlaybackStore.getState().masterData.length).toBeGreaterThan(0);

    await act(async () => {
      usePlaybackStore.getState().setPaused(false);
    });
    await playFrames(Array.from({ length: 10 }, (_, i) => rthOpenMs(SELECTED_DATE) + (i + 1) * 60000));

    const daily = chartRegistry[1];
    // eslint-disable-next-line no-console
    console.log('[1D-EMPTY-SNAPSHOT]', JSON.stringify({
      isHydrated: liveCharts[1].isHydrated,
      renderedTimes: daily.price.bars.map((b) => b.time),
      priceLineCalls: daily.price.createPriceLine.mock.calls.length,
    }));

    expect(
      daily.price.bars.map((b) => b.time),
      'the forming daily candle must be drawn while playing even when the 1D snapshot is empty'
    ).toContain(dailyBucketSec(SELECTED_DATE));
  });

  it('documents the reported symptom: candle only appears after pausing', async () => {
    render(<ChartHarness id={1} initialTf={'1D' as Timeframe} initialEth={false} />);
    await flush();
    await waitForHydration(1);

    await act(async () => {
      usePlaybackStore.getState().setPaused(false);
    });
    await playFrames(Array.from({ length: 10 }, (_, i) => rthOpenMs(SELECTED_DATE) + (i + 1) * 60000));

    const whilePlaying = chartRegistry[0].price.bars.map((b) => b.time);

    await act(async () => {
      usePlaybackStore.getState().setPaused(true);
    });
    await flush();
    const afterPause = chartRegistry[0].price.bars.map((b) => b.time);

    // eslint-disable-next-line no-console
    console.log('[1D-PAUSE-RECOVERY]', JSON.stringify({ whilePlaying, afterPause }));

    // The bug: nothing while playing, candle after pause. After the fix both contain it.
    expect(afterPause).toContain(dailyBucketSec(SELECTED_DATE));
    expect(whilePlaying, 'candle must not depend on pausing').toContain(dailyBucketSec(SELECTED_DATE));
  });
});
