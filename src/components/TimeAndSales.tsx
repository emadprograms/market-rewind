import React, { useRef, useEffect, useMemo } from 'react';
import { usePlaybackStore, isoToMs } from '../store/usePlaybackStore';
import { getTzForTicker } from '../lib/timezones';
import type { MarketTick } from '../types';
import { X, Activity } from 'lucide-react';

/**
 * Positions within `bufferedTicks` belonging to the displayed symbol, in order.
 *
 * Built once per (buffer, symbol) rather than once per frame. The previous
 * implementation re-derived both the visible window and the executed count by copying
 * and filtering the entire buffer on every render; driven at 60fps by the playback
 * clock over a 100k-tick buffer that was ~200,000 element visits per frame (~58% of a
 * frame budget, measured) to display 80 rows.
 */
interface TapeIndex {
  positions: number[];
}

function buildTapeIndex(ticks: MarketTick[], symbol: string): TapeIndex {
  const positions: number[] = [];
  if (!symbol || symbol === 'LIVE') {
    for (let i = 0; i < ticks.length; i++) positions.push(i);
    return { positions };
  }
  const target = symbol.toUpperCase();
  for (let i = 0; i < ticks.length; i++) {
    const tickSymbol = ticks[i].symbol;
    if (!tickSymbol || tickSymbol.toUpperCase() === target) positions.push(i);
  }
  return { positions };
}

/** Count of entries in a sorted ascending array that are <= value. O(log n). */
function upperBound(values: number[], value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface TimeAndSalesProps {
  isOpen: boolean;
  onClose: () => void;
  symbol?: string;
}

export function TimeAndSales({ isOpen, onClose, symbol }: TimeAndSalesProps) {
  const bufferedTicks = usePlaybackStore((state) => state.bufferedTicks);
  const currentTickIndex = usePlaybackStore((state) => state.currentTickIndex);
  const currentTick = usePlaybackStore((state) => state.currentTick);
  const latestTickBySymbol = usePlaybackStore((state) => state.latestTickBySymbol);

  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the list to bottom to follow live tape executions without jitter
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [currentTickIndex]);

  const displaySymbol = symbol || currentTick?.symbol || (bufferedTicks[0]?.symbol) || 'LIVE';

  // Executed trades up to currentTickIndex strictly matching displaySymbol (RENDER-04).
  // The index is rebuilt only when the buffer or symbol changes; per frame this is a
  // binary search plus a bounded slice, so cost no longer scales with buffer size.
  const tapeIndex = useMemo(
    () => buildTapeIndex(bufferedTicks, displaySymbol || ''),
    [bufferedTicks, displaySymbol],
  );

  const maxDisplay = 80;
  const executedCount = currentTickIndex >= 0
    ? upperBound(tapeIndex.positions, currentTickIndex)
    : 0;
  const totalSymbolTicks = tapeIndex.positions.length;

  const visibleTicks = useMemo(() => {
    const from = Math.max(0, executedCount - maxDisplay);
    const out: MarketTick[] = [];
    for (let i = from; i < executedCount; i++) {
      out.push(bufferedTicks[tapeIndex.positions[i]]);
    }
    return out;
  }, [tapeIndex, bufferedTicks, executedCount]);

  // Every hook must run before this early return: returning earlier would change the
  // hook count when the panel is toggled ("Rendered more hooks than during the previous
  // render"). Non-hook derivations stay below it so a closed panel still does no work.
  if (!isOpen) return null;

  const tz = getTzForTicker(displaySymbol);
  const latestSymbolTick = displaySymbol && displaySymbol !== 'LIVE'
    ? latestTickBySymbol?.[displaySymbol.toUpperCase()] ||
      (currentTick?.symbol?.toUpperCase() === displaySymbol.toUpperCase() ? currentTick : null)
    : currentTick;

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
        <span>TICK: {totalSymbolTicks > 0 ? `${executedCount}/${totalSymbolTicks}` : '0/0'}</span>
        <span style={{ color: '#2962ff', fontWeight: 600 }}>
          {latestSymbolTick ? `$${latestSymbolTick.price.toFixed(2)}` : '--'}
        </span>
      </div>
    </div>
  );
}
