import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
import type { ActiveTrade, ChartBar, TradeType, MarketTick } from '../types';
import type { TradePlugin } from '../lib/TradePlugin';
import { usePlaybackStore } from '../store/usePlaybackStore';

export function getAskPrice(tick: MarketTick | null | undefined, fallbackPrice: number): number {
  if (tick && tick.ask != null && Number(tick.ask) > 0) {
    return Number(tick.ask);
  }
  if (tick && tick.price != null && Number(tick.price) > 0) {
    return Number((Number(tick.price) + 0.01).toFixed(2));
  }
  return fallbackPrice;
}

export function getBidPrice(tick: MarketTick | null | undefined, fallbackPrice: number): number {
  if (tick && tick.bid != null && Number(tick.bid) > 0) {
    return Number(tick.bid);
  }
  if (tick && tick.price != null && Number(tick.price) > 0) {
    return Number((Number(tick.price) - 0.01).toFixed(2));
  }
  return fallbackPrice;
}

interface UseTradeManagerParams {
  chartData: ChartBar[];
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  priceSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  tradePluginRef: React.MutableRefObject<TradePlugin | null>;
  ticker?: string;
}

export function useTradeManager({
  chartData,
  chartContainerRef,
  priceSeriesRef,
  tradePluginRef,
  ticker,
}: UseTradeManagerParams) {
  const [activeTrade, setActiveTrade] = useState<ActiveTrade | null>(null);
  const [realizedPnL, setRealizedPnL] = useState(0);
  const [tradeSize, setTradeSize] = useState(1);
  const [dragTarget, setDragTarget] = useState<'sl' | 'tp' | null>(null);
  const tradeBadgeRef = useRef<HTMLDivElement>(null);

  const currentTick = usePlaybackStore((state) => {
    if (ticker) {
      const sym = ticker.toUpperCase();
      return (
        state.latestTickBySymbol?.[sym] ||
        (state.currentTick?.symbol?.toUpperCase() === sym ? state.currentTick : null) ||
        state.currentTick
      );
    }
    return state.currentTick;
  });

  const getActiveTick = useCallback((): MarketTick | null => {
    const state = usePlaybackStore.getState();
    if (ticker) {
      const sym = ticker.toUpperCase();
      return (
        state.latestTickBySymbol?.[sym] ||
        (state.currentTick?.symbol?.toUpperCase() === sym ? state.currentTick : null) ||
        state.currentTick
      );
    }
    return state.currentTick;
  }, [ticker]);

  // Calculate Unrealized PnL based on current Bid for long and Ask for short
  const unrealizedPnL = React.useMemo(() => {
    if (!activeTrade || !chartData || chartData.length === 0) return 0;
    const fallbackPrice = chartData[chartData.length - 1].close;
    const askPrice = getAskPrice(currentTick, fallbackPrice);
    const bidPrice = getBidPrice(currentTick, fallbackPrice);

    const pnlPerUnit = activeTrade.type === 'long' 
      ? bidPrice - activeTrade.entryPrice 
      : activeTrade.entryPrice - askPrice;
    return pnlPerUnit * activeTrade.size;
  }, [activeTrade, chartData, currentTick]);

  const placeOrder = useCallback((type: TradeType) => {
    try {
      if (!chartData || chartData.length === 0) return;
      const lastBar = chartData[chartData.length - 1];
      const fallbackPrice = lastBar.close;
      const activeTick = getActiveTick();

      const askPrice = getAskPrice(activeTick, fallbackPrice);
      const bidPrice = getBidPrice(activeTick, fallbackPrice);
      const executionPrice = type === 'long' ? askPrice : bidPrice;
      const offset = executionPrice * 0.01;

      setActiveTrade(prevTrade => {
        if (!prevTrade) {
          return {
            type,
            entryPrice: executionPrice,
            slPrice: type === 'long' ? executionPrice - offset : executionPrice + offset,
            tpPrice: type === 'long' ? executionPrice + offset : executionPrice - offset,
            size: tradeSize,
            entryTime: lastBar.time,
          };
        }

        if (prevTrade.type === type) {
          const newSize = prevTrade.size + tradeSize;
          const newEntryPrice = ((prevTrade.entryPrice * prevTrade.size) + (executionPrice * tradeSize)) / newSize;
          const newOffset = newEntryPrice * 0.01;
          
          return {
            ...prevTrade,
            entryPrice: newEntryPrice,
            slPrice: type === 'long' ? newEntryPrice - newOffset : newEntryPrice + newOffset,
            tpPrice: type === 'long' ? newEntryPrice + newOffset : newEntryPrice - newOffset,
            size: newSize,
          };
        } else {
          // Calculate PnL for the amount being closed
          // Closing a long means selling at Bid price (executionPrice for short order)
          // Closing a short means buying back at Ask price (executionPrice for long order)
          const closedSize = Math.min(prevTrade.size, tradeSize);
          const pnlPerUnit = prevTrade.type === 'long' 
            ? executionPrice - prevTrade.entryPrice 
            : prevTrade.entryPrice - executionPrice;
          const closedPnL = pnlPerUnit * closedSize;
          
          setRealizedPnL(prev => prev + closedPnL);

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
            const flippedOffset = executionPrice * 0.01;
            
            return {
              type: flippedType,
              entryPrice: executionPrice,
              slPrice: flippedType === 'long' ? executionPrice - flippedOffset : executionPrice + flippedOffset,
              tpPrice: flippedType === 'long' ? executionPrice + flippedOffset : executionPrice - flippedOffset,
              size: flippedSize,
              entryTime: lastBar.time,
            };
          }
        }
      });
    } catch(err) {
      console.error('placeOrder error:', err);
    }
  }, [chartData, tradeSize, getActiveTick]);

  const closeTrade = useCallback(() => {
    setActiveTrade(prevTrade => {
      if (!prevTrade) return null;
      const activeTick = getActiveTick();
      const fallbackPrice = chartData && chartData.length > 0 ? chartData[chartData.length - 1].close : prevTrade.entryPrice;
      const askPrice = getAskPrice(activeTick, fallbackPrice);
      const bidPrice = getBidPrice(activeTick, fallbackPrice);

      const exitPrice = prevTrade.type === 'long' ? bidPrice : askPrice;
      const pnlPerUnit = prevTrade.type === 'long'
        ? exitPrice - prevTrade.entryPrice
        : prevTrade.entryPrice - exitPrice;
      const closedPnL = pnlPerUnit * prevTrade.size;

      setRealizedPnL(prev => prev + closedPnL);
      return null;
    });
  }, [chartData, getActiveTick]);

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
    closeTrade,
    realizedPnL,
    unrealizedPnL,
  };
}
