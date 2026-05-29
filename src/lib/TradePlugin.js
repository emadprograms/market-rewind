class TradeRenderer {
    constructor(data, badgeRef) {
        this._data = data;
        this._badgeRef = badgeRef;
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
                ctx.setLineDash([4, 4]);
                ctx.globalAlpha = 0.8;

                // Entry Line: Color based on type, thicker, with gap
                const entryColor = type === 'long' ? '#26a69a' : '#ef5350';
                ctx.strokeStyle = entryColor;
                ctx.lineWidth = 2; // Thicker line

                // Calculate gap based on badge position
                let badgeStart = rightEdge;
                let badgeEnd = rightEdge;
                if (this._badgeRef && this._badgeRef.current) {
                    const badgeWidth = this._badgeRef.current.offsetWidth;
                    badgeEnd = rightEdge - 90; // CSS: right: 90px
                    badgeStart = badgeEnd - badgeWidth;
                }

                ctx.beginPath();
                // Line segment 1: 0 to badgeStart
                ctx.moveTo(0, yEntry);
                ctx.lineTo(Math.max(0, badgeStart), yEntry);
                ctx.stroke();

                // Line segment 2: badgeEnd to rightEdge
                if (badgeEnd < rightEdge) {
                    ctx.beginPath();
                    ctx.moveTo(badgeEnd, yEntry);
                    ctx.lineTo(rightEdge, yEntry);
                    ctx.stroke();
                }

                // SL & TP Lines
                const drawLine = (y, color, label) => {
                    if (y === null || y === undefined || isNaN(y)) return;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(rightEdge, y);
                    ctx.stroke();

                    // Label - Only draw if label is provided
                    if (label) {
                        ctx.fillStyle = color;
                        ctx.font = 'bold 10px Inter, sans-serif';
                        ctx.textAlign = 'right';
                        ctx.fillText(label, rightEdge - 5, y - 5);
                    }
                };

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
            return new TradeRenderer(data, this._plugin._badgeRef);
        } catch(e) {
            console.error('TradePaneView renderer error:', e);
            return new TradeRenderer(null, null);
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
