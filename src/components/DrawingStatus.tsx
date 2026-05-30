import React from 'react';
import type { DrawType, RectPoint } from '../types';

interface DrawingStatusProps {
  isDrawingMode: boolean;
  drawType: DrawType;
  rectAnchor: RectPoint | null;
}

export function DrawingStatus({ isDrawingMode, drawType, rectAnchor }: DrawingStatusProps) {
  if (!isDrawingMode) return null;

  return (
    <div style={{
      position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(255, 152, 0, 0.9)', color: '#000', padding: '2px 12px',
      borderRadius: '4px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.05em',
      pointerEvents: 'none', zIndex: 10, display: 'flex', gap: '15px'
    }}>
      <span>MODE: {drawType.toUpperCase()}</span>
      <span>{drawType === 'ray' ? 'Click to place ray' : (rectAnchor ? 'Click to finish rectangle' : 'Click to start rectangle')}</span>
      <span>Alt/Ctrl+J: Ray · Alt/Ctrl+Shift+R: Rect · ESC/DEL</span>
    </div>
  );
}
