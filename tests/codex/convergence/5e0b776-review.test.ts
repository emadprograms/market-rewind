import { renderHook, act } from '/Users/emadarshadalam/Documents/GitHub/market-rewind/node_modules/@testing-library/react/dist/index.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChartLifecycle } from '/Users/emadarshadalam/Documents/GitHub/market-rewind/src/hooks/useChartLifecycle';
import { usePlaybackStore } from '/Users/emadarshadalam/Documents/GitHub/market-rewind/src/store/usePlaybackStore';
import type { RawBar } from '/Users/emadarshadalam/Documents/GitHub/market-rewind/src/types';

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

vi.mock('/Users/emadarshadalam/Documents/GitHub/market-rewind/src/hooks/chart/useChartInit', () => ({
  useChartInit: vi.fn(() => ({
    chartRef: { current: mockChart },
    priceSeriesRef: { current: mockPriceSeries },
    volumeSeriesRef: { current: mockVolumeSeries },
    lastBarSpacingRef: { current: null },
  })),
}));

vi.mock('/Users/emadarshadalam/Documents/GitHub/market-rewind/src/hooks/chart/useChartPlugins', () => ({
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
 await mount([{...initial[0],high:101,close:101,volume:10}]);
 act(()=>usePlaybackStore.getState().setPaused(false));
 const value=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 console.log('REVIEW hydrated volume10 immediately after PLAY:',value);
 expect(value).toBe(10);
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
});
it('review: 5m fallback retains prior minute volumes',async()=>{
 await mount();
 usePlaybackStore.setState({masterData:[{...initial[0],volume:1000,symbol:'TSLA'},{...initial[0],time:'2026-09-22 13:21:00',volume:200,symbol:'TSLA'}],bufferedTicks:[],isPaused:false});
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:20:59.900')));
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:21:00.100')));
 const actual=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 console.log('REVIEW 5m volume after1000-share minute then200-share minute:',actual);
 expect(actual).toBeGreaterThanOrEqual(1000);
});

it('rereview: seek snapshot retains completed minute volume when fallback resumes',async()=>{
 usePlaybackStore.setState({masterData:[{...initial[0],volume:1000,symbol:'TSLA'},{...initial[0],time:'2026-09-22 13:21:00',volume:200,symbol:'TSLA'}],bufferedTicks:[],isPaused:true});
 act(()=>usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:21:00')));
 await mount([{...initial[0],volume:1000}]);
 act(()=>usePlaybackStore.getState().setPaused(false));
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:21:01')));
 const actual=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 console.log('REREVIEW seek snapshot V1000 then play:',actual);
 expect(actual).toBeGreaterThanOrEqual(1000);
});

it('v42: daily fallback volume must exclude premarket after hydration',async()=>{
 usePlaybackStore.setState({masterData:[{...initial[0],volume:1000,symbol:'TSLA',session:'PRE'},{...initial[0],time:'2026-09-22 13:30:00',volume:200,symbol:'TSLA',session:'REG'}],bufferedTicks:[],isPaused:true});
 act(()=>usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:30:00')));
 await mount([{...initial[0],time:'2026-09-22 12:00:00',volume:0,session:'REG'}],{timeframe:'1D',showEth:false});
 act(()=>usePlaybackStore.getState().setPaused(false));
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:30:01')));
 const actual=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 console.log('V42 daily REG200 and PRE1000 after play:',actual);
 expect(actual).toBeLessThanOrEqual(200);
});

import { useChartData } from '/Users/emadarshadalam/Documents/GitHub/market-rewind/src/hooks/useChartData';
import { useWorkspaceStore } from '/Users/emadarshadalam/Documents/GitHub/market-rewind/src/store/useWorkspaceStore';
import { streamingClient } from '/Users/emadarshadalam/Documents/GitHub/market-rewind/src/lib/streamingClient';
vi.mock('/Users/emadarshadalam/Documents/GitHub/market-rewind/src/lib/streamingClient',()=>({streamingClient:{getCandles:vi.fn(),getTicks:vi.fn()}}));
it('5e0b776: starting before RTH must create the same daily candle as pausing',async()=>{
 vi.mocked(streamingClient.getCandles).mockResolvedValue([{time:'2026-09-21 12:00:00',open:100,high:110,low:90,close:101,volume:1000,session:'REG'}]);
 vi.mocked(streamingClient.getTicks).mockResolvedValue([]);
 useWorkspaceStore.setState({tickers:{'0':'TSLA'},timeframes:{'0':'1D'},groups:{'0':'none'},groupTickers:{}});
 usePlaybackStore.setState({masterData:[{time:'2026-09-22 13:30:00',open:101,high:150,low:80,close:120,volume:10000,symbol:'TSLA',session:'REG'}],bufferedTicks:[],isPaused:true});
 usePlaybackStore.getState().seekTickTime(ms('2026-09-22 13:20:00'));
 const h=renderHook(()=>{
  const data=useChartData({initialTicker:'TSLA',initialTf:'1D',initialEth:false,selectedDate:'2026-09-22',isReplayMode:true,groupColor:'none',tickers:['TSLA'],chartRef:{current:null},priceSeriesRef:{current:null},id:0});
  useChartLifecycle({...params,timeframe:'1D',showEth:false,chartData:data.chartData,localMasterData:data.localMasterData,isLoadingHistory:data.isLoadingHistory,pendingHistoryPrependRef:data.pendingHistoryPrependRef});
  return data;
 });
 await act(async()=>{await new Promise(r=>setTimeout(r,60));});
 await act(async()=>{await new Promise(r=>setTimeout(r,35));});
 expect(h.result.current.chartData.at(-1)?.time).toBe('2026-09-21 12:00:00');
 act(()=>usePlaybackStore.getState().setPaused(false));
 act(()=>usePlaybackStore.getState().advanceSimulationTime(ms('2026-09-22 13:30:01')));
 const playingVol=mockVolumeSeries.update.mock.calls.at(-1)?.[0].value;
 const playingPrice=mockPriceSeries.update.mock.calls.at(-1)?.[0];
 act(()=>usePlaybackStore.getState().setPaused(true));
 const paused=h.result.current.chartData.at(-1);
 console.log('COMBINED playing:',playingPrice,playingVol,'paused:',paused);
 expect(playingVol).toBe(paused?.volume);
});
