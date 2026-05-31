import { useState, useCallback } from 'react';
import type { AllDrawings } from '../types';

export function useDrawings() {
  const [drawings, setDrawings] = useState<AllDrawings>({});

  const handleUpdateDrawings = useCallback((ticker: string, type: 'rays' | 'rects', items: any[]) => {
    setDrawings(prev => {
      const currentTickerDrawings = prev[ticker] || { rays: [], rects: [] };
      
      // Basic shallow comparison to avoid unnecessary state updates
      if (currentTickerDrawings[type] === items) return prev;
      
      return {
        ...prev,
        [ticker]: {
          ...currentTickerDrawings,
          [type]: items
        }
      };
    });
  }, []);

  return {
    drawings,
    handleUpdateDrawings
  };
}
