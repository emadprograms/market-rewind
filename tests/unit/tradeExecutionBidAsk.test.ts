import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTradeManager, getAskPrice, getBidPrice } from '../../src/hooks/useTradeManager';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import type { ChartBar, MarketTick } from '../../src/types';

describe('Trade Execution Bid/Ask Logic (useTradeManager)', () => {
  const mockChartData: ChartBar[] = [
    { time: '2026-09-25 14:30:00', open: 100, high: 105, low: 95, close: 100, volume: 1000, session: 'REG' },
  ];

  const createMockRefs = (overrides?: Partial<Parameters<typeof useTradeManager>[0]>) => ({
    chartData: mockChartData,
    chartContainerRef: { current: document.createElement('div') } as any,
    priceSeriesRef: { current: null } as any,
    tradePluginRef: { current: { setTrade: vi.fn() } } as any,
    ...overrides,
  });

  beforeEach(() => {
    usePlaybackStore.getState().reset();
  });

  describe('Helper Price Resolvers: getAskPrice & getBidPrice', () => {
    it('uses tick.ask and tick.bid when explicitly provided and > 0', () => {
      const tick: MarketTick = {
        time: '2026-09-25 14:30:00',
        symbol: 'AAPL',
        price: 150.10,
        volume: 100,
        ask: 150.25,
        bid: 150.05,
      };

      expect(getAskPrice(tick, 100)).toBe(150.25);
      expect(getBidPrice(tick, 100)).toBe(150.05);
    });

    it('synthesizes ask/bid with +/-0.01 offset when ask/bid are missing but price exists', () => {
      const tick: MarketTick = {
        time: '2026-09-25 14:30:00',
        symbol: 'AAPL',
        price: 150.10,
        volume: 100,
        ask: null,
        bid: null,
      };

      expect(getAskPrice(tick, 100)).toBe(150.11);
      expect(getBidPrice(tick, 100)).toBe(150.09);
    });

    it('falls back to fallbackPrice when tick is null or has no valid prices', () => {
      expect(getAskPrice(null, 100)).toBe(100);
      expect(getBidPrice(null, 100)).toBe(100);

      const invalidTick = { time: '2026-09-25 14:30:00', symbol: 'AAPL', price: 0, volume: 10 } as MarketTick;
      expect(getAskPrice(invalidTick, 100)).toBe(100);
      expect(getBidPrice(invalidTick, 100)).toBe(100);
    });
  });

  describe('BUY order execution at Ask price', () => {
    it('executes BUY order at tick.ask when ask is available', () => {
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.10,
          volume: 50,
          ask: 100.25,
          bid: 100.05,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.placeOrder('long');
      });

      expect(result.current.activeTrade).not.toBeNull();
      expect(result.current.activeTrade?.type).toBe('long');
      expect(result.current.activeTrade?.entryPrice).toBe(100.25);
    });

    it('executes BUY order at tick.price + 0.01 when ask is missing', () => {
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.10,
          volume: 50,
          ask: null,
          bid: null,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.placeOrder('long');
      });

      expect(result.current.activeTrade?.entryPrice).toBe(100.11);
    });

    it('uses latestTickBySymbol[ticker] when ticker is passed', () => {
      usePlaybackStore.setState({
        latestTickBySymbol: {
          AAPL: {
            time: '2026-09-25 14:30:00',
            symbol: 'AAPL',
            price: 200.0,
            volume: 10,
            ask: 200.5,
            bid: 199.5,
          },
          TSLA: {
            time: '2026-09-25 14:30:00',
            symbol: 'TSLA',
            price: 300.0,
            volume: 10,
            ask: 300.8,
            bid: 299.2,
          },
        },
      });

      const { result } = renderHook(() =>
        useTradeManager(createMockRefs({ ticker: 'TSLA' }))
      );

      act(() => {
        result.current.placeOrder('long');
      });

      expect(result.current.activeTrade?.entryPrice).toBe(300.8);
    });
  });

  describe('SELL order execution at Bid price', () => {
    it('executes SELL order at tick.bid when bid is available', () => {
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.10,
          volume: 50,
          ask: 100.25,
          bid: 100.05,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.placeOrder('short');
      });

      expect(result.current.activeTrade).not.toBeNull();
      expect(result.current.activeTrade?.type).toBe('short');
      expect(result.current.activeTrade?.entryPrice).toBe(100.05);
    });

    it('executes SELL order at tick.price - 0.01 when bid is missing', () => {
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.10,
          volume: 50,
          ask: null,
          bid: null,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.placeOrder('short');
      });

      expect(result.current.activeTrade?.entryPrice).toBe(100.09);
    });
  });

  describe('Closing Long calculates PnL at Bid price', () => {
    it('calculates realized PnL at Bid price when selling to close a long position', () => {
      // 1. Buy 2 shares at Ask 100.20
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.10,
          volume: 50,
          ask: 100.20,
          bid: 100.00,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.setTradeSize(2);
      });
      act(() => {
        result.current.placeOrder('long');
      });
      expect(result.current.activeTrade?.entryPrice).toBe(100.20);
      expect(result.current.activeTrade?.size).toBe(2);

      // 2. Price moves up: Bid is 105.50, Ask is 105.70
      act(() => {
        usePlaybackStore.setState({
          currentTick: {
            time: '2026-09-25 14:35:00',
            symbol: 'AAPL',
            price: 105.60,
            volume: 50,
            ask: 105.70,
            bid: 105.50,
          },
        });
      });

      // 3. User places SELL order (size 2) to close
      act(() => {
        result.current.placeOrder('short');
      });

      // PnL per unit = Bid (105.50) - Entry (100.20) = 5.30
      // Total PnL for 2 units = 5.30 * 2 = 10.60
      expect(result.current.realizedPnL).toBeCloseTo(10.60, 4);
      expect(result.current.activeTrade).toBeNull();
    });

    it('calculates realized PnL at Bid price when using closeTrade()', () => {
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.00,
          volume: 10,
          ask: 100.00,
          bid: 99.80,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.placeOrder('long');
      });

      // Market updates
      act(() => {
        usePlaybackStore.setState({
          currentTick: {
            time: '2026-09-25 14:31:00',
            symbol: 'AAPL',
            price: 104.50,
            volume: 10,
            ask: 104.80,
            bid: 104.20,
          },
        });
      });

      act(() => {
        result.current.closeTrade();
      });

      // Sold at Bid: 104.20 - 100.00 = 4.20
      expect(result.current.realizedPnL).toBeCloseTo(4.20, 4);
      expect(result.current.activeTrade).toBeNull();
    });
  });

  describe('Closing Short calculates PnL at Ask price', () => {
    it('calculates realized PnL at Ask price when buying to cover a short position', () => {
      // 1. Sell short 2 shares at Bid 100.00
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.10,
          volume: 50,
          ask: 100.20,
          bid: 100.00,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.setTradeSize(2);
      });
      act(() => {
        result.current.placeOrder('short');
      });
      expect(result.current.activeTrade?.entryPrice).toBe(100.00);
      expect(result.current.activeTrade?.size).toBe(2);

      // 2. Price moves down: Bid is 94.80, Ask is 95.00
      act(() => {
        usePlaybackStore.setState({
          currentTick: {
            time: '2026-09-25 14:35:00',
            symbol: 'AAPL',
            price: 94.90,
            volume: 50,
            ask: 95.00,
            bid: 94.80,
          },
        });
      });

      // 3. User places BUY order (size 2) to cover
      act(() => {
        result.current.placeOrder('long');
      });

      // Short PnL per unit = Entry (100.00) - Ask (95.00) = 5.00
      // Total PnL for 2 units = 5.00 * 2 = 10.00
      expect(result.current.realizedPnL).toBeCloseTo(10.00, 4);
      expect(result.current.activeTrade).toBeNull();
    });

    it('calculates realized PnL at Ask price when using closeTrade()', () => {
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.00,
          volume: 10,
          ask: 100.20,
          bid: 100.00,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.placeOrder('short');
      });

      // Market updates
      act(() => {
        usePlaybackStore.setState({
          currentTick: {
            time: '2026-09-25 14:31:00',
            symbol: 'AAPL',
            price: 93.00,
            volume: 10,
            ask: 93.20,
            bid: 92.80,
          },
        });
      });

      act(() => {
        result.current.closeTrade();
      });

      // Covered at Ask: 100.00 - 93.20 = 6.80
      expect(result.current.realizedPnL).toBeCloseTo(6.80, 4);
      expect(result.current.activeTrade).toBeNull();
    });
  });

  describe('Unrealized PnL evaluates Long vs Bid and Short vs Ask', () => {
    it('evaluates long position against current Bid price', () => {
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.10,
          volume: 50,
          ask: 100.00,
          bid: 99.80,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.setTradeSize(3);
      });
      act(() => {
        result.current.placeOrder('long');
      });
      expect(result.current.activeTrade?.entryPrice).toBe(100.00);

      // Now Bid is 105.00, Ask is 106.00
      act(() => {
        usePlaybackStore.setState({
          currentTick: {
            time: '2026-09-25 14:35:00',
            symbol: 'AAPL',
            price: 105.50,
            volume: 50,
            ask: 106.00,
            bid: 105.00,
          },
        });
      });

      // Long unrealized PnL = (Bid - Entry) * size = (105.00 - 100.00) * 3 = 15.00
      expect(result.current.unrealizedPnL).toBeCloseTo(15.00, 4);
    });

    it('evaluates short position against current Ask price', () => {
      usePlaybackStore.setState({
        currentTick: {
          time: '2026-09-25 14:30:00',
          symbol: 'AAPL',
          price: 100.10,
          volume: 50,
          ask: 100.20,
          bid: 100.00,
        },
      });

      const { result } = renderHook(() => useTradeManager(createMockRefs()));

      act(() => {
        result.current.setTradeSize(3);
      });
      act(() => {
        result.current.placeOrder('short');
      });
      expect(result.current.activeTrade?.entryPrice).toBe(100.00);

      // Now Bid is 94.00, Ask is 95.00
      act(() => {
        usePlaybackStore.setState({
          currentTick: {
            time: '2026-09-25 14:35:00',
            symbol: 'AAPL',
            price: 94.50,
            volume: 50,
            ask: 95.00,
            bid: 94.00,
          },
        });
      });

      // Short unrealized PnL = (Entry - Ask) * size = (100.00 - 95.00) * 3 = 15.00
      expect(result.current.unrealizedPnL).toBeCloseTo(15.00, 4);
    });
  });
});
