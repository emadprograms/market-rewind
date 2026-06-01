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

export interface Rectangle {
    p1: { price: number; time: Time };
    p2: { price: number; time: Time };
}

interface RectCoords {
    x1: Coordinate | null;
    y1: Coordinate;
    x2: Coordinate | null;
    y2: Coordinate;
}

interface RectRenderData {
    rects: RectCoords[];
}

class RectangleRenderer implements ISeriesPrimitivePaneRenderer {
    _data: RectRenderData | null;

    constructor(data: RectRenderData | null) {
        this._data = data;
    }

    draw(target: any) {
        target.useMediaCoordinateSpace((scope: any) => {
            const ctx = scope.context;
            if (!this._data || !this._data.rects || this._data.rects.length === 0) return;

            ctx.save();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255, 152, 0, 0.8)';
            ctx.fillStyle = 'rgba(255, 152, 0, 0.15)';

            for (const rect of this._data.rects) {
                const { x1, y1, x2, y2 } = rect;
                
                let xStart = x1 === null ? -100 : x1;
                let xEnd = x2 === null ? scope.mediaSize.width + 100 : x2;
                
                if (Math.abs(xStart - xEnd) < 1) {
                    xStart = (xStart - 3) as Coordinate;
                    xEnd = (xEnd + 3) as Coordinate;
                }

                const left = Math.min(xStart, xEnd);
                const top = Math.min(y1, y2);
                const width = Math.abs(xStart - xEnd);
                const height = Math.abs(y1 - y2);

                ctx.beginPath();
                ctx.rect(left, top, width, height);
                ctx.fill();
                ctx.stroke();
            }

            ctx.restore();
        });
    }
}

class RectanglePaneView implements ISeriesPrimitivePaneView {
    _plugin: RectanglePlugin;

    constructor(plugin: RectanglePlugin) {
        this._plugin = plugin;
    }

    zOrder(): SeriesPrimitivePaneViewZOrder {
        return 'bottom';
    }

    renderer(): ISeriesPrimitivePaneRenderer {
        return new RectangleRenderer(this._plugin._getViewData());
    }
}

export class RectanglePlugin implements ISeriesPrimitive<Time> {
    _chart: IChartApi | null;
    _series: ISeriesApi<"Candlestick"> | null;
    _paneViews: RectanglePaneView[];
    _requestUpdate: () => void;
    _rects: Rectangle[];

    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new RectanglePaneView(this)];
        this._requestUpdate = () => {};
        this._rects = [];
    }

    setRects(rects: Rectangle[]) {
        this._rects = rects;
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

    _getViewData(): RectRenderData | null {
        if (!this._chart || !this._series || this._rects.length === 0) return null;

        const timeScale = this._chart.timeScale();
        const renderRects = this._rects.map(rect => {
            const y1 = this._series!.priceToCoordinate(rect.p1.price);
            const y2 = this._series!.priceToCoordinate(rect.p2.price);
            
            if (y1 === null || y2 === null) return null;

            let x1 = timeScale.timeToCoordinate(rect.p1.time);
            let x2 = timeScale.timeToCoordinate(rect.p2.time);

            if (x1 === null) x1 = this._getClosestX(rect.p1.time, timeScale);
            if (x2 === null) x2 = this._getClosestX(rect.p2.time, timeScale);

            return { x1, y1, x2, y2 } as RectCoords;
        }).filter((r): r is RectCoords => r !== null);

        return { rects: renderRects };
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
