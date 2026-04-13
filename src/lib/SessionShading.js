import { getTzForTicker } from './timezones';

/**
 * DETERMINISTIC SESSION CHECK: Using Intl.DateTimeFormat for robust DST handling.
 * RTH (US): 09:30 - 16:00 ET
 */
export function isRTH(timestamp) {
  const date = new Date(timestamp * 1000);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  const totalMinutes = hour * 60 + minute;
  
  // Market Open: 9:30 (570 mins)
  // Market Close: 16:00 (960 mins)
  return totalMinutes >= 570 && totalMinutes < 960;
}

/**
 * LIGHTWEIGHT CHARTS PLUGIN: Session Shading
 */
class SessionShadingRenderer {
  constructor(data) {
    this._data = data;
  }

  draw(ctx) {
    if (!this._data || this._data.visibleRange === null) return;
    
    const { bars, timeframe, visibleRange } = this._data;
    if (timeframe === '1D') return; // Don't shade daily charts

    ctx.save();
    ctx.fillStyle = 'rgba(41, 128, 255, 0.04)'; // Subtle TV-style Blue/Gray
    
    for (let i = visibleRange.from; i < visibleRange.to; i++) {
        const bar = bars[i];
        if (!bar) continue;
        
        // If it's NOT RTH, shade it
        if (!isRTH(bar.time)) {
            const x = bar.x;
            const width = bar.width;
            ctx.fillRect(x - width/2, 0, width, ctx.canvas.height);
        }
    }
    
    ctx.restore();
  }
}

export class SessionShadingPlugin {
  constructor(timeframe, isET) {
    this._timeframe = timeframe;
    this._isET = isET;
    this._chart = null;
    this._series = null;
    this._requestUpdate = () => {
        if (this._chart) this._chart.applyOptions({}); // Trigger re-render
    };
  }

  attached({ chart, series }) {
    this._chart = chart;
    this._series = series;
  }

  detached() {
    this._chart = null;
    this._series = null;
  }

  updateAllViews() {
    this._requestUpdate();
  }

  renderer() {
    if (!this._isET || this._timeframe === '1D' || !this._series || !this._chart) return null;

    const timeScale = this._chart.timeScale();
    const visibleRange = timeScale.getVisibleLogicalRange();
    if (!visibleRange) return null;

    // We need to map logical range to active bars
    // This is a simplified version for now
    const bars = [];
    const data = this._series.data();
    
    return new SessionShadingRenderer({
        bars: data.map(d => ({
            time: d.time,
            x: timeScale.timeToCoordinate(d.time),
            width: timeScale.options().barSpacing
        })),
        timeframe: this._timeframe,
        visibleRange: {
            from: Math.max(0, Math.floor(visibleRange.from)),
            to: Math.min(data.length, Math.ceil(visibleRange.to))
        }
    });
  }
}
