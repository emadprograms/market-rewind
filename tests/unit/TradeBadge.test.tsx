import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TradeBadge } from '../../src/components/TradeBadge';
import type { ChartMarker } from '../../src/lib/TradePlugin';
import type { ActiveTrade } from '../../src/types';

describe('TradeBadge Component Tests', () => {
  it('renders null when neither marker nor activeTrade is provided', () => {
    const { container } = render(<TradeBadge />);
    expect(container.firstChild).toBeNull();
  });

  describe('Position Markers', () => {
    it('renders Long position badge with positive PnL in USD', () => {
      const marker: ChartMarker = {
        id: 'pos_long',
        epic: 'AAPL',
        price: 150,
        direction: 'BUY',
        size: 10,
        type: 'POSITION',
        hasSL: false,
        hasTP: false,
      };

      render(<TradeBadge marker={marker} currentPrice={155} />);

      // Size badge
      expect(screen.getByText('10')).toBeDefined();
      // PnL: (155 - 150) * 10 = +50.00 USD
      expect(screen.getByText('+50.00 USD')).toBeDefined();
      // Has TP and SL drag handles when hasSL/hasTP are false
      expect(screen.getByText('TP')).toBeDefined();
      expect(screen.getByText('SL')).toBeDefined();
    });

    it('renders Short position badge with negative PnL', () => {
      const marker: ChartMarker = {
        id: 'pos_short',
        epic: 'AAPL',
        price: 200,
        direction: 'SELL',
        size: 5,
        type: 'POSITION',
        hasSL: true,
        hasTP: true,
      };

      // Current price rose to 210 -> PnL: (200 - 210) * 5 = -50.00 USD
      render(<TradeBadge marker={marker} currentPrice={210} />);

      expect(screen.getByText('5')).toBeDefined();
      expect(screen.getByText('-50.00 USD')).toBeDefined();
      // Because hasSL and hasTP are true, handles shouldn't be rendered
      expect(screen.queryByText('TP')).toBeNull();
      expect(screen.queryByText('SL')).toBeNull();
    });
  });

  describe('Order Markers (SL and TP)', () => {
    it('renders Stop Loss order with hit PnL and orange styling', () => {
      const marker: ChartMarker = {
        id: 'pos_1_SL',
        epic: 'AAPL',
        price: 140,
        direction: 'SELL',
        size: 10,
        type: 'ORDER',
        label: 'SL',
        parentPrice: 150,
      };

      render(<TradeBadge marker={marker} />);

      expect(screen.getByText('10')).toBeDefined();
      // hitPnl: (140 - 150) * 10 * 1 = -100.00 USD
      expect(screen.getByText('-100.00 USD')).toBeDefined();
    });

    it('renders Take Profit order with hit PnL', () => {
      const marker: ChartMarker = {
        id: 'pos_1_TP',
        epic: 'AAPL',
        price: 170,
        direction: 'SELL',
        size: 10,
        type: 'ORDER',
        label: 'TP',
        parentPrice: 150,
      };

      render(<TradeBadge marker={marker} />);

      expect(screen.getByText('10')).toBeDefined();
      // hitPnl: (170 - 150) * 10 * 1 = +200.00 USD
      expect(screen.getByText('+200.00 USD')).toBeDefined();
    });
  });

  describe('User Interactions', () => {
    it('triggers onClose when close button is clicked', () => {
      const marker: ChartMarker = {
        id: 'pos_1',
        epic: 'AAPL',
        price: 100,
        direction: 'BUY',
        size: 1,
        type: 'POSITION',
      };
      const onCloseMock = vi.fn();

      render(<TradeBadge marker={marker} currentPrice={100} onClose={onCloseMock} />);

      const closeBtn = screen.getByRole('button');
      expect(closeBtn).toBeDefined();
      fireEvent.click(closeBtn);
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('does not render close button when onClose is omitted', () => {
      const marker: ChartMarker = {
        id: 'pos_1',
        epic: 'AAPL',
        price: 100,
        direction: 'BUY',
        size: 1,
        type: 'POSITION',
      };

      render(<TradeBadge marker={marker} currentPrice={100} />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('triggers onPointerDown with suffix when TP or SL handle is clicked', () => {
      const marker: ChartMarker = {
        id: 'pos_1',
        epic: 'AAPL',
        price: 100,
        direction: 'BUY',
        size: 1,
        type: 'POSITION',
        hasSL: false,
        hasTP: false,
      };
      const onPointerDownMock = vi.fn();

      render(
        <TradeBadge 
          marker={marker} 
          currentPrice={100} 
          onPointerDown={onPointerDownMock} 
        />
      );

      const tpHandle = screen.getByText('TP');
      fireEvent.pointerDown(tpHandle);
      expect(onPointerDownMock).toHaveBeenCalledWith(expect.anything(), '_TP');

      const slHandle = screen.getByText('SL');
      fireEvent.pointerDown(slHandle);
      expect(onPointerDownMock).toHaveBeenCalledWith(expect.anything(), '_SL');
    });

    it('triggers onPointerDown without suffix when badge container is clicked', () => {
      const marker: ChartMarker = {
        id: 'pos_1_SL',
        epic: 'AAPL',
        price: 90,
        direction: 'SELL',
        size: 1,
        type: 'ORDER',
        label: 'SL',
      };
      const onPointerDownMock = vi.fn();

      const { container } = render(
        <TradeBadge 
          marker={marker} 
          onPointerDown={onPointerDownMock} 
        />
      );

      const badge = container.querySelector('.trade-badge-tv')!;
      expect(badge).toBeDefined();
      fireEvent.pointerDown(badge);
      expect(onPointerDownMock).toHaveBeenCalledWith(expect.anything());
    });
  });

  describe('Backward Compatibility Mode', () => {
    it('renders correctly with legacy activeTrade prop', () => {
      const trade: ActiveTrade = {
        type: 'long',
        entryPrice: 100,
        slPrice: 90,
        tpPrice: 120,
        size: 4,
      };

      render(<TradeBadge activeTrade={trade} currentPrice={105} />);

      expect(screen.getByText('4')).toBeDefined();
      // PnL: (105 - 100) * 4 = +20.00 USD
      expect(screen.getByText('+20.00 USD')).toBeDefined();
    });
  });
});
