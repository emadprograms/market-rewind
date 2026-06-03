import type { 
    IChartApi, 
    ISeriesApi, 
    ISeriesPrimitive, 
    ISeriesPrimitivePaneRenderer, 
    ISeriesPrimitivePaneView,
    Time,
    SeriesPrimitivePaneViewZOrder,
    SeriesAttachedParameter,
    ITimeScaleApi,
    CandlestickData,
    Coordinate
} from 'lightweight-charts';
import type { Timeframe, ChartTarget, ChartScope } from '../types';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false
});

let lastDay = -1;
let dayOffset = 0; // in minutes

export function getSessionType(timestamp: number): 'PRE' | 'RTH' | 'POST' | 'OTHER' {
  const date = new Date(timestamp * 1000);
  const day = Math.floor(timestamp / 86400);
  
  if (day !== lastDay) {
      // Recalculate offset for the day
      const nyStr = formatter.format(date); // "H:MM" or "HH:MM"
      const [h, m] = nyStr.split(':').map(Number);
      const utcHours = date.getUTCHours();
      const utcMinutes = date.getUTCMinutes();
      
      const nyTotal = h * 60 + m;
      const utcTotal = utcHours * 60 + utcMinutes;
      
      dayOffset = nyTotal - utcTotal;
      // Handle wrap around (day boundary)
      if (dayOffset > 720) dayOffset -= 1440;
      if (dayOffset < -720) dayOffset += 1440;
      
      lastDay = day;
  }
  
  const totalMinutesUTC = date.getUTCHours() * 60 + date.getUTCMinutes();
  let totalMinutes = totalMinutesUTC + dayOffset;
  if (totalMinutes < 0) totalMinutes += 1440;
  if (totalMinutes >= 1440) totalMinutes -= 1440;

  if (totalMinutes >= 240 && totalMinutes < 570) return 'PRE';
  if (totalMinutes >= 570 && totalMinutes < 960) return 'RTH';
  if (totalMinutes >= 960 && totalMinutes < 1200) return 'POST';
  return 'OTHER';
}

interface ShadedBar {
    time: Time;
    x: Coordinate | null;
    type: 'PRE' | 'RTH' | 'POST' | 'OTHER';
}

interface ShadingViewData {
    bars: ShadedBar[];
    barSpacing: number;
    timeframe: Timeframe;
}

class SessionShadingRenderer implements ISeriesPrimitivePaneRenderer {
  _data: ShadingViewData | null;

  constructor(data: ShadingViewData | null) {
    this._data = data;
  }

  draw(target: ChartTarget) {
    target.useMediaCoordinateSpace((scope: ChartScope) => {
      const ctx = scope.context;
      if (!this._data || !this._data.bars || this._data.bars.length === 0) return;
      
      const { bars, timeframe, barSpacing } = this._data;
      if (timeframe === '1D') return;

      ctx.save();
      
      for (const bar of bars) {
          const type = bar.type;
          const x = bar.x;
          if (x === null) continue;

          if (type === 'PRE') {
              ctx.fillStyle = 'rgba(255, 210, 0, 0.15)'; 
          } else if (type === 'POST') {
              ctx.fillStyle = 'rgba(0, 130, 255, 0.15)'; 
          } else if (type === 'OTHER') {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'; 
          } else {
              continue; 
          }

          const halfWidth = barSpacing / 2;
          ctx.fillRect(Math.round(x - halfWidth), 0, Math.ceil(barSpacing), scope.mediaSize.height);
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

  zOrder(): SeriesPrimitivePaneViewZOrder {
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
  
  _cache: ShadingViewData | null = null;
  _lastLogicalRange: { from: number; to: number } = { from: -1, to: -1 };
  _lastWidth: number = 0;
  _lastBarSpacing: number = 0;

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

  public setConfig(timeframe: Timeframe, isET: boolean) {
    this._timeframe = timeframe;
    this._isET = isET;
    this.updateAllViews();
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time, "Candlestick">) {
    this._chart = chart as IChartApi;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._cache = null;
  }

  updateAllViews() {
    this._cache = null;
    this._requestUpdate();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews;
  }

  _getViewData(): ShadingViewData | null {
    if (!this._isET || this._timeframe === '1D' || !this._series || !this._chart) return null;

    const timeScale = this._chart.timeScale();
    const visibleRange = timeScale.getVisibleLogicalRange();
    if (!visibleRange) return null;

    const viewportWidth = timeScale.width();
    const barSpacing = timeScale.options().barSpacing || 6;

    if (this._cache && 
        Math.abs(this._lastLogicalRange.from - (visibleRange.from ?? 0)) < 0.5 && 
        Math.abs(this._lastLogicalRange.to - (visibleRange.to ?? 0)) < 0.5 &&
        this._lastWidth === viewportWidth &&
        this._lastBarSpacing === barSpacing
    ) {
        return this._cache;
    }

    const data = this._series.data();
    const fromIndex = Math.max(0, Math.floor(visibleRange.from ?? 0));
    const toIndex = Math.min(data.length, Math.ceil(visibleRange.to ?? 0));
    
    const bars: ShadedBar[] = [];
    
    for (let i = fromIndex; i < toIndex; i++) {
        const d = data[i];
        if (!d) continue;
        bars.push({
            time: d.time,
            x: timeScale.timeToCoordinate(d.time),
            type: getSessionType(d.time as number)
        });
    }
    
    this._cache = {
        bars,
        barSpacing,
        timeframe: this._timeframe
    };
    this._lastLogicalRange = { from: visibleRange.from ?? 0, to: visibleRange.to ?? 0 };
    this._lastWidth = viewportWidth;
    this._lastBarSpacing = barSpacing;

    return this._cache;
  }
}
