import React from 'react';
import type { TradeType } from '../types';

interface TradeControlsProps {
  tradeSize: number;
  setTradeSize: (size: number) => void;
  placeOrder: (type: TradeType) => void;
  /** The charted instrument. Named in the refusal so the user knows what was declined. */
  symbol?: string;
  /** False when the simulated account has no rules for this instrument. */
  isTradeable?: boolean;
}

export function TradeControls({
  tradeSize,
  setTradeSize,
  placeOrder,
  symbol,
  isTradeable = true,
}: TradeControlsProps) {
  const disabled = !isTradeable;
  return (
    <div className="trade-controls" style={{
      position: 'absolute', top: '0px', left: '0px', zIndex: 20,
      display: 'flex', alignItems: 'center', gap: '5px',
      color: '#fff', fontFamily: 'Inter, system-ui, sans-serif',
      paddingTop: '10px', paddingLeft: '10px'
    }}>
      <button 
        onClick={() => placeOrder('long')}
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? `The simulated account does not trade ${symbol ?? 'this instrument'}.` : undefined}
        style={{ 
          background: disabled ? '#334155' : '#26a69a', color: disabled ? '#94a3b8' : '#fff',
          border: 'none', borderRadius: '4px', 
          padding: '4px 12px', fontSize: '12px', fontWeight: '700',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'filter 0.2s'
        }}
        onMouseOver={e => e.currentTarget.style.filter = 'brightness(1.2)'}
        onMouseOut={e => e.currentTarget.style.filter = 'brightness(1)'}
      >
        BUY
      </button>
      
      <input 
        type="number" 
        value={tradeSize} 
        onChange={(e) => setTradeSize(Number(e.target.value))}
        style={{ 
          width: '50px', background: '#0f172a', border: '1px solid #334155', 
          color: '#fff', borderRadius: '4px', padding: '2px 4px', fontSize: '12px', textAlign: 'center'
        }} 
      />
      
      <button 
        onClick={() => placeOrder('short')}
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? `The simulated account does not trade ${symbol ?? 'this instrument'}.` : undefined}
        style={{ 
          background: disabled ? '#334155' : '#ef5350', color: disabled ? '#94a3b8' : '#fff',
          border: 'none', borderRadius: '4px', 
          padding: '4px 12px', fontSize: '12px', fontWeight: '700',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'filter 0.2s'
        }}
        onMouseOver={e => e.currentTarget.style.filter = 'brightness(1.2)'}
        onMouseOut={e => e.currentTarget.style.filter = 'brightness(1)'}
      >
        SELL
      </button>

      {disabled && (
        <span
          data-testid="trade-controls-untradeable"
          role="note"
          style={{ fontSize: '11px', color: '#fcd34d', background: '#1f2937',
                   border: '1px solid #4b5563', borderRadius: '4px', padding: '2px 6px' }}
        >
          Not traded here — the simulated account has rules for BTCUSD only.
        </span>
      )}
    </div>
  );
}
