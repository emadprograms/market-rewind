import type { 
    IChartApi, 
    ISeriesApi, 
    ISeriesPrimitive, 
    ISeriesPrimitivePaneRenderer, 
    ISeriesPrimitivePaneView,
    Time,
    SeriesPrimitivePaneViewZOrder,
    SeriesAttachedParameter
} from 'lightweight-charts';
import type { ChartTarget, ChartScope } from '../types';

class BoundaryLineRenderer implements ISeriesPrimitivePaneRenderer {
  _x: number | null;

  constructor(x: number | null) {
    this._x = x;
  }

  draw(target: ChartTarget) {
    target.useMediaCoordinateSpace((scope: ChartScope) => {
      const ctx = scope.context;
      if (this._x === null) return;
      
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this._x, 0);
      ctx.lineTo(this._x, scope.mediaSize.height);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.4)'; // visible but not too visible
      ctx.setLineDash([4, 4]); // Dashed line
      ctx.stroke();
      ctx.restore();
    });
  }
}

class BoundaryLinePaneView implements ISeriesPrimitivePaneView {
  _plugin: BoundaryLinePlugin;

  constructor(plugin: BoundaryLinePlugin) {
    this._plugin = plugin;
  }

  zOrder(): SeriesPrimitivePaneViewZOrder {
    return 'normal';
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new BoundaryLineRenderer(this._plugin._getXCoordinate());
  }
}

export class BoundaryLinePlugin implements ISeriesPrimitive<Time> {
  _boundaryTime: string | null;
  _chart: IChartApi | null;
  _series: ISeriesApi<"Candlestick"> | null;
  _paneViews: BoundaryLinePaneView[];
  _requestUpdate: () => void;
  
  constructor(boundaryTime: string | null) {
    this._boundaryTime = boundaryTime;
    this._chart = null;
    this._series = null;
    this._paneViews = [new BoundaryLinePaneView(this)];
    this._requestUpdate = () => {
        if (this._chart) this._chart.applyOptions({}); 
    };
  }

  public setBoundaryTime(boundaryTime: string | null) {
    this._boundaryTime = boundaryTime;
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
  }

  updateAllViews() {
    this._requestUpdate();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews;
  }

  _getXCoordinate(): number | null {
    if (!this._boundaryTime || !this._series || !this._chart) return null;
    
    // Convert "YYYY-MM-DD HH:mm:ss" to numeric timestamp (seconds)
    const isoString = this._boundaryTime.replace(' ', 'T') + 'Z';
    const numericTime = Math.floor(new Date(isoString).getTime() / 1000) as Time;
    
    const timeScale = this._chart.timeScale();
    const x = timeScale.timeToCoordinate(numericTime);
    return x;
  }
}
