class HorizontalRayRenderer {
    constructor(data) {
        this._data = data;
    }

    draw(target) {
        target.useMediaCoordinateSpace(scope => {
            const ctx = scope.context;
            if (!this._data || !this._data.rays || this._data.rays.length === 0) return;

            ctx.save();
            ctx.strokeStyle = '#ff9800';
            ctx.lineWidth = 2; // Made thicker per request
            ctx.setLineDash([6, 4]); // Made dashed per request
            ctx.globalAlpha = 0.9;

            const rightEdge = scope.mediaSize.width;

            for (const ray of this._data.rays) {
                if (ray.x === null || ray.y === null) continue;
                
                ctx.beginPath();
                ctx.moveTo(ray.x, ray.y);
                ctx.lineTo(rightEdge, ray.y);
                ctx.stroke();

                // Draw price label background on the axis (optional but good for UX)
                // However, since we don't have direct access to the axis renderer here, 
                // we'll stick to just the canvas drawing for now to keep it lean.
            }

            ctx.restore();
        });
    }
}

class HorizontalRayPaneView {
    constructor(plugin) {
        this._plugin = plugin;
    }

    zOrder() {
        return 'top';
    }

    renderer() {
        return new HorizontalRayRenderer(this._plugin._getViewData());
    }
}

export class HorizontalRayPlugin {
    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new HorizontalRayPaneView(this)];
        this._requestUpdate = () => {};
        this._rays = []; // Array of { price, time }
    }

    setRays(rays) {
        this._rays = rays;
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
        if (!this._chart || !this._series || this._rays.length === 0) return null;

        const timeScale = this._chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (!visibleRange) return null;

        const renderRays = this._rays.map(ray => {
            const y = this._series.priceToCoordinate(ray.price);
            if (y === null) return null;

            let x = timeScale.timeToCoordinate(ray.time);
            if (x === null) {
                x = this._getClosestX(ray.time, timeScale);
            }

            return { x, y };
        }).filter(r => r !== null);

        return {
            rays: renderRays
        };
    }

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
