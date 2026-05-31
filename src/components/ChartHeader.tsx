import React, { useState, useRef, useEffect } from 'react';
import { Maximize2, Minimize2, Search, ChevronDown, Clock, Minus, Square, Trash2, Settings } from 'lucide-react';
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState('');

  const tickerRef = useRef<HTMLDivElement>(null);
  const tfRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (tickerRef.current && !tickerRef.current.contains(target)) setIsTickerOpen(false);
      if (tfRef.current && !tfRef.current.contains(target)) setIsTfOpen(false);
      if (settingsRef.current && !settingsRef.current.contains(target)) setIsSettingsOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredTickers = tickers.filter(t => t.toLowerCase().includes(tickerSearch.toLowerCase()));

  return (
    <div className="chart-header">
      <div className="chart-controls">
        
        {/* ZONE A: PRIMARY CONTROLS */}
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

        {/* ZONE B: SETTINGS DROPDOWN */}
        <div className="custom-dropdown-container" ref={settingsRef}>
          <div 
            className={`custom-select ${isSettingsOpen ? 'active' : ''} ${isDrawingMode ? 'active-drawing' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setIsSettingsOpen(!isSettingsOpen);
            }}
            title="Settings & Tools"
          >
            <Settings size={14} className={isSettingsOpen ? 'text-primary' : 'text-secondary'} />
            <span style={{fontWeight: '600'}}>Settings</span>
            <ChevronDown size={14} className="text-secondary" />
          </div>

          {isSettingsOpen && (
            <div className="dropdown-menu" style={{minWidth: '200px'}}>
              <div className="dropdown-section">
                <div className="dropdown-section-label">Analysis</div>
                <div 
                  className={`dropdown-item ${showEth ? 'active' : ''}`}
                  onClick={() => setShowEth(!showEth)}
                >
                  <span>Extended Hours (ETH)</span>
                  <div className={`switch-track ${showEth ? 'active' : ''}`} style={{zoom: 0.8}}>
                    <div className="switch-thumb" />
                  </div>
                </div>
                <div 
                  className={`dropdown-item ${showVP ? 'active' : ''}`}
                  onClick={() => setShowVP(!showVP)}
                >
                  <span>Volume Profile (VP)</span>
                  <div className={`switch-track ${showVP ? 'active' : ''}`} style={{zoom: 0.8}}>
                    <div className="switch-thumb" />
                  </div>
                </div>
              </div>

              <div className="dropdown-divider" />

              <div className="dropdown-section">
                <div className="dropdown-section-label">Tools</div>
                <div 
                  className={`dropdown-item ${isDrawingMode && drawType === 'ray' ? 'active' : ''}`}
                  onClick={() => {
                    if (isDrawingMode && drawType === 'ray') {
                      setIsDrawingMode(false);
                    } else {
                      setIsDrawingMode(true);
                      setDrawType('ray');
                    }
                  }}
                >
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <Minus size={14} />
                    <span>Horizontal Ray</span>
                  </div>
                  <span className="shortcut-hint">Alt+J</span>
                </div>
                <div 
                  className={`dropdown-item ${isDrawingMode && drawType === 'rect' ? 'active' : ''}`}
                  onClick={() => {
                    if (isDrawingMode && drawType === 'rect') {
                      setIsDrawingMode(false);
                    } else {
                      setIsDrawingMode(true);
                      setDrawType('rect');
                    }
                  }}
                >
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <Square size={12} />
                    <span>Rectangle</span>
                  </div>
                  <span className="shortcut-hint">Alt+Shift+R</span>
                </div>
              </div>

              <div className="dropdown-divider" />

              <div className="dropdown-section">
                <div 
                  className="dropdown-item danger"
                  onClick={() => {
                    if (window.confirm('Clear all drawings for ' + ticker + '?')) {
                      onUpdateDrawings(ticker, 'rays', []);
                      onUpdateDrawings(ticker, 'rects', []);
                      setIsSettingsOpen(false);
                    }
                  }}
                >
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <Trash2 size={14} />
                    <span>Clear All Drawings</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* ZONE C: WINDOW ACTIONS */}
      <div className="chart-actions">
         <button className="btn-icon" onClick={onToggleMaximize} title={isMaximized ? "Minimize" : "Maximize"}>
           {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
         </button>
      </div>
    </div>

  );
}
