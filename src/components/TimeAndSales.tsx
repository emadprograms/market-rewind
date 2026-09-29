import React, { useRef, useEffect } from 'react';
import { usePlaybackStore, isoToMs } from '../store/usePlaybackStore';
import { getTzForTicker } from '../lib/timezones';
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

  // Auto-scroll the list to bottom to follow live tape executions without jitter
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [currentTickIndex]);

  if (!isOpen) return null;

  const displaySymbol = symbol || currentTick?.symbol || (bufferedTicks[0]?.symbol) || 'LIVE';
  const tz = getTzForTicker(displaySymbol);
  const latestSymbolTick = displaySymbol && displaySymbol !== 'LIVE'
    ? usePlaybackStore((state) => state.latestTickBySymbol?.[displaySymbol.toUpperCase()]) ||
      (currentTick?.symbol?.toUpperCase() === displaySymbol.toUpperCase() ? currentTick : null)
    : currentTick;

  // Filter executed trades up to currentTickIndex strictly matching displaySymbol (RENDER-04)
  const maxDisplay = 80;
  const executedTicks = currentTickIndex >= 0 ? bufferedTicks.slice(0, currentTickIndex + 1) : [];
  const symbolExecutedTicks = displaySymbol && displaySymbol !== 'LIVE'
    ? executedTicks.filter((t) => !t.symbol || t.symbol.toUpperCase() === displaySymbol.toUpperCase())
    : executedTicks;
  const visibleTicks = symbolExecutedTicks.slice(-maxDisplay);

  const totalSymbolTicks = displaySymbol && displaySymbol !== 'LIVE'
    ? bufferedTicks.filter((t) => !t.symbol || t.symbol.toUpperCase() === displaySymbol.toUpperCase()).length
    : bufferedTicks.length;

  const formatTapeTime = (isoTime: string) => {
    const ms = isoToMs(isoTime);
    if (!ms) return '--:--:--';
    const date = new Date(ms);
    const timeStr = date.toLocaleTimeString('en-US', {
      timeZone: tz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const millis = String(date.getMilliseconds()).padStart(3, '0');
    return `${timeStr}.${millis}`;
  };

  return (
    <div className="time-and-sales-panel" data-testid="time-and-sales" style={{
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
        gridTemplateColumns: '85px 60px 42px 45px',
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
            No live ticks executed yet.<br/>Start replay to stream tape.
          </div>
        ) : (
          visibleTicks.map((tick, relIdx) => {
            const prevTick = relIdx > 0 ? visibleTicks[relIdx - 1] : null;
            const isUptick = prevTick ? tick.price >= prevTick.price : true;
            const isActive = relIdx === visibleTicks.length - 1;

            return (
              <div 
                key={`${tick.time}-${relIdx}`}
                data-testid="tape-row"
                className={`tick-row ${isActive ? 'is-active' : ''}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '85px 60px 42px 45px',
                  padding: '3px 8px',
                  backgroundColor: isActive ? 'rgba(41, 98, 255, 0.25)' : 'transparent',
                  borderLeft: isActive ? '3px solid #2962ff' : '3px solid transparent',
                  color: isUptick ? '#26a69a' : '#ef5350',
                  lineHeight: '16px',
                  userSelect: 'none',
                }}
              >
                <div style={{ color: '#d1d4dc', fontSize: '9.5px' }}>{formatTapeTime(tick.time)}</div>
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
        <span>TICK: {totalSymbolTicks > 0 ? `${symbolExecutedTicks.length}/${totalSymbolTicks}` : '0/0'}</span>
        <span style={{ color: '#2962ff', fontWeight: 600 }}>
          {latestSymbolTick ? `$${latestSymbolTick.price.toFixed(2)}` : '--'}
        </span>
      </div>
    </div>
  );
}
