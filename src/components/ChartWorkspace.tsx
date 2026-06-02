import React from 'react';
import ChartUnit from './ChartUnit';
import ErrorBoundary from './ErrorBoundary';
import type { Timeframe, AllDrawings, GroupColor } from '../types';

interface ChartWorkspaceProps {
  layoutMode: string;
  maximizedId: number | null;
  panelSizes: Record<string, number[]>;
  activeGutter: number | null;
  tickers: string[];
  sessionTicker: string;
  selectedDate: string;
  isSessionStarted: boolean;
  drawings: AllDrawings;
  chartGroups: Record<string, GroupColor>;
  groupTickers: Record<string, string>;
  workspaceRef: React.RefObject<HTMLElement | null>;
  selectedChartId: number;
  onSelectChart: (id: number) => void;
  onToggleMaximize: (id: number) => void;
  onUpdateDrawings: (ticker: string, type: 'rays' | 'rects', items: any[]) => void;
  onPnLUpdate: (id: number, r: number, u: number) => void;
  onTickerChange: (chartId: number, newTicker: string) => void;
  onTimeframeChange: (chartId: number, tf: Timeframe) => void;
  onGroupChange: (chartId: number, newGroup: GroupColor) => void;
  onPointerDown: (mode: 'v' | 'h', index: number, e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerEnd: () => void;
}

export const ChartWorkspace: React.FC<ChartWorkspaceProps> = ({
  layoutMode,
  maximizedId,
  panelSizes,
  activeGutter,
  tickers,
  sessionTicker,
  selectedDate,
  isSessionStarted,
  drawings,
  chartGroups,
  groupTickers,
  workspaceRef,
  selectedChartId,
  onSelectChart,
  onToggleMaximize,
  onUpdateDrawings,
  onPnLUpdate,
  onTickerChange,
  onTimeframeChange,
  onGroupChange,
  onPointerDown,
  onPointerMove,
  onPointerEnd
}) => {
  const gridCount = layoutMode === '1' ? 1 : (layoutMode.startsWith('2') ? 2 : (layoutMode.startsWith('3') ? 3 : 4));
              
  const charts = Array.from({ length: gridCount }).map((_, i) => {
    let initialTicker = sessionTicker;
    let initialTf: Timeframe = '5min';
    let initialEth = false;

    if (gridCount === 2) {
      if (i === 0) { initialTf = '5min'; initialEth = true; }
      else if (i === 1) { initialTf = '1D'; }
    } else if (gridCount === 3) {
      if (i === 0) { initialTf = '5min'; }
      else if (i === 1) { initialTf = '1H'; }
      else if (i === 2) { initialTf = '1D'; }
    } else if (gridCount === 4) {
      if (i === 0) { initialTf = '5min'; }
      else if (i === 1) { initialTf = '1H'; }
      else if (i === 2) { initialTf = '1D'; }
      else if (i === 3) { 
        initialTicker = tickers.includes('SPY') ? 'SPY' : sessionTicker;
        initialTf = '5min';
      }
    }

    const sizes = panelSizes[layoutMode] || [100 / gridCount];
    const style: React.CSSProperties = {};
    
    const effectiveMaximizedId = (maximizedId !== null && maximizedId < gridCount) ? maximizedId : null;

    if (effectiveMaximizedId === i) {
      style.position = 'absolute';
      style.top = '0';
      style.left = '0';
      style.width = '100%';
      style.height = '100%';
      style.zIndex = 9999;
    } else if (effectiveMaximizedId === null) {
      const size = sizes[i] !== undefined ? sizes[i] : (100 / gridCount);
      if (layoutMode.endsWith('v')) style.width = `${size}%`;
      if (layoutMode.endsWith('h')) style.height = `${size}%`;
    } else {
      style.display = 'none';
    }

    return (
      <ErrorBoundary key={`${layoutMode}-${i}`}>
        <ChartUnit 
          id={i} 
          isSelected={selectedChartId === i}
          onSelect={() => onSelectChart(i)}
          tickers={tickers} 
          initialTicker={initialTicker}
          initialTf={initialTf}
          initialEth={initialEth}
          selectedDate={selectedDate} 
          isReplayMode={isSessionStarted}
          isMaximized={maximizedId === i}
          onToggleMaximize={() => onToggleMaximize(i)}
          allDrawings={drawings}
          onUpdateDrawings={onUpdateDrawings}
          onPnLUpdate={onPnLUpdate}
          onTimeframeChange={onTimeframeChange}
          groupColor={chartGroups[i.toString()] || 'none'}
          groupTicker={groupTickers[chartGroups[i.toString()] || 'none']}
          onGroupChange={(newGroup) => onGroupChange(i, newGroup)}
          onTickerChange={(newTicker) => onTickerChange(i, newTicker)}
          style={style}
        />
      </ErrorBoundary>
    );
  });

  const isResizable = ['2v', '2h', '3v', '3h'].includes(layoutMode);
  
  return (
    <main className={`workspace grid-${layoutMode}`} ref={workspaceRef}>
      {!maximizedId && isResizable ? (
        (() => {
          const res: React.ReactNode[] = [];
          const gutterMode = layoutMode.endsWith('v') ? 'v' : 'h';
          charts.forEach((chart, idx) => {
            res.push(chart);
            if (idx < charts.length - 1) {
              res.push(
                <div 
                  key={`g-${idx}`}
                  className={`gutter gutter-${gutterMode} ${activeGutter === idx ? 'active' : ''}`}
                  onPointerDown={(e) => onPointerDown(gutterMode, idx, e)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerEnd}
                  onLostPointerCapture={onPointerEnd}
                >
                  <div className="gutter-line" />
                </div>
              );
            }
          });
          return res;
        })()
      ) : charts}
    </main>
  );
};
