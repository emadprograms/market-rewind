import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartData } from '../../src/hooks/useChartData';
import { streamingClient } from '../../src/lib/streamingClient';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import type { RawBar, MarketTick } from '../../src/types';

vi.mock('../../src/lib/streamingClient', () => ({
  streamingClient: {
    getCandles: vi.fn(),
    getTicks: vi.fn(),
  },
}));

function parseAppTimeMs(timeUtc: string) {
  return new Date(timeUtc.replace(' ', 'T') + 'Z').getTime();
}

describe('Timeline Seeking Integration Tests', () => {
  const selectedDate = '2026-09-08';
  // EDT: 9:20 AM ET is 13:20 UTC, 9:30 AM ET is 13:30 UTC, 10:15 AM ET is 14:15 UTC
  const time920Ms = parseAppTimeMs('2026-09-08 13:20:00');
  const time930Ms = parseAppTimeMs('2026-09-08 13:30:00');
  const time1015Ms = parseAppTimeMs('2026-09-08 14:15:00');

  // 30 historical 5min bars from previous days
  const historicalBars: RawBar[] = Array.from({ length: 30 }, (_, i) => ({
    time: `2026-09-05 ${String(13 + Math.floor((i * 5) / 60)).padStart(2, '0')}:${String((i * 5) % 60).padStart(2, '0')}:00`,
    open: 340 + i,
    high: 345 + i,
    low: 338 + i,
    close: 342 + i,
    volume: 50000,
    session: 'REG',
  }));

  // Today's 5min bars from 9:30 to 16:00 (13:30 to 20:00 UTC)
  const today5mBars: RawBar[] = Array.from({ length: 78 }, (_, i) => {
    const totalMinutes = 30 + i * 5;
    const hour = 13 + Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return {
      time: `2026-09-08 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
      open: 350 + i * 0.5,
      high: 355 + i * 0.5,
      low: 349 + i * 0.5,
      close: 353 + i * 0.5,
      volume: 10000,
      session: 'REG',
    };
  });

  const all5mBars = [...historicalBars, ...today5mBars];

  // Ticks from 9:30 AM to 10:15 AM (inclusive of 10:15:00)
  const ticks: MarketTick[] = Array.from({ length: 45 * 60 + 1 }, (_, i) => {
    const tMs = time930Ms + i * 1000;
    const timeStr = new Date(tMs).toISOString().replace('T', ' ').slice(0, 19);
    return {
      time: timeStr,
      price: 350 + (i / 100),
      volume: 10,
      symbol: 'TSLA',
      bid: 349.9,
      ask: 350.1,
      session: 'REG',
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();

    usePlaybackStore.setState({
      currentTime: time920Ms,
      bufferedTicks: ticks,
      totalTicks: ticks.length,
      currentTickIndex: 0,
      currentTick: null,
      isPaused: true,
      playbackSpeed: 1,
      latestTickBySymbol: {},
      ticksBySymbol: { TSLA: ticks },
      masterData: [],
    });

    useWorkspaceStore.setState({
      tickers: { '0': 'TSLA' },
      timeframes: { '0': '5min' },
      groups: { '0': 'none' },
      groupTickers: {},
    });

    vi.mocked(streamingClient.getCandles).mockResolvedValue(all5mBars);
    vi.mocked(streamingClient.getTicks).mockResolvedValue(ticks);
  });

  it('preserves all historical candles and completed today candles when jumping to 10:15 AM', async () => {
    const chartRef = { current: null };
    const priceSeriesRef = { current: null };

    const { result } = renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '5min',
        initialEth: false,
        selectedDate,
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: chartRef as any,
        priceSeriesRef: priceSeriesRef as any,
        id: 0,
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // At 9:20 AM, today's candles (starting at 9:30) have not started yet.
    // Only historical bars should be present.
    expect(result.current.chartData.length).toBe(30);

    // Now user jumps to 10:15 AM immediately!
    act(() => {
      usePlaybackStore.getState().seekTickTime(time1015Ms);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // When jumping to 10:15 AM:
    // We expect:
    // - 30 historical bars from past days
    // - 9 completed 5min bars from today (9:30, 9:35, 9:40, 9:45, 9:50, 9:55, 10:00, 10:05, 10:10)
    // - 1 forming 5min bar for 10:15
    // Total = 40 bars! NOT 1 lone candle!
    console.log('Chart bars count after seek to 10:15:', result.current.chartData.length);
    console.log('First 3 bars:', result.current.chartData.slice(0, 3).map(b => b.time));
    console.log('Last 5 bars:', result.current.chartData.slice(-5).map(b => b.time));

    expect(result.current.chartData.length).toBe(40);

    // Verify the candles for today are present
    const todayBarsInChart = result.current.chartData.filter(b => b.time.startsWith('2026-09-08'));
    expect(todayBarsInChart.length).toBe(10); // 9 completed + 1 forming
    expect(todayBarsInChart[0].time).toBe('2026-09-08 13:30:00'); // 9:30 AM ET
    expect(todayBarsInChart[9].time).toBe('2026-09-08 14:15:00'); // 10:15 AM ET
  });

  it('synthesizes all elapsed intraday candles from ticks up to seek time when getCandles has only historical bars', async () => {
    // getCandles returns only historical bars (no bars for 2026-09-08)
    vi.mocked(streamingClient.getCandles).mockResolvedValue(historicalBars);

    const chartRef = { current: null };
    const priceSeriesRef = { current: null };

    const { result } = renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '5min',
        initialEth: false,
        selectedDate,
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: chartRef as any,
        priceSeriesRef: priceSeriesRef as any,
        id: 0,
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.chartData.length).toBe(30);

    // Jump to 10:15 AM
    act(() => {
      usePlaybackStore.getState().seekTickTime(time1015Ms);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    console.log('Synthesized bars count after seek to 10:15:', result.current.chartData.length);
    console.log('Bars:', result.current.chartData.map(b => b.time));

    // The user MUST see all transpired candles from 9:30 AM to 10:15 AM:
    // 9:30, 9:35, 9:40, 9:45, 9:50, 9:55, 10:00, 10:05, 10:10, 10:15 (10 bars today)
    // + 30 historical bars = 40 bars total!
    const todayBarsInChart = result.current.chartData.filter(b => b.time.startsWith('2026-09-08'));
    expect(todayBarsInChart.length).toBe(10);
    expect(result.current.chartData.length).toBe(40);
  });
  // SEEK-REBUILD-01 (debug session seek-while-playing-freeze)
  //
  // Since 261007-nsp a seek no longer pauses playback, so a seek can land while
  // `isPaused === false`. `useChartData` deliberately does NOT recompute React state on every
  // playback frame (PERF-01), and before this fix its refresh condition was
  // `isPaused || ticksChanged` -- neither of which a seek changes. The candle snapshot was
  // therefore never rebuilt for a seek-while-playing, leaving the per-tick catch-up in
  // `useChartLifecycle` as the only path that could move the chart (O(elapsed ticks) primitive
  // writes -> frozen tab), and on a rewind nothing moved at all, so candles from *after* the
  // playhead stayed on screen.
  //
  // This is the real-hook guard for the `seekEpoch` refresh; the write-count guard lives in
  // tests/unit/seekWhilePlayingFreeze.test.ts.
  it('rebuilds the candle snapshot for a forward seek AND a rewind while playing', async () => {
    const chartRef = { current: null };
    const priceSeriesRef = { current: null };

    const { result } = renderHook(() =>
      useChartData({
        initialTicker: 'TSLA',
        initialTf: '5min',
        initialEth: false,
        selectedDate,
        isReplayMode: true,
        groupColor: 'none',
        tickers: ['TSLA'],
        chartRef: chartRef as any,
        priceSeriesRef: priceSeriesRef as any,
        id: 0,
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Paused at 9:20 AM: today's session has not started, only history is rendered.
    expect(result.current.chartData.length).toBe(30);

    // Arm playback, then seek forward WITHOUT pausing (the 261007-nsp behaviour).
    // One millisecond short of the last buffered tick: seeking onto exactly the final tick is
    // end-of-session and auto-pauses by design, which would leave the state under test. The
    // forming 5-minute bucket is 10:15 either way.
    act(() => {
      usePlaybackStore.getState().setPaused(false);
    });
    act(() => {
      usePlaybackStore.getState().seekTickTime(time1015Ms - 1);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Seeking must not pause, and the snapshot must have caught up to the playhead: the
    // forming 5-minute bucket at 10:14:59.999 is 10:10, so 30 historical + 8 completed today
    // (9:30..10:05) + 1 forming (10:10) = 39 bars.
    expect(usePlaybackStore.getState().isPaused).toBe(false);
    expect(result.current.chartData.length).toBe(39);
    const forwardToday = result.current.chartData.filter(b => b.time.startsWith('2026-09-08'));
    expect(forwardToday.length).toBe(9);
    expect(forwardToday[forwardToday.length - 1].time).toBe('2026-09-08 14:10:00');

    // Rewind to 9:30 AM, still playing: the future candles must disappear.
    act(() => {
      usePlaybackStore.getState().seekTickTime(time930Ms);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(usePlaybackStore.getState().isPaused).toBe(false);
    const rewoundToday = result.current.chartData.filter(b => b.time.startsWith('2026-09-08'));
    expect(rewoundToday.length).toBe(1);
    expect(rewoundToday[0].time).toBe('2026-09-08 13:30:00');
    // Zero future data leakage: nothing newer than the playhead survives the rewind.
    const maxTime = result.current.chartData
      .map(b => parseAppTimeMs(String(b.time)))
      .reduce((a, b) => Math.max(a, b), 0);
    expect(maxTime).toBeLessThanOrEqual(time930Ms);
  });
});
