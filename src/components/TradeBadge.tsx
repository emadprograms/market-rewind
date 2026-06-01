import React from 'react';
import type { ActiveTrade } from '../types';

interface TradeBadgeProps {
  activeTrade: ActiveTrade;
  currentPrice: number;
  tradeBadgeRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export function TradeBadge({ activeTrade, currentPrice, tradeBadgeRef, onClose }: TradeBadgeProps) {
  const pnl = activeTrade.type === 'long' 
    ? (currentPrice - activeTrade.entryPrice) * activeTrade.size 
    : (activeTrade.entryPrice - currentPrice) * activeTrade.size;

  return (
    <div 
      ref={tradeBadgeRef}
      className="trade-badge" style={{
        position: 'absolute',
        transform: 'translateY(-50%)',
        right: '90px',
        zIndex: 20,
        background: 'rgba(30, 41, 59, 0.8)',
        border: `2px solid ${activeTrade.type === 'long' ? '#26a69a' : '#ef5350'}`,
        color: '#fff', padding: '4px 8px', borderRadius: '4px',
        fontSize: '11px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)'
      }}>
      <span style={{ 
        background: activeTrade.type === 'long' ? '#26a69a' : '#ef5350',
        color: '#fff', 
        padding: '2px 5px', 
        borderRadius: '3px',
        fontSize: '10px',
        fontWeight: '800',
        marginRight: '4px'
      }}>
        {activeTrade.size}
      </span>
      <span style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350' }}>
        ${pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
      </span>
      <button 
        onClick={onClose}
        style={{ 
          background: 'rgba(0,0,0,0.2)', border: 'none', color: '#fff', 
          borderRadius: '50%', width: '14px', height: '14px', 
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '9px', padding: 0
        }}
      >
        ✕
      </button>
    </div>
  );
}
