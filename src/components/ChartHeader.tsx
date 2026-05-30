import React, { useState, useRef, useEffect } from 'react';
import { Maximize2, Minimize2, Search, ChevronDown, Clock, Minus, Square, Trash2 } from 'lucide-react';
import { BORDER_COLORS, DrawType, GroupColor, Timeframe } from '../types';

interface ChartHeaderProps {
  ticker: string;
  setTicker: (t: string) => void;
  timeframe: Timeframe;
  setTimeframe: (tf: Timeframe) => void;
  showEth: boolean;
  setShowEth: (v: boolean) => void;
  showVP: boolean;
  setShowVP: (v: boolean) => void;
  isDrawingMode: boolean;
  setIsDrawingMode: (v: boolean) => void;
  drawType: DrawType;
  setDrawType: (t: DrawType) => void;
  tickers: string[];
  groupColor: GroupColor;
  onGroupChange?: (color: GroupColor) => void;
  onTickerChange?: (ticker: string) => void;
  onUpdateDrawings: (ticker: string, type: 'rays' | 'rects', items: []) => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
}

export function ChartHeader({
  ticker, setTicker, timeframe, setTimeframe, showEth, setShowEth, showVP, setShowVP,
  isDrawingMode, setIsDrawingMode, drawType, setDrawType, tickers, groupColor,
  onGroupChange, onTickerChange, onUpdateDrawings, isMaximized, onToggleMaximize
}: ChartHeaderProps) {
  const [isTickerOpen, setIsTickerOpen] = useState(false);
  const [isTfOpen, setIsTfOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState('');

  const tickerRef = useRef<HTMLDivElement>(null);
  const tfRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (tickerRef.current && !tickerRef.current.contains(e.target as Node)) setIsTickerOpen(false);
      if (tfRef.current && !tfRef.current.contains(e.target as Node)) setIsTfOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredTickers = tickers.filter(t => t.toLowerCase().includes(tickerSearch.toLowerCase()));

  return (
    <div className="chart-header">
      <div className="chart-controls">
        
        {/* CUSTOM TICKER SELECT */}
        <div className="custom-dropdown-container" ref={tickerRef}>
          <div 
            className={`custom-select ${isTickerOpen ? 'active' : ''}`} 
            onClick={(e) => {
              e.stopPropagation();
              setIsTickerOpen(!isTickerOpen);
            }}
          >
            <Search size={14} className="text-secondary" />
            <span style={{fontWeight: '700'}}>{ticker}</span>
            <ChevronDown size={14} className="text-secondary" />
          </div>
          
          {isTickerOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-search">
                <input 
                  autoFocus 
                  placeholder="Search symbols..." 
                  value={tickerSearch} 
                  onChange={(e) => setTickerSearch(e.target.value)}
                />
              </div>
              <div className="dropdown-items">
                {filteredTickers.map(t => (
                  <div 
                    key={t} 
                    className={`dropdown-item ${t === ticker ? 'selected' : ''}`}
                    onClick={() => {
                      setTicker(t);
                      if (onTickerChange) {
                        onTickerChange(t);
                      }
                      setIsTickerOpen(false);
                      setTickerSearch('');
                    }}
                  >
                    {t}
                  </div>
                ))}
                {filteredTickers.length === 0 && <div className="dropdown-item" style={{opacity: 0.5}}>No results</div>}
              </div>
            </div>
          )}
        </div>

        {/* CUSTOM TIMEFRAME SELECT */}
        <div className="custom-dropdown-container" ref={tfRef}>
          <div 
            className={`custom-select ${isTfOpen ? 'active' : ''}`} 
            onClick={(e) => {
              e.stopPropagation();
              setIsTfOpen(!isTfOpen);
            }}
          >
            <Clock size={14} className="text-secondary" />
            <span>{timeframe.replace('min', 'm')}</span>
            <ChevronDown size={14} className="text-secondary" />
          </div>
          
          {isTfOpen && (
            <div className="dropdown-menu" style={{minWidth: '100px'}}>
              <div className="dropdown-items">
                {(['1min', '5min', '15min', '30min', '1H', '1D'] as Timeframe[]).map(tf => (
                  <div 
                    key={tf} 
                    className={`dropdown-item ${tf === timeframe ? 'selected' : ''}`}
                    onClick={() => {
                      setTimeframe(tf);
                      setIsTfOpen(false);
                    }}
                  >
                    {tf.replace('min', 'm')}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* GROUP PICKER */}
        <div className="group-picker" title="Assign to Group">
          {(['red', 'blue', 'green', 'yellow', 'none'] as GroupColor[]).map(color => (
            <div
              key={color}
              className={`group-dot ${color === groupColor ? 'active' : ''}`}
              style={{ backgroundColor: color === 'none' ? '#555' : BORDER_COLORS[color as Exclude<GroupColor, 'none'>] }}
              onClick={() => onGroupChange && onGroupChange(color)}
            />
          ))}
        </div>

        {/* PREMIUM ETH TOGGLE */}
        <div className="switch-container" onClick={() => setShowEth(!showEth)}>
          <div className={`switch-track ${showEth ? 'active' : ''}`}>
            <div className="switch-thumb" />
          </div>
          <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>ETH</span>
        </div>

        {/* VOLUME PROFILE TOGGLE */}
        <div className="switch-container" onClick={() => setShowVP(!showVP)} title="Volume Profile">
          <div className={`switch-track ${showVP ? 'active' : ''}`}>
            <div className="switch-thumb" />
          </div>
          <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>VP</span>
        </div>

        {/* HORIZONTAL RAY DRAWING */}
        <div 
          className="switch-container" 
          onClick={() => {
            if (isDrawingMode && drawType === 'ray') {
              setIsDrawingMode(false);
            } else {
              setIsDrawingMode(true);
              setDrawType('ray');
            }
          }}
          title="Horizontal Ray (Alt+J)"
        >
          <div className={`switch-track ${isDrawingMode && drawType === 'ray' ? 'active' : ''}`} style={{ width: '28px' }}>
            <Minus size={14} style={{ margin: 'auto' }} />
          </div>
          <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>RAY</span>
        </div>

        {/* RECTANGLE DRAWING */}
        <div 
          className="switch-container" 
          onClick={() => {
            if (isDrawingMode && drawType === 'rect') {
              setIsDrawingMode(false);
            } else {
              setIsDrawingMode(true);
              setDrawType('rect');
            }
          }}
          title="Rectangle (Alt+Shift+R)"
        >
          <div className={`switch-track ${isDrawingMode && drawType === 'rect' ? 'active' : ''}`} style={{ width: '28px' }}>
            <Square size={12} style={{ margin: 'auto' }} />
          </div>
          <span style={{fontWeight: '600', letterSpacing: '0.05em'}}>RECT</span>
        </div>

        {/* CLEAR DRAWINGS */}
        <div 
          className="switch-container" 
          onClick={() => {
            if (window.confirm('Clear all drawings for ' + ticker + '?')) {
              onUpdateDrawings(ticker, 'rays', []);
              onUpdateDrawings(ticker, 'rects', []);
            }
          }}
          title="Clear All Drawings"
        >
          <div className="switch-track" style={{ width: '28px', background: 'rgba(239, 83, 80, 0.1)' }}>
            <Trash2 size={14} color="var(--accent-red)" style={{ margin: 'auto' }} />
          </div>
          <span style={{fontWeight: '600', letterSpacing: '0.05em', color: 'var(--accent-red)'}}>CLEAR</span>
        </div>
      </div>
      
      <div className="chart-actions">
         <button className="btn-icon" onClick={onToggleMaximize} title={isMaximized ? "Minimize" : "Maximize"}>
           {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
         </button>
      </div>
    </div>
  );
}
