import type { 
    IChartApi, 
    ISeriesApi, 
    ISeriesPrimitive, 
    ISeriesPrimitivePaneRenderer, 
    ISeriesPrimitivePaneView, 
    Time 
} from 'lightweight-charts';

export interface Rectangle {
    p1: { price: number; time: string };
    p2: { price: number; time: string };
}

class RectangleRenderer implements ISeriesPrimitivePaneRenderer {
    _data: any;

    constructor(data: any) {
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
                
                if (y1 === null || y2 === null) continue;

                if (Math.abs(xStart - xEnd) < 1) {
                    xStart -= 3;
                    xEnd += 3;
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

    zOrder(): 'top' | 'bottom' | 'normal' {
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
        if (!this._chart || !this._series || this._rects.length === 0) return null;

        const timeScale = this._chart.timeScale();
        const renderRects = this._rects.map(rect => {
            const y1 = this._series!.priceToCoordinate(rect.p1.price);
            const y2 = this._series!.priceToCoordinate(rect.p2.price);
            
            if (y1 === null || y2 === null) return null;

            let x1 = timeScale.timeToCoordinate(rect.p1.time as Time);
            let x2 = timeScale.timeToCoordinate(rect.p2.time as Time);

            if (x1 === null) x1 = this._getClosestX(rect.p1.time, timeScale);
            if (x2 === null) x2 = this._getClosestX(rect.p2.time, timeScale);

            return { x1, y1, x2, y2 };
        }).filter(r => r !== null);

        return { rects: renderRects };
    }

    _getClosestX(targetTime: string, timeScale: any): number | null {
        const data = this._series!.data();
        if (!data || data.length === 0) return null;
        
        if (targetTime <= (data[0].time as string)) return -10000;
        if (targetTime >= (data[data.length - 1].time as string)) return timeScale.timeToCoordinate(data[data.length - 1].time);

        let left = 0;
        let right = data.length - 1;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if ((data[mid].time as string) === targetTime) {
                return timeScale.timeToCoordinate(data[mid].time);
            } else if ((data[mid].time as string) < targetTime) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        let closestIdx = right;
        if (left < data.length && right >= 0) {
            const diffLeft = Math.abs(new Date(data[left].time as string).getTime() - new Date(targetTime).getTime());
            const diffRight = Math.abs(new Date(data[right].time as string).getTime() - new Date(targetTime).getTime());
            closestIdx = diffLeft < diffRight ? left : right;
        } else if (left < data.length) {
            closestIdx = left;
        }
        
        return timeScale.timeToCoordinate(data[closestIdx].time);
    }
}
