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
    Coordinate
} from 'lightweight-charts';

export interface HorizontalRay {
    price: number;
    time: Time;
}

interface RayPoint {
    x: Coordinate | null;
    y: Coordinate;
}

interface RayRenderData {
    rays: RayPoint[];
}

class HorizontalRayRenderer implements ISeriesPrimitivePaneRenderer {
    _data: RayRenderData | null;

    constructor(data: RayRenderData | null) {
        this._data = data;
    }

    draw(target: any) {
        target.useMediaCoordinateSpace((scope: any) => {
            const ctx = scope.context;
            if (!this._data || !this._data.rays || this._data.rays.length === 0) return;

            ctx.save();
            ctx.strokeStyle = '#ff9800';
            ctx.lineWidth = 2; // Made thicker per request
            ctx.setLineDash([6, 4]); // Made dashed per request
            ctx.globalAlpha = 0.9;

            const rightEdge = scope.mediaSize.width;

            for (const ray of this._data.rays) {
                if (ray.x === null) continue;
                
                ctx.beginPath();
                ctx.moveTo(ray.x, ray.y);
                ctx.lineTo(rightEdge, ray.y);
                ctx.stroke();
            }

            ctx.restore();
        });
    }
}

class HorizontalRayPaneView implements ISeriesPrimitivePaneView {
    _plugin: HorizontalRayPlugin;

    constructor(plugin: HorizontalRayPlugin) {
        this._plugin = plugin;
    }

    zOrder(): SeriesPrimitivePaneViewZOrder {
        return 'top';
    }

    renderer(): ISeriesPrimitivePaneRenderer {
        return new HorizontalRayRenderer(this._plugin._getViewData());
    }
}

export class HorizontalRayPlugin implements ISeriesPrimitive<Time> {
    _chart: IChartApi | null;
    _series: ISeriesApi<"Candlestick"> | null;
    _paneViews: HorizontalRayPaneView[];
    _requestUpdate: () => void;
    _rays: HorizontalRay[];

    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new HorizontalRayPaneView(this)];
        this._requestUpdate = () => {};
        this._rays = [];
    }

    setRays(rays: HorizontalRay[]) {
        this._rays = rays;
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

    _getViewData(): RayRenderData | null {
        if (!this._chart || !this._series || this._rays.length === 0) return null;

        const timeScale = this._chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (!visibleRange) return null;

        const renderRays = this._rays.map(ray => {
            const y = this._series!.priceToCoordinate(ray.price);
            if (y === null) return null;

            let x = timeScale.timeToCoordinate(ray.time);
            if (x === null) {
                x = this._getClosestX(ray.time, timeScale);
            }

            return { x, y } as RayPoint;
        }).filter((r): r is RayPoint => r !== null);

        return {
            rays: renderRays
        };
    }

    _getClosestX(targetTime: Time, timeScale: ITimeScaleApi<Time>): Coordinate | null {
        const data = this._series!.data();
        if (!data || data.length === 0) return null;
        
        const firstTime = data[0].time;
        const lastTime = data[data.length - 1].time;

        if (targetTime <= firstTime) return -10000 as Coordinate;
        if (targetTime >= lastTime) return timeScale.timeToCoordinate(lastTime);

        let left = 0;
        let right = data.length - 1;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (data[mid].time === targetTime) {
                return timeScale.timeToCoordinate(data[mid].time);
            } else if (data[mid].time < targetTime) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        let closestIdx = right;
        if (left < data.length && right >= 0) {
            const timeL = typeof data[left].time === 'number' ? data[left].time : new Date(data[left].time as string).getTime() / 1000;
            const timeR = typeof data[right].time === 'number' ? data[right].time : new Date(data[right].time as string).getTime() / 1000;
            const targetT = typeof targetTime === 'number' ? targetTime : new Date(targetTime as string).getTime() / 1000;

            const diffLeft = Math.abs((timeL as number) - (targetT as number));
            const diffRight = Math.abs((timeR as number) - (targetT as number));
            closestIdx = diffLeft < diffRight ? left : right;
        } else if (left < data.length) {
            closestIdx = left;
        }
        
        return timeScale.timeToCoordinate(data[closestIdx].time);
    }
}
