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

import { getSessionType } from './timezones';
export { getSessionType };

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
    this._cache = null;
    // A real configuration change, so a repaint is genuinely wanted -- unlike
    // updateAllViews(), which LWC calls from inside its draw path.
    this._requestUpdate();
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
    // Drops the cached projections only -- it must NOT request a repaint.
    //
    // LWC calls this from inside its draw path (drawImpl -> updateGui -> adjustSizeImpl
    // -> _internal_updateAllSources). Calling _requestUpdate() here re-invalidates the
    // chart that is mid-draw, which schedules another draw, which calls this again: a
    // permanent repaint loop at display refresh rate with nothing changing on screen.
    //
    // Nulling the cache is the correct, useful half: it holds coordinates projected
    // against the previous viewport, and the draw already in flight is about to rebuild
    // it. _getViewData() also re-validates against the live logical range, width and bar
    // spacing, so a stale cache could not be served anyway.
    this._cache = null;
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
        type: getSessionType(d.time as number, this._isET ? 'AAPL' : 'BTC')
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
