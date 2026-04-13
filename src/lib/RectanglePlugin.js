class RectangleRenderer {
    constructor(data) {
        this._data = data;
    }

    draw(target) {
        target.useMediaCoordinateSpace(scope => {
            const ctx = scope.context;
            if (!this._data || !this._data.rects || this._data.rects.length === 0) return;

            ctx.save();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255, 152, 0, 0.8)';
            ctx.fillStyle = 'rgba(255, 152, 0, 0.15)';

            for (const rect of this._data.rects) {
                const { x1, y1, x2, y2 } = rect;
                
                // Allow drawing even if one point is off-screen
                const xStart = x1 === null ? -100 : x1;
                const xEnd = x2 === null ? scope.mediaSize.width + 100 : x2;
                
                if (y1 === null || y2 === null) continue;

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

class RectanglePaneView {
    constructor(plugin) {
        this._plugin = plugin;
    }

    zOrder() {
        return 'bottom'; // Draw behind candles
    }

    renderer() {
        return new RectangleRenderer(this._plugin._getViewData());
    }
}

export class RectanglePlugin {
    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new RectanglePaneView(this)];
        this._requestUpdate = () => {};
        this._rects = []; // Array of { p1: {price, time}, p2: {price, time} }
    }

    setRects(rects) {
        this._rects = rects;
        this._requestUpdate();
    }

    attached({ chart, series, requestUpdate }) {
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

    paneViews() {
        return this._paneViews;
    }

    _getViewData() {
        if (!this._chart || !this._series || this._rects.length === 0) return null;

        const timeScale = this._chart.timeScale();
        const renderRects = this._rects.map(rect => {
            const y1 = this._series.priceToCoordinate(rect.p1.price);
            const y2 = this._series.priceToCoordinate(rect.p2.price);
            
            if (y1 === null || y2 === null) return null;

            let x1 = timeScale.timeToCoordinate(rect.p1.time);
            let x2 = timeScale.timeToCoordinate(rect.p2.time);

            // Handle missing timestamps by finding the nearest data point
            if (x1 === null) x1 = this._getClosestX(rect.p1.time, timeScale);
            if (x2 === null) x2 = this._getClosestX(rect.p2.time, timeScale);

            return { x1, y1, x2, y2 };
        }).filter(r => r !== null);

        return { rects: renderRects };
    _getClosestX(targetTime, timeScale) {
        const data = this._series.data();
        if (!data || data.length === 0) return null;
        
        if (targetTime <= data[0].time) return -10000;
        if (targetTime >= data[data.length - 1].time) return timeScale.timeToCoordinate(data[data.length - 1].time);

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
            const diffLeft = Math.abs(data[left].time - targetTime);
            const diffRight = Math.abs(data[right].time - targetTime);
            closestIdx = diffLeft < diffRight ? left : right;
        } else if (left < data.length) {
            closestIdx = left;
        }
        
        return timeScale.timeToCoordinate(data[closestIdx].time);
    }
}
