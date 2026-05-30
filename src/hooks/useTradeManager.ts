import { useState, useEffect, useRef, useCallback } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
import type { ActiveTrade, ChartBar, TradeType } from '../types';
import type { TradePlugin } from '../lib/TradePlugin';

interface UseTradeManagerParams {
  chartData: ChartBar[];
  chartContainerRef: React.RefObject<HTMLDivElement>;
  priceSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  tradePluginRef: React.MutableRefObject<TradePlugin | null>;
}

export function useTradeManager({
  chartData,
  chartContainerRef,
  priceSeriesRef,
  tradePluginRef,
}: UseTradeManagerParams) {
  const [activeTrade, setActiveTrade] = useState<ActiveTrade | null>(null);
  const [tradeSize, setTradeSize] = useState(1);
  const [dragTarget, setDragTarget] = useState<'sl' | 'tp' | null>(null);
  const tradeBadgeRef = useRef<HTMLDivElement>(null);

  const placeOrder = useCallback((type: TradeType) => {
    try {
      if (!chartData || chartData.length === 0) return;
      const lastBar = chartData[chartData.length - 1];
      const currentPrice = lastBar.close;
      const offset = currentPrice * 0.01;

      setActiveTrade(prevTrade => {
        if (!prevTrade) {
          return {
            type,
            entryPrice: currentPrice,
            slPrice: type === 'long' ? currentPrice - offset : currentPrice + offset,
            tpPrice: type === 'long' ? currentPrice + offset : currentPrice - offset,
            size: tradeSize,
            entryTime: lastBar.time,
          };
        }

        if (prevTrade.type === type) {
          const newSize = prevTrade.size + tradeSize;
          const newEntryPrice = ((prevTrade.entryPrice * prevTrade.size) + (currentPrice * tradeSize)) / newSize;
          
          return {
            ...prevTrade,
            entryPrice: newEntryPrice,
            slPrice: type === 'long' ? newEntryPrice - offset : newEntryPrice + offset,
            tpPrice: type === 'long' ? newEntryPrice + offset : newEntryPrice - offset,
            size: newSize,
          };
        } else {
          const netSize = prevTrade.size - tradeSize;

          if (netSize > 0) {
            return {
              ...prevTrade,
              size: netSize,
            };
          } else if (netSize === 0) {
            return null;
          } else {
            const flippedSize = Math.abs(netSize);
            const flippedType = type;
            
            return {
              type: flippedType,
              entryPrice: currentPrice,
              slPrice: flippedType === 'long' ? currentPrice - offset : currentPrice + offset,
              tpPrice: flippedType === 'long' ? currentPrice + offset : currentPrice - offset,
              size: flippedSize,
              entryTime: lastBar.time,
            };
          }
        }
      });
    } catch(err) {
      console.error('placeOrder error:', err);
    }
  }, [chartData, tradeSize]);

  useEffect(() => {
    if (tradePluginRef.current) {
      tradePluginRef.current.setTrade(activeTrade);
    }
  }, [activeTrade, tradePluginRef]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !priceSeriesRef.current) return;

    const series = priceSeriesRef.current;

    const handleMouseDown = (e: MouseEvent) => {
      try {
        if (!activeTrade) return;

        const rect = container.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;

        const ySL = series.priceToCoordinate(activeTrade.slPrice);
        const yTP = series.priceToCoordinate(activeTrade.tpPrice);

        if (ySL !== null && Math.abs(mouseY - ySL) < 10) {
          setDragTarget('sl');
        } else if (yTP !== null && Math.abs(mouseY - yTP) < 10) {
          setDragTarget('tp');
        }
      } catch (err) {
        console.error('handleMouseDown error:', err);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      try {
        if (!dragTarget) return;

        const rect = container.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        const newPrice = series.coordinateToPrice(mouseY);

        if (newPrice !== null) {
          setActiveTrade(prev => {
            if (!prev) return null;
            return {
              ...prev,
              [dragTarget === 'sl' ? 'slPrice' : 'tpPrice']: newPrice
            };
          });
        }
      } catch (err) {
        console.error('handleMouseMove error:', err);
      }
    };

    const handleMouseUp = () => {
      setDragTarget(null);
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeTrade, dragTarget, chartContainerRef, priceSeriesRef]);

  return {
    activeTrade,
    setActiveTrade,
    tradeSize,
    setTradeSize,
    tradeBadgeRef,
    placeOrder,
  };
}
