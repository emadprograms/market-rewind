class TradeRenderer {
    constructor(data) {
        this._data = data;
    }

    draw(target) {
        try {
            target.useMediaCoordinateSpace(scope => {
                const ctx = scope.context;
                if (!this._data) return;

                const { yEntry, ySL, yTP, type } = this._data;
                const rightEdge = scope.mediaSize.width;

                if (yEntry === null || yEntry === undefined) return;

                ctx.save();
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.globalAlpha = 0.8;

                const drawLine = (y, color, label) => {
                    if (y === null || y === undefined || isNaN(y)) return;
                    ctx.strokeStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(rightEdge, y);
                    ctx.stroke();

                    // Label
                    ctx.fillStyle = color;
                    ctx.font = 'bold 10px Inter, sans-serif';
                    ctx.textAlign = 'right';
                    ctx.fillText(label, rightEdge - 5, y - 5);
                };

                // Entry Line
                drawLine(yEntry, '#94a3b8', 'Entry');
                // SL Line
                drawLine(ySL, '#ef5350', 'SL');
                // TP Line
                drawLine(yTP, '#26a69a', 'TP');

                ctx.restore();
            });
        } catch (err) {
            console.error('TradeRenderer draw error:', err);
        }
    }
}

class TradePaneView {
    constructor(plugin) {
        this._plugin = plugin;
    }

    zOrder() {
        return 'top';
    }

    renderer() {
        try {
            const data = this._plugin._getViewData();
            return new TradeRenderer(data);
        } catch(e) {
            console.error('TradePaneView renderer error:', e);
            return new TradeRenderer(null);
        }
    }
}

export class TradePlugin {
    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new TradePaneView(this)];
        this._requestUpdate = () => {};
        this._trade = null;
        this._badgeRef = null;
    }

    setTrade(trade) {
        this._trade = trade;
        this._requestUpdate();
    }

    setBadgeRef(ref) {
        this._badgeRef = ref;
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
        try {
            if (!this._trade || !this._series) {
                if (this._badgeRef && this._badgeRef.current) {
                    this._badgeRef.current.style.display = 'none';
                }
                return null;
            }

            const { entryPrice, slPrice, tpPrice, type } = this._trade;
            if (entryPrice === undefined) return null;

            const yEntry = this._series.priceToCoordinate(entryPrice);
            const ySL = this._series.priceToCoordinate(slPrice);
            const yTP = this._series.priceToCoordinate(tpPrice);

            // Update the HTML badge position directly to bypass React render cycle
            if (this._badgeRef && this._badgeRef.current) {
                const badge = this._badgeRef.current;
                if (yEntry === null) {
                    badge.style.display = 'none';
                } else {
                    badge.style.display = 'flex';
                    badge.style.top = `${yEntry}px`;
                }
            }

            if (yEntry === null) return null;

            return { yEntry, ySL, yTP, type };
        } catch(e) {
            console.error('TradePlugin _getViewData error:', e);
            return null;
        }
    }
}
