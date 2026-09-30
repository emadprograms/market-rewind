import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChartLifecycle } from '../../../src/hooks/useChartLifecycle';
import { usePlaybackStore } from '../../../src/store/usePlaybackStore';
import type { RawBar } from '../../../src/types';

// Create fresh mock instances for each test
const mockPriceScale = {
  applyOptions: vi.fn(),
};

const mockTimeScale = {
  setVisibleLogicalRange: vi.fn(),
  getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 100 })),
  scrollToRealTime: vi.fn(),
  subscribeVisibleLogicalRangeChange: vi.fn(),
};

const mockPriceSeries = {
  setData: vi.fn(),
  update: vi.fn(),
  applyOptions: vi.fn(),
  attachPrimitive: vi.fn(),
  data: vi.fn(() => []),
  createPriceLine: vi.fn(),
  removePriceLine: vi.fn(),
};

const mockVolumeSeries = {
  setData: vi.fn(),
  update: vi.fn(),
  applyOptions: vi.fn(),
  attachPrimitive: vi.fn(),
  priceScale: vi.fn(() => mockPriceScale),
};

const mockChart = {
  addCandlestickSeries: vi.fn(() => mockPriceSeries),
  addHistogramSeries: vi.fn(() => mockVolumeSeries),
  timeScale: vi.fn(() => mockTimeScale),
  priceScale: vi.fn(() => mockPriceScale),
  remove: vi.fn(),
  applyOptions: vi.fn(),
  subscribeClick: vi.fn(),
  unsubscribeClick: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  unsubscribeCrosshairMove: vi.fn(),
  subscribeDblClick: vi.fn(),
  unsubscribeDblClick: vi.fn(),
};

const mockVpPlugin = {
  setData: vi.fn(),
};

vi.mock('../../../src/hooks/chart/useChartInit', () => ({
  useChartInit: vi.fn(() => ({
    chartRef: { current: mockChart },
    priceSeriesRef: { current: mockPriceSeries },
    volumeSeriesRef: { current: mockVolumeSeries },
    lastBarSpacingRef: { current: null },
  })),
}));

vi.mock('../../../src/hooks/chart/useChartPlugins', () => ({
  useChartPlugins: vi.fn(() => ({
    shadingPluginRef: { current: null },
    vpPluginRef: { current: mockVpPlugin },
    rayPluginRef: { current: null },
    rectPluginRef: { current: null },
    tradePluginRef: { current: null },
    updateShadingConfig: vi.fn(),
    pluginVersion: 0,
  })),
}));


const params = {
  chartContainerRef: { current: document.createElement('div') }, ticker: 'TSLA', timeframe: '5min' as const,
  showEth: true, showVP: false, localMasterData: [], isReplayMode: true, isLoadingHistory: false,
  pendingHistoryPrependRef: { current: null }, isDrawingMode: false, drawType: 'ray' as const,
  rectAnchor: null, setRectAnchor: vi.fn(), ghostPoint: null, setGhostPoint: vi.fn(),
  drawings: { rays: [], rects: [] }, onUpdateDrawings: vi.fn(), chartRef: { current: mockChart as any },
  priceSeriesRef: { current: mockPriceSeries as any },
};
const initial = [{time:'2026-09-22 13:20:00',open:100,high:100,low:100,close:100,volume:0,session:'PRE'}];
const ms = (t:string) => Date.parse(t.replace(' ','T')+'Z');
const tick = (time:string, price:number, volume:number, symbol='TSLA') => ({time,price,volume,symbol,session:'PRE'} as any);
async function mount(bars=initial, extra={}) {
  const hook=renderHook(({chartData,isLoadingHistory})=>useChartLifecycle({...params,...extra,chartData,isLoadingHistory}),{initialProps:{chartData:bars,isLoadingHistory:!!(extra as any).isLoadingHistory}});
  await act(async()=>{await new Promise(r=>setTimeout(r,35));});
  return hook;
}
beforeEach(()=>{
 vi.clearAllMocks();
 usePlaybackStore.getState().reset();
 usePlaybackStore.setState({masterData:[],isPaused:true});
});

it('review: starting after a seek must not re-add already rendered ticks',async()=>{
 const ticks=[tick('2026-09-22 13:22:00',100,4),tick('2026-09-22 13:23:00',101,6),tick('2026-09-22 13:24:00',102,8)];
 usePlaybackStore.getState().setBufferedTicks(ticks);
 usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:23:00'));
 const hook = await mount([{...initial[0],high:101,close:101,volume:10}]);
 act(()=>usePlaybackStore.getState().setPaused(false));
 const value=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 console.log('REVIEW hydrated volume10 immediately after PLAY:',value);
 expect(value).toBe(10);
 hook.unmount();
});

it('review: after rewind one frame must retain the intermediate high and volume',async()=>{
 const ticks=[tick('2026-09-22 13:21:00',100,1),tick('2026-09-22 13:22:00.001',120,2),tick('2026-09-22 13:22:00.002',90,3),tick('2026-09-22 13:22:00.003',105,4),tick('2026-09-22 13:24:00',106,1)];
 usePlaybackStore.getState().setBufferedTicks(ticks);
 usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:23:00'));
 const hook=await mount();
 act(()=>usePlaybackStore.getState().setPaused(false));
 act(()=>usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:20:00')));
 hook.rerender({chartData:initial.map(b=>({...b})),isLoadingHistory:false});
 act(()=>usePlaybackStore.getState().setPaused(false));
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:22:00.010')));
 const price=mockPriceSeries.update.mock.calls.at(-1)?.[0];
 const volume=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 console.log('REVIEW backward seek expected H120 L90 V10, got:',price,volume);
 expect({high:price.high,low:price.low,volume}).toEqual({high:120,low:90,volume:10});
 hook.unmount();
});

it('review: 5m fallback retains prior minute volumes',async()=>{
 const hook = await mount();
 usePlaybackStore.setState({masterData:[{...initial[0],volume:1000,symbol:'TSLA'},{...initial[0],time:'2026-09-22 13:21:00',volume:200,symbol:'TSLA'}],bufferedTicks:[],isPaused:false});
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:20:59.900')));
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:21:00.100')));
 const actual=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 console.log('REVIEW 5m volume after1000-share minute then200-share minute:',actual);
 expect(actual).toBeGreaterThanOrEqual(1000);
 hook.unmount();
});

it('rereview: seek snapshot retains completed minute volume when fallback resumes',async()=>{
 usePlaybackStore.setState({masterData:[{...initial[0],volume:1000,symbol:'TSLA'},{...initial[0],time:'2026-09-22 13:21:00',volume:200,symbol:'TSLA'}],bufferedTicks:[],isPaused:true});
 act(()=>usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:21:00')));
 const hook = await mount([{...initial[0],volume:1000}]);
 act(()=>usePlaybackStore.getState().setPaused(false));
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:21:01')));
 const actual=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 console.log('REREVIEW seek snapshot V1000 then play:',actual);
 expect(actual).toBeGreaterThanOrEqual(1000);
 hook.unmount();
});

it('v42: daily fallback volume must exclude premarket after hydration',async()=>{
 usePlaybackStore.setState({masterData:[{...initial[0],volume:1000,symbol:'TSLA',session:'PRE'},{...initial[0],time:'2026-09-22 13:30:00',volume:200,symbol:'TSLA',session:'REG'}],bufferedTicks:[],isPaused:true});
 act(()=>usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:30:00')));
 const hook = await mount([{...initial[0],time:'2026-09-22 12:00:00',volume:0,session:'REG'}],{timeframe:'1D',showEth:false});
 act(()=>usePlaybackStore.getState().setPaused(false));
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:30:01')));
 const actual=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 console.log('V42 daily REG200 and PRE1000 after play:',actual);
 expect(actual).toBeLessThanOrEqual(200);
 hook.unmount();
});

import { useChartData } from '../../../src/hooks/useChartData';
import { useWorkspaceStore } from '../../../src/store/useWorkspaceStore';
import { streamingClient } from '../../../src/lib/streamingClient';
vi.mock('../../../src/lib/streamingClient',()=>({streamingClient:{getCandles:vi.fn(),getTicks:vi.fn()}}));

it('356b1e2: daily seek and play must agree through real data and lifecycle hooks at 09:30:01 and 09:31:00 boundary', async () => {
  vi.mocked(streamingClient.getCandles).mockResolvedValue([{ time: '2026-09-21 12:00:00', open: 100, high: 110, low: 90, close: 101, volume: 1000, session: 'REG' }]);
  vi.mocked(streamingClient.getTicks).mockResolvedValue([]);
  useWorkspaceStore.setState({ tickers: { '0': 'TSLA' }, timeframes: { '0': '1D' }, groups: { '0': 'none' }, groupTickers: {} });
  usePlaybackStore.setState({ masterData: [{ time: '2026-09-22 13:30:00', open: 101, high: 150, low: 80, close: 120, volume: 10000, symbol: 'TSLA', session: 'REG' }], bufferedTicks: [], isPaused: true });
  usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:30:00'));

  const h = renderHook(() => {
    const data = useChartData({ initialTicker: 'TSLA', initialTf: '1D', initialEth: false, selectedDate: '2026-09-22', isReplayMode: true, groupColor: 'none', tickers: ['TSLA'], chartRef: { current: null }, priceSeriesRef: { current: null }, id: 0 });
    useChartLifecycle({ ...params, timeframe: '1D', showEth: false, chartData: data.chartData, localMasterData: data.localMasterData, isLoadingHistory: data.isLoadingHistory, pendingHistoryPrependRef: data.pendingHistoryPrependRef });
    return data;
  });
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });

  // Boundary 1: At 09:30:00, volume is 0
  expect(h.result.current.chartData.at(-1)?.volume).toBe(0);

  // Play to 09:30:01 (forming minute, no completed minutes yet)
  act(() => usePlaybackStore.getState().setPaused(false));
  act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:30:01')));
  const playingVol01 = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
  const playingPrice01 = mockPriceSeries.update.mock.calls.at(-1)?.[0];
  act(() => usePlaybackStore.getState().setPaused(true));
  const paused01 = h.result.current.chartData.at(-1);

  expect(playingVol01).toBe(0);
  expect(paused01?.volume).toBe(0);
  expect(playingPrice01?.close).toBe(101);
  expect(paused01?.close).toBe(101);

  // Boundary 2: Advance to 09:31:00 (09:30 minute is now COMPLETED)
  act(() => usePlaybackStore.getState().setPaused(false));
  act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:31:00')));
  const playingVolCompleted = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
  const playingPriceCompleted = mockPriceSeries.update.mock.calls.at(-1)?.[0];
  act(() => usePlaybackStore.getState().setPaused(true));
  const pausedCompleted = h.result.current.chartData.at(-1);

  // Completed minute OHLCV incorporated into both live update and paused snapshot
  expect(playingVolCompleted).toBe(10000);
  expect(pausedCompleted?.volume).toBe(10000);
  expect(playingPriceCompleted?.high).toBe(150);
  expect(pausedCompleted?.high).toBe(150);
  expect(playingPriceCompleted?.low).toBe(80);
  expect(pausedCompleted?.low).toBe(80);
  expect(playingPriceCompleted?.close).toBe(120);
  expect(pausedCompleted?.close).toBe(120);

  h.unmount();
});

it('356b1e2: future raw ticks do not leak into daily forming candle', async () => {
  vi.mocked(streamingClient.getCandles).mockResolvedValue([{ time: '2026-09-21 12:00:00', open: 100, high: 110, low: 90, close: 101, volume: 1000, session: 'REG' }]);
  const futureTicks: MarketTick[] = [
    { time: '2026-09-22 13:35:00.000', price: 180, volume: 500, symbol: 'TSLA' },
  ];
  vi.mocked(streamingClient.getTicks).mockResolvedValue(futureTicks);
  useWorkspaceStore.setState({ tickers: { '0': 'TSLA' }, timeframes: { '0': '1D' }, groups: { '0': 'none' }, groupTickers: {} });
  usePlaybackStore.setState({
    masterData: [{ time: '2026-09-22 13:30:00', open: 101, high: 150, low: 80, close: 120, volume: 10000, symbol: 'TSLA', session: 'REG' }],
    bufferedTicks: futureTicks,
    ticksBySymbol: { TSLA: futureTicks },
    isPaused: true,
  });
  usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:30:00'));

  const h = renderHook(() => {
    const data = useChartData({ initialTicker: 'TSLA', initialTf: '1D', initialEth: false, selectedDate: '2026-09-22', isReplayMode: true, groupColor: 'none', tickers: ['TSLA'], chartRef: { current: null }, priceSeriesRef: { current: null }, id: 0 });
    useChartLifecycle({ ...params, timeframe: '1D', showEth: false, chartData: data.chartData, localMasterData: data.localMasterData, isLoadingHistory: data.isLoadingHistory, pendingHistoryPrependRef: data.pendingHistoryPrependRef });
    return data;
  });
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });

  act(() => usePlaybackStore.getState().setPaused(false));
  act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:30:01')));
  const playingVol = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
  const playingPrice = mockPriceSeries.update.mock.calls.at(-1)?.[0];
  act(() => usePlaybackStore.getState().setPaused(true));
  const paused = h.result.current.chartData.at(-1);

  expect(playingVol).toBe(0);
  expect(paused?.volume).toBe(0);
  expect(playingPrice?.high).not.toBe(180);
  expect(paused?.high).not.toBe(180);

  h.unmount();
});

it('356b1e2: sparse elapsed raw ticks correctly form daily candle in both live update and paused snapshot', async () => {
  vi.mocked(streamingClient.getCandles).mockResolvedValue([{ time: '2026-09-21 12:00:00', open: 100, high: 110, low: 90, close: 101, volume: 1000, session: 'REG' }]);
  const rawTicks: MarketTick[] = [
    { time: '2026-09-22 13:30:00.500', price: 102, volume: 50, symbol: 'TSLA' },
    { time: '2026-09-22 13:35:00.000', price: 180, volume: 500, symbol: 'TSLA' },
  ];
  vi.mocked(streamingClient.getTicks).mockResolvedValue(rawTicks);
  useWorkspaceStore.setState({ tickers: { '0': 'TSLA' }, timeframes: { '0': '1D' }, groups: { '0': 'none' }, groupTickers: {} });
  usePlaybackStore.setState({
    masterData: [{ time: '2026-09-22 13:30:00', open: 101, high: 150, low: 80, close: 120, volume: 10000, symbol: 'TSLA', session: 'REG' }],
    bufferedTicks: rawTicks,
    ticksBySymbol: { TSLA: rawTicks },
    isPaused: true,
  });
  usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:30:00'));

  const h = renderHook(() => {
    const data = useChartData({ initialTicker: 'TSLA', initialTf: '1D', initialEth: false, selectedDate: '2026-09-22', isReplayMode: true, groupColor: 'none', tickers: ['TSLA'], chartRef: { current: null }, priceSeriesRef: { current: null }, id: 0 });
    useChartLifecycle({ ...params, timeframe: '1D', showEth: false, chartData: data.chartData, localMasterData: data.localMasterData, isLoadingHistory: data.isLoadingHistory, pendingHistoryPrependRef: data.pendingHistoryPrependRef });
    return data;
  });
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });

  act(() => usePlaybackStore.getState().setPaused(false));
  act(() => usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:30:01')));
  const playingVol = mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
  const playingPrice = mockPriceSeries.update.mock.calls.at(-1)?.[0];
  act(() => usePlaybackStore.getState().setPaused(true));
  const paused = h.result.current.chartData.at(-1);

  // Sparse elapsed tick incorporated: volume 50, price 102
  expect(playingVol).toBe(50);
  expect(paused?.volume).toBe(50);
  expect(playingPrice?.high).toBe(102);
  expect(paused?.high).toBe(102);
  expect(playingPrice?.close).toBe(102);
  expect(paused?.close).toBe(102);

  h.unmount();
});
