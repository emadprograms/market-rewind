import React, { useRef, useEffect } from 'react';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { X, Activity } from 'lucide-react';

interface TimeAndSalesProps {
  isOpen: boolean;
  onClose: () => void;
  symbol?: string;
}

export function TimeAndSales({ isOpen, onClose, symbol }: TimeAndSalesProps) {
  const bufferedTicks = usePlaybackStore((state) => state.bufferedTicks);
  const currentTickIndex = usePlaybackStore((state) => state.currentTickIndex);
  const currentTick = usePlaybackStore((state) => state.currentTick);

  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the list to center on current active tick
  useEffect(() => {
    if (!listRef.current) return;
    const activeRow = listRef.current.querySelector('.tick-row.is-active') as HTMLElement;
    if (activeRow && typeof activeRow.scrollIntoView === 'function') {
      activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentTickIndex]);

  if (!isOpen) return null;

  // Window of ticks around current index
  const startIdx = Math.max(0, currentTickIndex - 30);
  const endIdx = Math.min(bufferedTicks.length, currentTickIndex + 30);
  const visibleTicks = bufferedTicks.slice(startIdx, endIdx);

  const displaySymbol = symbol || currentTick?.symbol || (bufferedTicks[0]?.symbol) || 'LIVE';

  return (
    <div className="time-and-sales-panel" style={{
      width: '280px',
      height: '100%',
      backgroundColor: '#131722',
      borderLeft: '1px solid #2a2e39',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 20,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '11px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        backgroundColor: '#1e222d',
        borderBottom: '1px solid #2a2e39',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Activity size={14} color="#2962ff" />
          <span style={{ fontWeight: 700, color: '#d1d4dc', letterSpacing: '0.05em' }}>TIME & SALES</span>
          <span style={{
            fontSize: '9px',
            backgroundColor: 'rgba(41, 98, 255, 0.2)',
            color: '#2962ff',
            padding: '2px 4px',
            borderRadius: '2px',
            fontWeight: 700,
          }}>{displaySymbol}</span>
        </div>
        <button 
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#787b86',
            cursor: 'pointer',
            padding: '2px',
          }}
          title="Close Tape"
        >
          <X size={14} />
        </button>
      </div>

      {/* Column Headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '70px 65px 45px 45px',
        padding: '6px 8px',
        backgroundColor: '#181b24',
        borderBottom: '1px solid #2a2e39',
        color: '#787b86',
        fontSize: '10px',
        fontWeight: 600,
      }}>
        <div>TIME</div>
        <div style={{ textAlign: 'right' }}>PRICE</div>
        <div style={{ textAlign: 'right' }}>SIZE</div>
        <div style={{ textAlign: 'right' }}>B/A</div>
      </div>

      {/* Tape Rows */}
      <div 
        ref={listRef} 
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          backgroundColor: '#131722',
        }}
      >
        {visibleTicks.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#787b86',
            fontSize: '11px',
          }}>
            No live ticks buffered.<br/>Load symbol ticks to start.
          </div>
        ) : (
          visibleTicks.map((tick, relIdx) => {
            const absIdx = startIdx + relIdx;
            const prevTick = absIdx > 0 ? bufferedTicks[absIdx - 1] : null;
            const isUptick = prevTick ? tick.price >= prevTick.price : true;
            const isActive = absIdx === currentTickIndex;

            const timeStr = tick.time.includes('T') 
              ? tick.time.split('T')[1].slice(0, 12) 
              : tick.time.split(' ')[1] || tick.time;

            return (
              <div 
                key={`${tick.time}-${absIdx}`}
                className={`tick-row ${isActive ? 'is-active' : ''}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '70px 65px 45px 45px',
                  padding: '3px 8px',
                  backgroundColor: isActive ? 'rgba(41, 98, 255, 0.25)' : 'transparent',
                  borderLeft: isActive ? '3px solid #2962ff' : '3px solid transparent',
                  color: isUptick ? '#26a69a' : '#ef5350',
                  lineHeight: '16px',
                  userSelect: 'none',
                }}
              >
                <div style={{ color: '#d1d4dc', fontSize: '10px' }}>{timeStr.slice(0, 8)}</div>
                <div style={{ textAlign: 'right', fontWeight: 600 }}>{tick.price.toFixed(2)}</div>
                <div style={{ textAlign: 'right', color: '#d1d4dc' }}>{Math.round(tick.volume || 1)}</div>
                <div style={{ textAlign: 'right', color: '#787b86', fontSize: '9px' }}>
                  {tick.bid ? tick.bid.toFixed(1) : '-'}/{tick.ask ? tick.ask.toFixed(1) : '-'}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Metrics */}
      <div style={{
        padding: '6px 10px',
        backgroundColor: '#181b24',
        borderTop: '1px solid #2a2e39',
        display: 'flex',
        justifyContent: 'space-between',
        color: '#787b86',
        fontSize: '10px',
      }}>
        <span>TICK: {bufferedTicks.length > 0 ? `${currentTickIndex + 1}/${bufferedTicks.length}` : '0/0'}</span>
        <span style={{ color: '#2962ff', fontWeight: 600 }}>
          {currentTick ? `$${currentTick.price.toFixed(2)}` : '--'}
        </span>
      </div>
    </div>
  );
}
