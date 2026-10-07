import React from 'react';
import type { 
    IChartApi, 
    ISeriesApi, 
    ISeriesPrimitive, 
    ISeriesPrimitivePaneRenderer, 
    ISeriesPrimitivePaneView,
    ISeriesPrimitiveAxisView,
    Time,
    SeriesPrimitivePaneViewZOrder,
    SeriesAttachedParameter,
    Coordinate
} from 'lightweight-charts';
import type { OrderDirection, ActiveTrade } from '../types';

export interface ChartMarker {
    id: string;
    epic: string;
    price: number;
    direction: OrderDirection;
    size: number;
    type: 'POSITION' | 'ORDER' | 'EXECUTION';
    time?: Time; // Used for EXECUTION markers
    label?: string;
    isDashed?: boolean;
    parentPrice?: number;
    hasSL?: boolean;
    hasTP?: boolean;
    candleLow?: number;
    candleHigh?: number;
}

interface TradeRenderItem {
    y: Coordinate;
    direction: OrderDirection;
    id: string;
    type: 'POSITION' | 'ORDER' | 'EXECUTION';
    isDashed?: boolean;
    parentY?: Coordinate | null;
    x?: Coordinate | null; // For EXECUTION
    arrowY?: Coordinate | null; // For EXECUTION
}

class TradeRenderer implements ISeriesPrimitivePaneRenderer {
    _items: TradeRenderItem[];
    _badgeRefs: Map<string, React.RefObject<HTMLDivElement | null>>;
    _hoveredId: string | null;
    _hoveredExecutions: { x: Coordinate, y: Coordinate, direction: OrderDirection, action: 'ENTRY' | 'EXIT', price: number }[];
    _chart: IChartApi | null;

    constructor(
        items: TradeRenderItem[], 
        badgeRefs: Map<string, React.RefObject<HTMLDivElement | null>>, 
        hoveredId: string | null,
        hoveredExecutions: { x: Coordinate, y: Coordinate, direction: OrderDirection, action: 'ENTRY' | 'EXIT', price: number }[] = [],
        chart: IChartApi | null = null
    ) {
        this._items = items;
        this._badgeRefs = badgeRefs;
        this._hoveredId = hoveredId;
        this._hoveredExecutions = hoveredExecutions;
        this._chart = chart;
    }

    draw(target: { useMediaCoordinateSpace: (callback: (scope: any) => void) => void }) {
        try {
            target.useMediaCoordinateSpace((scope: any) => {
                const ctx = scope.context;
                if (!this._items.length) return;

                const rightEdge = scope.mediaSize.width;
                const canvasRect = scope.context.canvas.getBoundingClientRect();

                ctx.save();
                ctx.globalAlpha = 0.8;

                const executionCounts = new Map<string, number>();

                this._items.forEach(item => {
                    const { y, direction, id } = item;
                    if (y === null) return;

                    let color = direction === 'BUY' ? '#2962ff' : '#f23645';
                    if (item.isDashed || item.id.endsWith('_SL')) { 
                        color = '#facc15'; // solid yellow for SL
                    }
                    if (item.id.endsWith('_TP')) {
                        color = '#089981'; // solid green for TP
                    }
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([]); // always solid

                    let badgeStart = rightEdge;
                    let badgeEnd = rightEdge;
                    const gapPadding = 0;

                    const ref = this._badgeRefs.get(id);
                    if (ref && ref.current) {
                        const badgeRect = ref.current.getBoundingClientRect();
                        badgeStart = badgeRect.left - canvasRect.left - gapPadding;
                        badgeEnd = badgeRect.right - canvasRect.left + gapPadding;
                    }

                    if (item.type === 'EXECUTION' && item.x !== undefined && item.x !== null) {
                        // Draw sleek modern chevron arrow for executions
                        ctx.save();
                        const { x, direction } = item;
                        let yPos = item.arrowY ?? item.y; // Fallback to execution price if no high/low available
                        
                        const key = `${Math.round(x)}_${direction}`;
                        const count = executionCounts.get(key) || 0;
                        executionCounts.set(key, count + 1);
                        
                        let scale = 1;
                        if (this._chart) {
                            const logicalRange = this._chart.timeScale().getVisibleLogicalRange();
                            if (logicalRange) {
                                const width = this._chart.timeScale().width();
                                const barsVisible = logicalRange.to - logicalRange.from;
                                const barSpacing = width / barsVisible;
                                if (barSpacing < 8) {
                                    scale = Math.max(0.3, barSpacing / 8);
                                }
                            }
                        }
                        
                        const isBuy = direction === 'BUY';
                        
                        // Stack offset calculation
                        const stackOffset = count * 8 * scale;
                        if (isBuy) {
                            yPos = (yPos + stackOffset) as Coordinate;
                        } else {
                            yPos = (yPos - stackOffset) as Coordinate;
                        }

                        ctx.fillStyle = isBuy ? '#007aff' : '#ff3b30';
                        ctx.beginPath();
                        
                        const h = 8 * scale;
                        const w = 4 * scale;
                        const offset = 6 * scale;
                        
                        if (isBuy) {
                            // Up Triangle BELOW the candle low
                            ctx.moveTo(x, yPos + offset);
                            ctx.lineTo(x + w, yPos + offset + h);
                            ctx.lineTo(x - w, yPos + offset + h);
                        } else {
                            // Down Triangle ABOVE the candle high
                            ctx.moveTo(x, yPos - offset);
                            ctx.lineTo(x + w, yPos - offset - h);
                            ctx.lineTo(x - w, yPos - offset - h);
                        }
                        ctx.closePath();
                        ctx.fill();
                        
                        ctx.lineWidth = Math.max(0.8, 1.5 * scale);
                        ctx.strokeStyle = '#ffffff';
                        ctx.stroke();
                        
                        ctx.restore();
                        return; // Done drawing EXECUTION
                    }

                    // For POSITION and ORDER
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(Math.max(0, badgeStart), y);
                    ctx.stroke();

                    if (badgeEnd < rightEdge) {
                        ctx.beginPath();
                        ctx.moveTo(badgeEnd, y);
                        ctx.lineTo(rightEdge, y);
                        ctx.stroke();
                    }

                    // Only draw connecting line if this specific badge is hovered
                    if (this._hoveredId === id && item.parentY !== undefined && item.parentY !== null) {
                        const lineX = badgeStart - 12;
                        ctx.save();
                        ctx.strokeStyle = color; // use the badge's color (yellow for SL)
                        ctx.fillStyle = '#1e293b'; // center of bubble matches chart bg
                        ctx.lineWidth = 1;
                        ctx.setLineDash([]); // solid line
                        
                        // Vertical line
                        ctx.beginPath();
                        ctx.moveTo(lineX, item.parentY);
                        ctx.lineTo(lineX, y);
                        ctx.stroke();

                        // Bubble at parent price
                        ctx.beginPath();
                        ctx.arc(lineX, item.parentY, 3, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.stroke();

                        // Bubble at SL/TP price
                        ctx.beginPath();
                        ctx.arc(lineX, y, 3, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.stroke();

                        ctx.restore();
                    }
                });

                // Draw Hovered Execution Sideways Arrows
                this._hoveredExecutions.forEach(exec => {
                    const { x, y, direction } = exec;
                    const size = 5;
                    
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x - size - 2, y - size); // Top left
                    ctx.lineTo(x - 2, y);               // Middle tip (slightly offset from crosshair)
                    ctx.lineTo(x - size - 2, y + size); // Bottom left
                    
                    ctx.lineJoin = 'round';
                    ctx.lineCap = 'round';
                    
                    // White outline
                    ctx.lineWidth = 5;
                    ctx.strokeStyle = '#ffffff';
                    ctx.stroke();
                    
                    // Vibrant inner stroke
                    ctx.lineWidth = 2.5;
                    ctx.strokeStyle = direction === 'BUY' ? '#007aff' : '#ff3b30';
                    ctx.stroke();
                    
                    ctx.restore();
                });

                ctx.setLineDash([]);
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
            const items = this._plugin._getViewData();
            return new TradeRenderer(
                items, 
                this._plugin._badgeRefs, 
                this._plugin._hoveredId, 
                this._plugin._hoveredExecutions,
                this._plugin._chart
            );
        } catch(e) {
            console.error('TradePaneView renderer error:', e);
            return new TradeRenderer([], new Map(), null, [], null);
        }
    }
}

class TradeAxisView implements ISeriesPrimitiveAxisView {
    _plugin: TradePlugin;
    _exec: { x: Coordinate, y: Coordinate, direction: OrderDirection, price: number };

    constructor(plugin: TradePlugin, exec: { x: Coordinate, y: Coordinate, direction: OrderDirection, price: number }) {
        this._plugin = plugin;
        this._exec = exec;
    }

    coordinate(): number {
        return this._exec.y;
    }

    text(): string {
        return this._plugin._series ? this._plugin._series.priceFormatter().format(this._exec.price) : '';
    }

    textColor(): string {
        return '#ffffff';
    }

    backColor(): string {
        return this._exec.direction === 'BUY' ? '#007aff' : '#ff3b30';
    }
}

export class TradePlugin implements ISeriesPrimitive<Time> {
    _chart: IChartApi | null;
    _series: ISeriesApi<"Candlestick"> | null;
    _paneViews: TradePaneView[];
    _requestUpdate: () => void;
    _items: ChartMarker[];
    _badgeRefs: Map<string, React.RefObject<HTMLDivElement | null>>;
    _hoveredId: string | null;
    _hoveredExecutions: { x: Coordinate, y: Coordinate, direction: OrderDirection, action: 'ENTRY' | 'EXIT', price: number }[] = [];

    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new TradePaneView(this)];
        this._requestUpdate = () => {};
        this._items = [];
        this._badgeRefs = new Map();
        this._hoveredId = null;
    }

    setItems(items: ChartMarker[]) {
        this._items = items;
        this._requestUpdate();
        // Force a second update to ensure React has rendered the badges and getBoundingClientRect is accurate
        setTimeout(() => this._requestUpdate(), 0);
    }

    setTrade(trade: ActiveTrade | null) {
        if (!trade) {
            this.setItems([]);
            return;
        }
        const markers: ChartMarker[] = [{
            id: 'active_trade',
            epic: '',
            price: trade.entryPrice,
            direction: trade.type === 'long' ? 'BUY' : 'SELL',
            size: trade.size,
            type: 'POSITION',
            hasSL: !!trade.slPrice,
            hasTP: !!trade.tpPrice,
        }];
        if (trade.slPrice) {
            markers.push({
                id: 'active_trade_SL',
                epic: '',
                price: trade.slPrice,
                direction: trade.type === 'long' ? 'SELL' : 'BUY',
                size: trade.size,
                type: 'ORDER',
                label: 'SL',
                isDashed: true,
                parentPrice: trade.entryPrice,
            });
        }
        if (trade.tpPrice) {
            markers.push({
                id: 'active_trade_TP',
                epic: '',
                price: trade.tpPrice,
                direction: trade.type === 'long' ? 'SELL' : 'BUY',
                size: trade.size,
                type: 'ORDER',
                label: 'TP',
                isDashed: true,
                parentPrice: trade.entryPrice,
            });
        }
        this.setItems(markers);
    }

    setBadgeRef(ref: React.RefObject<HTMLDivElement | null>) {
        this.registerBadgeRef('active_trade', ref);
    }

    setHoveredId(id: string | null) {
        if (this._hoveredId !== id) {
            this._hoveredId = id;
            this._requestUpdate();
        }
    }

    setHoveredExecutions(executions: { x: Coordinate, y: Coordinate, direction: OrderDirection, action: 'ENTRY' | 'EXIT', price: number }[]) {
        this._hoveredExecutions = executions;
        this._requestUpdate();
    }

    registerBadgeRef(id: string, ref: React.RefObject<HTMLDivElement | null>) {
        this._badgeRefs.set(id, ref);
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
        // Deliberately empty.
        //
        // Lightweight Charts calls this from inside its draw path (price-scale
        // recalculation -> _internal_updateAllSources) so a primitive can refresh view
        // data it has cached against the current scale. This primitive caches nothing:
        // TradePaneView.renderer() calls _getViewData(), which recomputes every
        // coordinate from the live series/chart on each draw.
        //
        // Do NOT call this._requestUpdate() here. It resolves to
        // model._internal_fullUpdate() -> invalidate(InvalidateMask.full()), so requesting
        // a redraw from inside a redraw escalates the light invalidation LWC intended into
        // a FULL one, which also reruns _private__updateGui() (time axis, price axis
        // widgets, layout width). Data changes already invalidate via setItems/setTrade/
        // setHoveredId, which is where _requestUpdate() belongs.
    }

    paneViews(): readonly ISeriesPrimitivePaneView[] {
        return this._paneViews;
    }

    priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
        if (!this._hoveredExecutions.length) return [];
        return this._hoveredExecutions.map(exec => new TradeAxisView(this, exec));
    }

    _getViewData(): TradeRenderItem[] {
        try {
            if (!this._series || !this._chart) return [];

            return this._items.map(item => {
                const y = this._series!.priceToCoordinate(item.price);
                
                let x: Coordinate | null = null;
                if (item.time !== undefined && item.time !== null) {
                    try {
                        x = this._chart!.timeScale().timeToCoordinate(item.time as Time);
                    } catch (e) {
                        x = null;
                    }
                }

                let parentY = null;
                if (item.parentPrice) {
                    parentY = this._series!.priceToCoordinate(item.parentPrice);
                }
                
                let arrowY = y;
                if (item.type === 'EXECUTION') {
                    if (item.direction === 'BUY' && item.candleLow !== undefined) {
                        arrowY = this._series!.priceToCoordinate(item.candleLow);
                    } else if (item.direction === 'SELL' && item.candleHigh !== undefined) {
                        arrowY = this._series!.priceToCoordinate(item.candleHigh);
                    }
                }
                
                const ref = this._badgeRefs.get(item.id);
                if (ref && ref.current) {
                    if (y === null) {
                        ref.current.style.display = 'none';
                    } else {
                        ref.current.style.display = 'flex';
                        ref.current.style.top = `${y}px`;
                    }
                }

                return {
                    y: y as Coordinate,
                    direction: item.direction,
                    id: item.id,
                    type: item.type,
                    isDashed: item.isDashed,
                    parentY: parentY as Coordinate | null,
                    x: x as Coordinate | null,
                    arrowY: arrowY as Coordinate | null
                };
            }).filter(item => item.y !== null);
        } catch(e) {
            console.error('TradePlugin _getViewData error:', e);
            return [];
        }
    }
}
