import React from 'react';
import type { 
    IChartApi, 
    ISeriesApi, 
    ISeriesPrimitive, 
    ISeriesPrimitivePaneRenderer, 
    ISeriesPrimitivePaneView,
    Time,
    SeriesPrimitivePaneViewZOrder,
    SeriesAttachedParameter,
    Coordinate
} from 'lightweight-charts';
import type { ActiveTrade, TradeType } from '../types';

interface TradeRenderData {
    yEntry: Coordinate;
    ySL: Coordinate | null;
    yTP: Coordinate | null;
    type: TradeType;
}

class TradeRenderer implements ISeriesPrimitivePaneRenderer {
    _data: TradeRenderData | null;
    _badgeRef: React.RefObject<HTMLDivElement | null> | null;

    constructor(data: TradeRenderData | null, badgeRef: React.RefObject<HTMLDivElement | null> | null) {
        this._data = data;
        this._badgeRef = badgeRef;
    }

    draw(target: any) {
        try {
            target.useMediaCoordinateSpace((scope: any) => {
                const ctx = scope.context;
                if (!this._data) return;

                const { yEntry, ySL, yTP, type } = this._data;
                const rightEdge = scope.mediaSize.width;

                ctx.save();
                ctx.globalAlpha = 0.8;

                const entryColor = type === 'long' ? '#26a69a' : '#ef5350';
                ctx.strokeStyle = entryColor;
                ctx.lineWidth = 2; 

                let badgeStart = rightEdge;
                let badgeEnd = rightEdge;
                const gapPadding = 6; 

                if (this._badgeRef && this._badgeRef.current) {
                    const badgeRect = this._badgeRef.current.getBoundingClientRect();
                    const canvasRect = scope.context.canvas.getBoundingClientRect();
                    
                    badgeStart = badgeRect.left - canvasRect.left - gapPadding;
                    badgeEnd = badgeRect.right - canvasRect.left + gapPadding;
                }

                ctx.beginPath();
                ctx.moveTo(0, yEntry);
                ctx.lineTo(Math.max(0, badgeStart), yEntry);
                ctx.stroke();

                if (badgeEnd < rightEdge) {
                    ctx.beginPath();
                    ctx.moveTo(badgeEnd, yEntry);
                    ctx.lineTo(rightEdge, yEntry);
                    ctx.stroke();
                }

                const drawLine = (y: Coordinate | null, color: string, label: string) => {
                    if (y === null || isNaN(y)) return;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(rightEdge, y);
                    ctx.stroke();

                    if (label) {
                        ctx.fillStyle = color;
                        ctx.font = 'bold 10px Inter, sans-serif';
                        ctx.textAlign = 'right';
                        ctx.fillText(label, rightEdge - 5, y - 5);
                    }
                };

                drawLine(ySL, '#ef5350', 'SL');
                drawLine(yTP, '#26a69a', 'TP');

                ctx.restore();
            });
        } catch (err) {
            console.error('TradeRenderer draw error:', err);
        }
    }
}

class TradePaneView implements ISeriesPrimitivePaneView {
    _plugin: TradePlugin;

    constructor(plugin: TradePlugin) {
        this._plugin = plugin;
    }

    zOrder(): SeriesPrimitivePaneViewZOrder {
        return 'top';
    }

    renderer(): ISeriesPrimitivePaneRenderer {
        try {
            const data = this._plugin._getViewData();
            return new TradeRenderer(data, this._plugin._badgeRef);
        } catch(e) {
            console.error('TradePaneView renderer error:', e);
            return new TradeRenderer(null, null);
        }
    }
}

export class TradePlugin implements ISeriesPrimitive<Time> {
    _chart: IChartApi | null;
    _series: ISeriesApi<"Candlestick"> | null;
    _paneViews: TradePaneView[];
    _requestUpdate: () => void;
    _trade: ActiveTrade | null;
    _badgeRef: React.RefObject<HTMLDivElement | null> | null;

    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new TradePaneView(this)];
        this._requestUpdate = () => {};
        this._trade = null;
        this._badgeRef = null;
    }

    setTrade(trade: ActiveTrade | null) {
        this._trade = trade;
        this._requestUpdate();
        setTimeout(() => this._requestUpdate(), 0);
    }

    setBadgeRef(ref: React.RefObject<HTMLDivElement | null>) {
        this._badgeRef = ref;
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

    _getViewData(): TradeRenderData | null {
        try {
            if (!this._trade || !this._series) {
                if (this._badgeRef && this._badgeRef.current) {
                    this._badgeRef.current.style.display = 'none';
                }
                return null;
            }

            const { entryPrice, slPrice, tpPrice, type } = this._trade;

            const yEntry = this._series.priceToCoordinate(entryPrice);
            const ySL = slPrice ? this._series.priceToCoordinate(slPrice) : null;
            const yTP = tpPrice ? this._series.priceToCoordinate(tpPrice) : null;

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
