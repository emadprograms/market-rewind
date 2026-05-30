import React from 'react';
import type { TradeType } from '../types';

interface TradeControlsProps {
  tradeSize: number;
  setTradeSize: (size: number) => void;
  placeOrder: (type: TradeType) => void;
}

export function TradeControls({ tradeSize, setTradeSize, placeOrder }: TradeControlsProps) {
  return (
    <div className="trade-controls" style={{
      position: 'absolute', top: '0px', left: '0px', zIndex: 20,
      display: 'flex', alignItems: 'center', gap: '5px',
      color: '#fff', fontFamily: 'Inter, system-ui, sans-serif',
      paddingTop: '10px', paddingLeft: '10px'
    }}>
      <button 
        onClick={() => placeOrder('long')}
        style={{ 
          background: '#26a69a', color: '#fff', border: 'none', borderRadius: '4px', 
          padding: '4px 12px', fontSize: '12px', fontWeight: '700', cursor: 'pointer',
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
        style={{ 
          background: '#ef5350', color: '#fff', border: 'none', borderRadius: '4px', 
          padding: '4px 12px', fontSize: '12px', fontWeight: '700', cursor: 'pointer',
          transition: 'filter 0.2s'
        }}
        onMouseOver={e => e.currentTarget.style.filter = 'brightness(1.2)'}
        onMouseOut={e => e.currentTarget.style.filter = 'brightness(1)'}
      >
        SELL
      </button>
    </div>
  );
}
