import type { 
    IChartApi, 
    ISeriesApi, 
    ISeriesPrimitive, 
    ISeriesPrimitivePaneRenderer, 
    ISeriesPrimitivePaneView,
    Time
} from 'lightweight-charts';
import type { Timeframe } from '../types';

export function getSessionType(timestamp: number): 'PRE' | 'RTH' | 'POST' | 'OTHER' {
  const date = new Date(timestamp * 1000);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour')!.value);
  const minute = parseInt(parts.find(p => p.type === 'minute')!.value);
  const totalMinutes = hour * 60 + minute;
  
  if (totalMinutes >= 240 && totalMinutes < 570) return 'PRE';
  if (totalMinutes >= 570 && totalMinutes < 960) return 'RTH';
  if (totalMinutes >= 960 && totalMinutes < 1200) return 'POST';
  return 'OTHER';
}

class SessionShadingRenderer implements ISeriesPrimitivePaneRenderer {
  _data: any;

  constructor(data: any) {
    this._data = data;
  }

  draw(target: any) {
    target.useMediaCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      if (!this._data || this._data.visibleRange === null) return;
      
      const { bars, timeframe, visibleRange } = this._data;
      if (timeframe === '1D') return;

      ctx.save();
      
      for (let i = visibleRange.from; i < visibleRange.to; i++) {
          const bar = bars[i];
          if (!bar) continue;
          
          const type = getSessionType(bar.time as number);
          if (type === 'PRE') {
              ctx.fillStyle = 'rgba(255, 210, 0, 0.07)'; 
          } else if (type === 'POST') {
              ctx.fillStyle = 'rgba(0, 130, 255, 0.07)'; 
          } else if (type === 'OTHER') {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'; 
          } else {
              continue; 
          }

          const x = bar.x;
          const width = bar.width;
          const halfWidth = width / 2;
          ctx.fillRect(Math.round(x - halfWidth), 0, Math.ceil(width), scope.mediaSize.height);
      }
      
      ctx.restore();
    });
  }
}

class SessionShadingPaneView implements ISeriesPrimitivePaneView {
  _plugin: SessionShadingPlugin;

  constructor(plugin: SessionShadingPlugin) {
    this._plugin = plugin;
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new SessionShadingRenderer(this._plugin._getViewData());
  }
}

export class SessionShadingPlugin implements ISeriesPrimitive<Time> {
  _timeframe: Timeframe;
  _isET: boolean;
  _chart: IChartApi | null;
  _series: ISeriesApi<"Candlestick"> | null;
  _paneViews: SessionShadingPaneView[];
  _requestUpdate: () => void;

  constructor(timeframe: Timeframe, isET: boolean) {
    this._timeframe = timeframe;
    this._isET = isET;
    this._chart = null;
    this._series = null;
    this._paneViews = [new SessionShadingPaneView(this)];
    this._requestUpdate = () => {
        if (this._chart) this._chart.applyOptions({}); 
    };
  }

  attached({ chart, series, requestUpdate }: any) {
    this._chart = chart;
    this._series = series;
    if (requestUpdate) {
        this._requestUpdate = requestUpdate;
    }
  }

  detached() {
    this._chart = null;
    this._series = null;
  }

  updateAllViews() {
    this._requestUpdate();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews;
  }

  _getViewData() {
    if (!this._isET || this._timeframe === '1D' || !this._series || !this._chart) return null;

    const timeScale = this._chart.timeScale();
    const visibleRange = timeScale.getVisibleLogicalRange();
    if (!visibleRange) return null;

    const data = this._series.data();
    
    return {
        bars: data.map((d: any) => ({
            time: d.time,
            x: timeScale.timeToCoordinate(d.time),
            width: timeScale.options().barSpacing || 6
        })),
        timeframe: this._timeframe,
        visibleRange: {
            from: Math.max(0, Math.floor(visibleRange.from as number)),
            to: Math.min(data.length, Math.ceil(visibleRange.to as number))
        }
    };
  }
}
