import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChartData } from '../../../src/hooks/useChartData';
import { streamingClient } from '../../../src/lib/streamingClient';
import { usePlaybackStore } from '../../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../../src/store/useWorkspaceStore';

vi.mock('../../../src/lib/streamingClient', () => ({
  streamingClient: {
    getCandles: vi.fn(),
    getTicks: vi.fn(),
  },
}));

const ms = (t: string) => Date.parse(t.replace(' ', 'T') + 'Z');
const bars = (price: number) => [
  { time: '2026-09-22 13:15:00', open: price, high: price + 10, low: price - 10, close: price + 1, volume: 1000, session: 'PRE' },
  { time: '2026-09-22 13:20:00', open: price + 1, high: price + 50, low: price - 20, close: price + 5, volume: 2000, session: 'PRE' },
];
const params = {
  initialTicker: 'TSLA',
  initialTf: '5min' as const,
  initialEth: true,
  selectedDate: '2026-09-22',
  isReplayMode: false,
  groupColor: 'none' as const,
  tickers: ['TSLA', 'AAPL'],
  chartRef: { current: null },
  priceSeriesRef: { current: null },
  id: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  usePlaybackStore.getState().reset();
  usePlaybackStore.setState({ masterData: [], currentTime: ms('2026-09-22 13:20:00'), isPaused: true });
  useWorkspaceStore.setState({ tickers: { '0': 'TSLA' }, timeframes: { '0': '5min' }, groups: { '0': 'none' }, groupTickers: {} });
  vi.mocked(streamingClient.getTicks).mockResolvedValue([]);
});

it('REVIEW one second past boundary: paused current 5m candle must not reveal the completed five-minute high at 09:20', async () => {
  vi.mocked(streamingClient.getCandles).mockResolvedValue(bars(100));
  usePlaybackStore.setState({
    masterData: [
      { time: '2026-09-22 13:20:00', open: 101, high: 105, low: 100, close: 102, volume: 100, symbol: 'TSLA', session: 'PRE' },
    ],
  });
  usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:20:01'));
  const hook = renderHook(() => useChartData({ ...params, isReplayMode: true }));
  await act(async () => {
    await Promise.resolve();
  });
  const last = hook.result.current.chartData.at(-1);
  console.log('DIAG9 09:20:00 candle; current open101, future5m high150:', last);
  expect(last?.high).toBe(101);
});

it('rereview: different symbol fallback must not reveal unclosed five-minute bar', async () => {
  vi.mocked(streamingClient.getCandles).mockResolvedValue(bars(100));
  usePlaybackStore.setState({
    masterData: [
      { time: '2026-09-22 13:20:00', open: 200, high: 205, low: 199, close: 202, volume: 100, symbol: 'AAPL', session: 'PRE' },
    ],
    currentTime: ms('2026-09-22 13:21:00'),
  });
  const hook = renderHook(() => useChartData({ ...params, isReplayMode: true }));
  await act(async () => {
    await Promise.resolve();
  });
  const last = hook.result.current.chartData.at(-1);
  console.log('REREVIEW symbol without minute data at09:21:', last);
  expect(last?.high).toBe(101);
});

it('rereview: daily forming bar must not expose future one-minute high', async () => {
  vi.mocked(streamingClient.getCandles).mockResolvedValue([
    { time: '2026-09-21 12:00:00', open: 100, high: 110, low: 90, close: 101, volume: 1000, session: 'REG' },
  ]);
  usePlaybackStore.setState({
    masterData: [
      { time: '2026-09-22 13:30:00', open: 101, high: 150, low: 80, close: 120, volume: 10000, symbol: 'TSLA', session: 'REG' },
    ],
    currentTime: ms('2026-09-22 13:30:01'),
  });
  useWorkspaceStore.setState({ timeframes: { '0': '1D' } });
  const hook = renderHook(() => useChartData({ ...params, initialTf: '1D', isReplayMode: true }));
  await act(async () => {
    await Promise.resolve();
  });
  const last = hook.result.current.chartData.at(-1);
  console.log('REREVIEW daily at09:30:01:', last);
  expect(last?.high).toBe(101);
});
