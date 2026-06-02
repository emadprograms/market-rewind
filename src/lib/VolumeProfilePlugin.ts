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
import type { ChartTarget, ChartScope } from '../types';

export interface VPDataBar {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface VPBin {
    y: Coordinate;
    width: number;
    isPOC: boolean;
}

interface VPRenderData {
    bins: VPBin[];
    viewportWidth: number;
    boxHeight: number;
}

interface VPVisibleRange {
    from: number;
    to: number;
}

class VolumeProfileRenderer implements ISeriesPrimitivePaneRenderer {
    _data: VPRenderData | null;

    constructor(data: VPRenderData | null) {
        this._data = data;
    }

    draw(target: ChartTarget) {
        target.useMediaCoordinateSpace((scope: ChartScope) => {
            const ctx = scope.context;
            if (!this._data || !this._data.bins || this._data.bins.length === 0) return;
            
            const { bins, boxHeight } = this._data;

            ctx.save();
            ctx.globalAlpha = 0.85;

            const leftEdge = 0;

            for (const bin of bins) {
                if (bin.isPOC) {
                    ctx.fillStyle = 'rgba(255, 210, 0, 0.4)'; 
                } else {
                    ctx.fillStyle = 'rgba(41, 98, 255, 0.25)'; 
                }

                const width = bin.width;
                ctx.fillRect(
                    leftEdge, 
                    bin.y - boxHeight / 2, 
                    width, 
                    Math.max(1, boxHeight - 1) 
                );
                
                if (bin.isPOC) {
                    ctx.fillStyle = 'rgba(255, 210, 0, 0.8)';
                    ctx.fillRect(
                        leftEdge, 
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

class VolumeProfilePaneView implements ISeriesPrimitivePaneView {
    _plugin: VolumeProfilePlugin;

    constructor(plugin: VolumeProfilePlugin) {
        this._plugin = plugin;
    }

    zOrder(): SeriesPrimitivePaneViewZOrder {
        return 'bottom'; 
    }

    renderer(): ISeriesPrimitivePaneRenderer {
        return new VolumeProfileRenderer(this._plugin._getViewData());
    }
}

export class VolumeProfilePlugin implements ISeriesPrimitive<Time> {
    _chart: IChartApi | null;
    _series: ISeriesApi<"Candlestick"> | null;
    _paneViews: VolumeProfilePaneView[];
    _requestUpdate: () => void;
    _masterData: VPDataBar[];
    _vpDataCache: VPRenderData | null;
    _lastLogicalRange: VPVisibleRange;
    _lastWidth: number;
    _enabled: boolean;
    _resizeHandler: () => void;

    constructor() {
        this._chart = null;
        this._series = null;
        this._paneViews = [new VolumeProfilePaneView(this)];
        this._requestUpdate = () => {};
        
        this._masterData = [];
        this._vpDataCache = null;
        
        this._lastLogicalRange = { from: -1, to: -1 };
        this._lastWidth = 0;
        this._enabled = false;
        this._resizeHandler = () => this._invalidateCache();
    }

    setEnabled(enabled: boolean) {
        this._enabled = enabled;
        this._invalidateCache();
    }

    setData(data: VPDataBar[]) {
        this._masterData = data;
        this._invalidateCache();
    }

    attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time, "Candlestick">) {
        this._chart = chart as IChartApi;
        this._series = series;
        this._requestUpdate = requestUpdate;
        
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

    paneViews(): readonly ISeriesPrimitivePaneView[] {
        return this._paneViews;
    }

    _invalidateCache() {
        this._lastLogicalRange = { from: -1, to: -1 };
        this._requestUpdate();
    }

    _getViewData(): VPRenderData | null {
        if (!this._enabled || !this._chart || !this._series || this._masterData.length === 0) return null;

        try {
            const timeScale = this._chart.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            if (!visibleRange) return null;

            const viewportWidth = timeScale.width();

            if (this._vpDataCache && 
                Math.abs(this._lastLogicalRange.from - (visibleRange.from ?? 0)) < 0.5 && 
                Math.abs(this._lastLogicalRange.to - (visibleRange.to ?? 0)) < 0.5 &&
                this._lastWidth === viewportWidth
            ) {
                return this._vpDataCache;
            }

            const data = this._masterData;
            const fromIndex = Math.max(0, Math.floor(visibleRange.from ?? 0));
            const toIndex = Math.min(data.length - 1, Math.ceil(visibleRange.to ?? 0));
            
            if (toIndex <= fromIndex) return null;

            let minPrice = Infinity;
            let maxPrice = -Infinity;
            for (let i = fromIndex; i <= toIndex; i++) {
                const bar = data[i];
                if (bar.low < minPrice) minPrice = bar.low;
                if (bar.high > maxPrice) maxPrice = bar.high;
            }
            
            if (minPrice === Infinity || minPrice === maxPrice) return null;

            const numBins = 70;
            const binSize = (maxPrice - minPrice) / numBins;
            const bins = new Array(numBins).fill(0);

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

            let maxVol = 0;
            let pocIndex = -1;
            for (let i = 0; i < numBins; i++) {
                if (bins[i] > maxVol) {
                    maxVol = bins[i];
                    pocIndex = i;
                }
            }

            if (maxVol === 0) return null;

            const maxBarWidthPixels = viewportWidth * 0.25;
            const renderBins: VPBin[] = [];

            const yTop = this._series!.priceToCoordinate(maxPrice);
            const yBottom = this._series!.priceToCoordinate(minPrice);
            if (yTop === null || yBottom === null) return null;
            
            const totalPixels = Math.abs(yBottom - yTop);
            const boxHeight = totalPixels / numBins;

            for (let i = 0; i < numBins; i++) {
                if (bins[i] === 0) continue;
                
                const binPriceCenter = minPrice + i * binSize + (binSize / 2);
                const y = this._series!.priceToCoordinate(binPriceCenter);
                
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
            
            this._lastLogicalRange = { from: visibleRange.from ?? 0, to: visibleRange.to ?? 0 };
            this._lastWidth = viewportWidth;

            return this._vpDataCache;
        } catch (e) {
            return null;
        }
    }
}
