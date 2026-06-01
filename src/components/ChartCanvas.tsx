import React from 'react';
import { ChevronRight } from 'lucide-react';
import { TradeBadge } from './TradeBadge';
import type { ActiveTrade } from '../types';

interface ChartCanvasProps {
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  isDrawingMode: boolean;
  isAtEnd: boolean;
  scrollToRealTime: () => void;
  activeTrade: ActiveTrade | null;
  currentPrice: number;
  tradeBadgeRef: React.RefObject<HTMLDivElement | null>;
  onCloseTrade: () => void;
}

export function ChartCanvas({
  chartContainerRef,
  isDrawingMode,
  isAtEnd,
  scrollToRealTime,
  activeTrade,
  currentPrice,
  tradeBadgeRef,
  onCloseTrade
}: ChartCanvasProps) {
  return (
    <div ref={chartContainerRef} style={{ flex: 1, position: 'relative', minHeight: 0, minWidth: 0, overflow: 'hidden', cursor: isDrawingMode ? 'crosshair' : 'default' }}>
      
      {!isAtEnd && (
        <button 
          className="scroll-to-end-btn"
          onClick={scrollToRealTime}
          title="Scroll to latest"
        >
          <ChevronRight size={18} />
        </button>
      )}

      {activeTrade && (
        <TradeBadge 
          activeTrade={activeTrade}
          currentPrice={currentPrice}
          tradeBadgeRef={tradeBadgeRef}
          onClose={onCloseTrade}
        />
      )}
    </div>
  );
}
