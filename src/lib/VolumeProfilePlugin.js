class VolumeProfileRenderer {
    constructor(data) {
        this._data = data;
    }

    draw(target) {
        target.useMediaCoordinateSpace(scope => {
            const ctx = scope.context;
            if (!this._data || !this._data.bins || this._data.bins.length === 0) return;
            
            const { bins, viewportWidth, boxHeight } = this._data;

            ctx.save();
            ctx.globalAlpha = 0.85;

            // Anchor to the right edge
            // In lw-charts, right edge of the chart (before scale axis) is scope.mediaSize.width
            const rightEdge = scope.mediaSize.width;

            for (const bin of bins) {
                // Determine colors based on POC
                if (bin.isPOC) {
                    ctx.fillStyle = 'rgba(255, 210, 0, 0.4)'; // Highlighted POC color
                } else {
                    ctx.fillStyle = 'rgba(41, 98, 255, 0.25)'; // Standard profile blue
                }

                const width = bin.width;
                // Draw rectangle originating from rightEdge going left
                ctx.fillRect(
                    rightEdge - width, 
                    bin.y - boxHeight / 2, 
                    width, 
                    Math.max(1, boxHeight - 1) // Leave a 1px gap for clarity
                );
                
                // Optional: Draw Point of Control Line
                if (bin.isPOC) {
                    ctx.fillStyle = 'rgba(255, 210, 0, 0.8)';
                    ctx.fillRect(
                        rightEdge - width, 
                        bin.y - 1, 
                        width, 
                        2
                    );
                }
            }

            ctx.restore();
        });
    }
}

class VolumeProfilePaneView {
    constructor(plugin) {
        this._plugin = plugin;
    }

    zOrder() {
        return 'bottom'; // Render behind candlesticks
    }

    renderer() {
        return new VolumeProfileRenderer(this._plugin._getViewData());
    }
}

export class VolumeProfilePlugin {
    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new VolumeProfilePaneView(this)];
        this._requestUpdate = () => {};
        
        this._masterData = [];
        this._vpDataCache = null;
        
        // Cache invalidation keys
        this._lastLogicalRange = { from: -1, to: -1 };
        this._lastWidth = 0;
        this._enabled = false;
    }

    setEnabled(enabled) {
        this._enabled = enabled;
        this._invalidateCache();
    }

    setData(data) {
        this._masterData = data;
        this._invalidateCache();
    }

    attached({ chart, series, requestUpdate }) {
        this._chart = chart;
        this._series = series;
        if (requestUpdate) {
            this._requestUpdate = requestUpdate;
        }
        
        // Ensure to invalidate cache on resize
        this._resizeHandler = () => this._invalidateCache();
        window.addEventListener('resize', this._resizeHandler);
    }

    detached() {
        window.removeEventListener('resize', this._resizeHandler);
        this._chart = null;
        this._series = null;
    }

    updateAllViews() {
        this._requestUpdate();
    }

    paneViews() {
        return this._paneViews;
    }

    _invalidateCache() {
        this._lastLogicalRange = { from: -1, to: -1 };
        this._requestUpdate();
    }

    _getViewData() {
        if (!this._enabled || !this._chart || !this._series || this._masterData.length === 0) return null;

        try {
            const timeScale = this._chart.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            if (!visibleRange) return null;

            const viewportWidth = timeScale.width();

            // Check cache (skip height — it's derived from price coords each frame)
            if (this._vpDataCache && 
                Math.abs(this._lastLogicalRange.from - visibleRange.from) < 0.5 && 
                Math.abs(this._lastLogicalRange.to - visibleRange.to) < 0.5 &&
                this._lastWidth === viewportWidth
            ) {
                return this._vpDataCache;
            }

            const data = this._masterData;
            const fromIndex = Math.max(0, Math.floor(visibleRange.from));
            const toIndex = Math.min(data.length - 1, Math.ceil(visibleRange.to));
            
            if (toIndex <= fromIndex) return null;

            // 1. Find Min/Max price in visible range
            let minPrice = Infinity;
            let maxPrice = -Infinity;
            for (let i = fromIndex; i <= toIndex; i++) {
                const bar = data[i];
                if (bar.low < minPrice) minPrice = bar.low;
                if (bar.high > maxPrice) maxPrice = bar.high;
            }
            
            if (minPrice === Infinity || minPrice === maxPrice) return null;

            // 2. Generate Bins
            const numBins = 70;
            const binSize = (maxPrice - minPrice) / numBins;
            const bins = new Array(numBins).fill(0);

            // 3. Populate Bins — distribute volume proportionally across price range
            for (let i = fromIndex; i <= toIndex; i++) {
                const bar = data[i];
                const topBin = Math.min(numBins - 1, Math.floor((bar.high - minPrice) / binSize));
                const bottomBin = Math.max(0, Math.floor((bar.low - minPrice) / binSize));
                
                const binsCovered = topBin - bottomBin + 1;
                const volPerBin = bar.volume / binsCovered;
                
                for (let j = bottomBin; j <= topBin; j++) {
                    bins[j] += volPerBin;
                }
            }

            // 4. Find Max Volume (POC)
            let maxVol = 0;
            let pocIndex = -1;
            for (let i = 0; i < numBins; i++) {
                if (bins[i] > maxVol) {
                    maxVol = bins[i];
                    pocIndex = i;
                }
            }

            if (maxVol === 0) return null;

            // 5. Convert to Coordinates
            const maxBarWidthPixels = viewportWidth * 0.25;
            const renderBins = [];

            // Derive box height from price-to-coordinate mapping (no priceScale.height() needed)
            const yTop = this._series.priceToCoordinate(maxPrice);
            const yBottom = this._series.priceToCoordinate(minPrice);
            if (yTop === null || yBottom === null) return null;
            
            const totalPixels = Math.abs(yBottom - yTop);
            const boxHeight = totalPixels / numBins;

            for (let i = 0; i < numBins; i++) {
                if (bins[i] === 0) continue;
                
                const binPriceCenter = minPrice + i * binSize + (binSize / 2);
                const y = this._series.priceToCoordinate(binPriceCenter);
                
                if (y === null) continue;

                renderBins.push({
                    y: y,
                    width: (bins[i] / maxVol) * maxBarWidthPixels,
                    isPOC: i === pocIndex
                });
            }

            this._vpDataCache = {
                bins: renderBins,
                viewportWidth,
                boxHeight
            };
            
            this._lastLogicalRange = { from: visibleRange.from, to: visibleRange.to };
            this._lastWidth = viewportWidth;

            return this._vpDataCache;
        } catch (e) {
            // Gracefully fail — don't crash the chart renderer
            return null;
        }
    }
}
