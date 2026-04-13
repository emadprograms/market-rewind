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
            ctx.lineWidth = 1;
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
            
            // If timeToCoordinate returns null, it's off-screen.
            // We need to determine if it's off-screen to the left or right.
            if (x === null) {
                // Approximate logical index to check position
                // A better way is to compare with the first/last visible data points
                const data = this._series.data();
                if (data.length > 0) {
                    const firstVisibleLogical = visibleRange.from;
                    // Find the logical index of the ray time
                    // For simplicity, we can assume if it's not on screen and time is early, it's to the left
                    if (ray.time < data[0].time) {
                        x = -100; // Well off-screen to the left
                    } else {
                        // It might be between data points or in the future
                        // But if it's a ray, we only care if it's to the left
                        // Let's just check if it's before the visible data
                        const firstDataOnScreen = data.find(d => timeScale.timeToCoordinate(d.time) !== null);
                        if (firstDataOnScreen && ray.time < firstDataOnScreen.time) {
                            x = -100;
                        } else {
                            return null; // Likely to the right or invalid
                        }
                    }
                } else {
                    return null;
                }
            }

            return { x, y };
        }).filter(r => r !== null);

        return {
            rays: renderRays
        };
    }
}
