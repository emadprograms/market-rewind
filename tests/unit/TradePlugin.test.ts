import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradePlugin, ChartMarker } from '../../src/lib/TradePlugin';
import type { ActiveTrade } from '../../src/types';

describe('TradePlugin Unit Tests', () => {
  let plugin: TradePlugin;
  let mockChart: any;
  let mockSeries: any;
  let requestUpdateMock: any;

  beforeEach(() => {
    plugin = new TradePlugin();
    requestUpdateMock = vi.fn();

    mockChart = {
      timeScale: vi.fn().mockReturnValue({
        timeToCoordinate: vi.fn((time: number) => (time === 1600000000 ? 500 : 600)),
        getVisibleLogicalRange: vi.fn().mockReturnValue({ from: 0, to: 100 }),
        width: vi.fn().mockReturnValue(1000),
      }),
      applyOptions: vi.fn(),
    };

    mockSeries = {
      priceToCoordinate: vi.fn((price: number) => 1000 - price * 5),
      coordinateToPrice: vi.fn((y: number) => (1000 - y) / 5),
      priceFormatter: vi.fn().mockReturnValue({
        format: vi.fn((p: number) => `$${p.toFixed(2)}`),
      }),
    };

    plugin.attached({
      chart: mockChart,
      series: mockSeries,
      requestUpdate: requestUpdateMock,
    } as any);
  });

  describe('Lifecycle & Attachment', () => {
    it('initializes with default empty state', () => {
      const freshPlugin = new TradePlugin();
      expect(freshPlugin._chart).toBeNull();
      expect(freshPlugin._series).toBeNull();
      expect(freshPlugin._items).toEqual([]);
      expect(freshPlugin._hoveredId).toBeNull();
      expect(freshPlugin._hoveredExecutions).toEqual([]);
      expect(freshPlugin.paneViews()).toHaveLength(1);
      expect(freshPlugin.priceAxisViews()).toEqual([]);
    });

    it('attaches chart, series, and update callback', () => {
      expect(plugin._chart).toBe(mockChart);
      expect(plugin._series).toBe(mockSeries);
      expect(plugin._requestUpdate).toBe(requestUpdateMock);
    });

    it('clears chart and series references on detached()', () => {
      plugin.detached();
      expect(plugin._chart).toBeNull();
      expect(plugin._series).toBeNull();
    });

    it('triggers update callback when updateAllViews() is called', () => {
      plugin.updateAllViews();
      expect(requestUpdateMock).toHaveBeenCalled();
    });
  });

  describe('setItems and setTrade', () => {
    it('updates items and calls requestUpdate', () => {
      const markers: ChartMarker[] = [
        {
          id: 'pos_1',
          epic: 'AAPL',
          price: 150,
          direction: 'BUY',
          size: 10,
          type: 'POSITION',
        },
      ];

      plugin.setItems(markers);
      expect(plugin._items).toEqual(markers);
      expect(requestUpdateMock).toHaveBeenCalled();
    });

    it('handles setTrade(null) by clearing items', () => {
      plugin.setItems([
        {
          id: 'temp',
          epic: 'AAPL',
          price: 100,
          direction: 'BUY',
          size: 1,
          type: 'POSITION',
        },
      ]);
      plugin.setTrade(null);
      expect(plugin._items).toEqual([]);
    });

    it('converts active long trade into POSITION marker with SL and TP orders', () => {
      const trade: ActiveTrade = {
        type: 'long',
        entryPrice: 150,
        slPrice: 140,
        tpPrice: 170,
        size: 5,
        entryTime: 1600000000,
      };

      plugin.setTrade(trade);

      expect(plugin._items).toHaveLength(3);

      const pos = plugin._items.find((i) => i.type === 'POSITION')!;
      expect(pos).toBeDefined();
      expect(pos.id).toBe('active_trade');
      expect(pos.direction).toBe('BUY');
      expect(pos.price).toBe(150);
      expect(pos.size).toBe(5);
      expect(pos.hasSL).toBe(true);
      expect(pos.hasTP).toBe(true);

      const sl = plugin._items.find((i) => i.id === 'active_trade_SL')!;
      expect(sl).toBeDefined();
      expect(sl.type).toBe('ORDER');
      expect(sl.direction).toBe('SELL');
      expect(sl.price).toBe(140);
      expect(sl.label).toBe('SL');
      expect(sl.isDashed).toBe(true);
      expect(sl.parentPrice).toBe(150);

      const tp = plugin._items.find((i) => i.id === 'active_trade_TP')!;
      expect(tp).toBeDefined();
      expect(tp.type).toBe('ORDER');
      expect(tp.direction).toBe('SELL');
      expect(tp.price).toBe(170);
      expect(tp.label).toBe('TP');
      expect(tp.isDashed).toBe(true);
      expect(tp.parentPrice).toBe(150);
    });

    it('converts active short trade into POSITION marker with opposite order directions', () => {
      const trade: ActiveTrade = {
        type: 'short',
        entryPrice: 200,
        slPrice: 210,
        tpPrice: 180,
        size: 2,
      };

      plugin.setTrade(trade);

      const pos = plugin._items.find((i) => i.type === 'POSITION')!;
      expect(pos.direction).toBe('SELL');

      const sl = plugin._items.find((i) => i.id === 'active_trade_SL')!;
      expect(sl.direction).toBe('BUY');
      expect(sl.price).toBe(210);

      const tp = plugin._items.find((i) => i.id === 'active_trade_TP')!;
      expect(tp.direction).toBe('BUY');
      expect(tp.price).toBe(180);
    });
  });

  describe('Badge Registration & DOM synchronization', () => {
    it('registers badge ref and links to marker ID', () => {
      const mockRef = { current: document.createElement('div') };
      plugin.registerBadgeRef('active_trade', mockRef);
      expect(plugin._badgeRefs.get('active_trade')).toBe(mockRef);
      expect(requestUpdateMock).toHaveBeenCalled();
    });

    it('setBadgeRef registers for active_trade', () => {
      const mockRef = { current: document.createElement('div') };
      plugin.setBadgeRef(mockRef);
      expect(plugin._badgeRefs.get('active_trade')).toBe(mockRef);
    });

    it('synchronizes badge position style in _getViewData', () => {
      const badgeEl = document.createElement('div');
      const badgeRef = { current: badgeEl };
      plugin.registerBadgeRef('pos_1', badgeRef);

      plugin.setItems([
        {
          id: 'pos_1',
          epic: 'AAPL',
          price: 100, // mockSeries converts 100 to y = 500
          direction: 'BUY',
          size: 1,
          type: 'POSITION',
        },
      ]);

      const viewData = plugin._getViewData();
      expect(viewData).toHaveLength(1);
      expect(viewData[0].y).toBe(500);
      expect(badgeEl.style.display).toBe('flex');
      expect(badgeEl.style.top).toBe('500px');
    });

    it('hides badge when price coordinate is null', () => {
      mockSeries.priceToCoordinate.mockReturnValue(null);
      const badgeEl = document.createElement('div');
      plugin.registerBadgeRef('pos_1', { current: badgeEl });

      plugin.setItems([
        {
          id: 'pos_1',
          epic: 'AAPL',
          price: 9999,
          direction: 'BUY',
          size: 1,
          type: 'POSITION',
        },
      ]);

      const viewData = plugin._getViewData();
      expect(viewData).toHaveLength(0);
      expect(badgeEl.style.display).toBe('none');
    });
  });

  describe('Hover State & Axis Views', () => {
    it('sets hovered ID only when changed', () => {
      requestUpdateMock.mockClear();
      plugin.setHoveredId('item_1');
      expect(plugin._hoveredId).toBe('item_1');
      expect(requestUpdateMock).toHaveBeenCalledTimes(1);

      plugin.setHoveredId('item_1');
      expect(requestUpdateMock).toHaveBeenCalledTimes(1);

      plugin.setHoveredId(null);
      expect(plugin._hoveredId).toBeNull();
      expect(requestUpdateMock).toHaveBeenCalledTimes(2);
    });

    it('sets hovered executions and updates axis views', () => {
      plugin.setHoveredExecutions([
        { x: 100 as any, y: 250 as any, direction: 'BUY', action: 'ENTRY', price: 150 },
        { x: 200 as any, y: 350 as any, direction: 'SELL', action: 'EXIT', price: 170 },
      ]);

      expect(plugin._hoveredExecutions).toHaveLength(2);
      expect(requestUpdateMock).toHaveBeenCalled();

      const axisViews = plugin.priceAxisViews();
      expect(axisViews).toHaveLength(2);

      // Buy axis view
      expect(axisViews[0].coordinate()).toBe(250);
      expect(axisViews[0].textColor()).toBe('#ffffff');
      expect(axisViews[0].backColor()).toBe('#007aff');
      expect(axisViews[0].text()).toBe('$150.00');

      // Sell axis view
      expect(axisViews[1].coordinate()).toBe(350);
      expect(axisViews[1].backColor()).toBe('#ff3b30');
      expect(axisViews[1].text()).toBe('$170.00');
    });

    it('returns empty priceAxisViews when no executions hovered', () => {
      plugin.setHoveredExecutions([]);
      expect(plugin.priceAxisViews()).toEqual([]);
    });
  });

  describe('Execution Markers Coordinate Calculations', () => {
    it('maps execution marker with time to x and arrowY based on candleHigh/candleLow', () => {
      plugin.setItems([
        {
          id: 'exec_buy',
          epic: 'AAPL',
          price: 150,
          direction: 'BUY',
          size: 10,
          type: 'EXECUTION',
          time: 1600000000 as any,
          candleLow: 145,
          candleHigh: 155,
        },
        {
          id: 'exec_sell',
          epic: 'AAPL',
          price: 160,
          direction: 'SELL',
          size: 10,
          type: 'EXECUTION',
          time: 1600000000 as any,
          candleLow: 158,
          candleHigh: 165,
        },
      ]);

      const data = plugin._getViewData();
      expect(data).toHaveLength(2);

      // BUY execution should use candleLow (145 -> y: 275)
      expect(data[0].x).toBe(500);
      expect(data[0].arrowY).toBe(1000 - 145 * 5);

      // SELL execution should use candleHigh (165 -> y: 175)
      expect(data[1].x).toBe(500);
      expect(data[1].arrowY).toBe(1000 - 165 * 5);
    });
  });

  describe('TradeRenderer Canvas Drawing', () => {
    it('draws items onto canvas without throwing errors', () => {
      plugin.setItems([
        {
          id: 'pos_1',
          epic: 'AAPL',
          price: 150,
          direction: 'BUY',
          size: 1,
          type: 'POSITION',
        },
        {
          id: 'pos_1_SL',
          epic: 'AAPL',
          price: 140,
          direction: 'SELL',
          size: 1,
          type: 'ORDER',
          parentPrice: 150,
          isDashed: true,
        },
        {
          id: 'exec_1',
          epic: 'AAPL',
          price: 150,
          direction: 'BUY',
          size: 1,
          type: 'EXECUTION',
          time: 1600000000 as any,
        },
      ]);
      plugin.setHoveredId('pos_1_SL');
      plugin.setHoveredExecutions([
        { x: 100 as any, y: 200 as any, direction: 'BUY', action: 'ENTRY', price: 150 },
      ]);

      const paneView = plugin.paneViews()[0];
      const renderer = paneView.renderer();

      const mockCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        arc: vi.fn(),
        setLineDash: vi.fn(),
        canvas: {
          getBoundingClientRect: vi.fn().mockReturnValue({ left: 0, right: 1000 }),
        },
      };

      const mockTarget = {
        useMediaCoordinateSpace: (cb: any) => {
          cb({
            context: mockCtx,
            mediaSize: { width: 1000, height: 600 },
          });
        },
      };

      expect(() => renderer.draw(mockTarget as any)).not.toThrow();
      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });
  });
});
