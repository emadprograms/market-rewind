import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChartData } from '../../src/hooks/useChartData';
import { useMarketSimulator } from '../../src/hooks/useMarketSimulator';
import { streamingClient } from '../../src/lib/streamingClient';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import type { RawBar } from '../../src/types';

vi.mock('../../src/lib/streamingClient', () => ({
  streamingClient: {
    getCandles: vi.fn(),
    getTicks: vi.fn(),
  },
}));

const ms = (t: string) => Date.parse(t.replace(' ', 'T') + 'Z');

const bars = (price: number): RawBar[] => [
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

describe('Data Integrity Defect Replication (market-rewind-diagnosis-and-plan.md)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
    usePlaybackStore.setState({ masterData: [], currentTime: ms('2026-09-22 13:20:00'), isPaused: true });
    useWorkspaceStore.setState({ tickers: { '0': 'TSLA' }, timeframes: { '0': '5min' }, groups: { '0': 'none' }, groupTickers: {} });
    vi.mocked(streamingClient.getTicks).mockResolvedValue([]);
  });

  it('DIAG 8: symbol switch must replace prices even when candle timestamp ranges match', async () => {
    vi.mocked(streamingClient.getCandles).mockImplementation(async (symbol) => bars(symbol === 'TSLA' ? 100 : 200));
    const hook = renderHook(() => useChartData(params));
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.localMasterData[0].open).toBe(100);

    await act(async () => {
      useWorkspaceStore.getState().setTicker('0', 'AAPL');
      await Promise.resolve();
    });
    expect(hook.result.current.localMasterData[0].open).toBe(200);
  });

  it('DIAG 9: paused current 5m candle must not reveal the completed five-minute high at 09:20', async () => {
    vi.mocked(streamingClient.getCandles).mockResolvedValue(bars(100));
    usePlaybackStore.setState({
      masterData: [{ time: '2026-09-22 13:20:00', open: 101, high: 105, low: 100, close: 102, volume: 100, symbol: 'TSLA', session: 'PRE' }],
    });
    usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:20:00'));

    const hook = renderHook(() => useChartData({ ...params, isReplayMode: true }));
    await act(async () => {
      await Promise.resolve();
    });
    const last = hook.result.current.chartData.at(-1);
    expect(last?.high).toBe(101);
  });

  it('DIAG 10: new symbol tick completion while playing must refresh the paused snapshot buffer', async () => {
    vi.mocked(streamingClient.getCandles).mockResolvedValue(bars(100));
    let resolveTicks: any;
    vi.mocked(streamingClient.getTicks).mockImplementation(() => new Promise((resolve) => {
      resolveTicks = resolve;
    }));

    usePlaybackStore.setState({ currentTime: ms('2026-09-22 13:34:00'), isPaused: false });
    const hook = renderHook(() => useChartData({ ...params, isReplayMode: true }));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolveTicks([{ time: '2026-09-22 13:30:00', symbol: 'TSLA', price: 170, volume: 5, session: 'REG' }]);
      await Promise.resolve();
    });
    expect(hook.result.current.chartData.at(-1)?.time).toBe('2026-09-22 13:30:00');
  });

  it('DIAG 11: a late response for an old session date must not overwrite the new session', async () => {
    const resolvers: any[] = [];
    vi.mocked(streamingClient.getCandles).mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const convert = (date: string, _time: string) => `${date} 13:20:00`;
    const hook = renderHook(({ date }) => useMarketSimulator(true, 'TSLA', date, '09:20', convert), {
      initialProps: { date: '2026-09-22' },
    });

    hook.rerender({ date: '2026-09-15' });
    await act(async () => {
      resolvers[1]([{ ...bars(200)[0], time: '2026-09-15 13:20:00', symbol: 'TSLA' }]);
      await Promise.resolve();
    });
    expect(usePlaybackStore.getState().currentTime).toBe(ms('2026-09-15 13:20:00'));

    await act(async () => {
      resolvers[0]([{ ...bars(100)[0], symbol: 'TSLA' }]);
      await Promise.resolve();
    });
    expect(usePlaybackStore.getState().currentTime).toBe(ms('2026-09-15 13:20:00'));
  });
});
