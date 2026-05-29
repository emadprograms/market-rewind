class TradeRenderer {
    constructor(data) {
        this._data = data;
    }

    draw(target) {
        target.useMediaCoordinateSpace(scope => {
            const ctx = scope.context;
            if (!this._data) return;

            const { entryPrice, slPrice, tpPrice, type } = this._data;
            const series = this._pluginRef.series;
            if (!series) return;

            const yEntry = series.priceToCoordinate(entryPrice);
            const ySL = series.priceToCoordinate(slPrice);
            const yTP = series.priceToCoordinate(tpPrice);
            const rightEdge = scope.mediaSize.width;

            if (yEntry === null) return;

            ctx.save();
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.globalAlpha = 0.8;

            const drawLine = (y, color, label) => {
                if (y === null) return;
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
        const data = this._plugin._getViewData();
        const renderer = new TradeRenderer(data);
        renderer._pluginRef = this._plugin;
        return renderer;
    }
}

export class TradePlugin {
    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new TradePaneView(this)];
        this._requestUpdate = () => {};
        this._trade = null;
    }

    setTrade(trade) {
        this._trade = trade;
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
        return this._trade;
    }
}
