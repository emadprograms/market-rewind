import { useState, useCallback, useMemo } from 'react';

export function usePortfolio() {
  const [globalPnL, setGlobalPnL] = useState<Record<number, { r: number; u: number }>>({});

  const { totalRealized, totalUnrealized } = useMemo(() => {
    return Object.values(globalPnL).reduce(
      (acc, curr) => {
        acc.totalRealized += curr.r;
        acc.totalUnrealized += curr.u;
        return acc;
      },
      { totalRealized: 0, totalUnrealized: 0 }
    );
  }, [globalPnL]);

  const handlePnLUpdate = useCallback((id: number, r: number, u: number) => {
    setGlobalPnL(prev => {
      // Avoid unnecessary state updates if values are identical
      if (prev[id] && prev[id].r === r && prev[id].u === u) return prev;
      return {
        ...prev,
        [id]: { r, u }
      };
    });
  }, []);

  return {
    globalPnL,
    totalRealized,
    totalUnrealized,
    handlePnLUpdate
  };
}
