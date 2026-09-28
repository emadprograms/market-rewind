import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChartCanvas } from '../../src/components/ChartCanvas';
import type { ChartMarker } from '../../src/lib/TradePlugin';
import type { ActiveTrade } from '../../src/types';

describe('ChartCanvas Component Tests', () => {
  const defaultProps = {
    chartContainerRef: { current: document.createElement('div') },
    isDrawingMode: false,
    isHydrated: true,
  };

  it('renders container element with correct test id and cursor', () => {
    const { rerender } = render(<ChartCanvas {...defaultProps} isDrawingMode={false} />);
    const container = screen.getByTestId('chart-container');
    expect(container).toBeDefined();
    expect(container.style.cursor).toBe('default');

    rerender(<ChartCanvas {...defaultProps} isDrawingMode={true} />);
    expect(container.style.cursor).toBe('crosshair');
  });

  describe('Hydration Overlay & Theme', () => {
    it('shows hydration overlay when isHydrated is false (dark/oled)', () => {
      const { container } = render(
        <ChartCanvas {...defaultProps} isHydrated={false} theme="oled" />
      );
      const overlay = container.querySelector('[style*="position: absolute"]');
      expect(overlay).not.toBeNull();
      expect((overlay as HTMLElement).style.backgroundColor).toBe('var(--bg-dark)');
    });

    it('shows light hydration overlay when theme is light', () => {
      const { container } = render(
        <ChartCanvas {...defaultProps} isHydrated={false} theme="light" />
      );
      const overlay = container.querySelector('[style*="position: absolute"]');
      expect(overlay).not.toBeNull();
      expect((overlay as HTMLElement).style.backgroundColor).toBe('rgb(204, 204, 204)');
    });

    it('hides hydration overlay when isHydrated is true', () => {
      const { container } = render(
        <ChartCanvas {...defaultProps} isHydrated={true} />
      );
      // Only the chart container should be present, no overlay
      const overlay = container.querySelector('[style*="pointer-events: none"]');
      expect(overlay).toBeNull();
    });
  });

  describe('Reset View Button', () => {
    it('shows reset button when isViewModified is true', () => {
      render(
        <ChartCanvas {...defaultProps} isViewModified={true} />
      );
      const resetBtn = screen.getByTitle('Reset View');
      expect(resetBtn).toBeDefined();
      expect(resetBtn.className).toBe('scroll-to-end-btn');
    });

    it('shows reset button when isAtEnd is false (backward compatibility)', () => {
      render(
        <ChartCanvas {...defaultProps} isAtEnd={false} />
      );
      const resetBtn = screen.getByTitle('Reset View');
      expect(resetBtn).toBeDefined();
    });

    it('hides reset button when isViewModified is false and isAtEnd is true', () => {
      render(
        <ChartCanvas {...defaultProps} isViewModified={false} isAtEnd={true} />
      );
      expect(screen.queryByTitle('Reset View')).toBeNull();
    });

    it('calls resetView when reset button is clicked', () => {
      const resetViewMock = vi.fn();
      render(
        <ChartCanvas {...defaultProps} isViewModified={true} resetView={resetViewMock} />
      );
      const resetBtn = screen.getByTitle('Reset View');
      fireEvent.click(resetBtn);
      expect(resetViewMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to scrollToRealTime if resetView is omitted', () => {
      const scrollToRealTimeMock = vi.fn();
      render(
        <ChartCanvas {...defaultProps} isViewModified={true} scrollToRealTime={scrollToRealTimeMock} />
      );
      const resetBtn = screen.getByTitle('Reset View');
      fireEvent.click(resetBtn);
      expect(scrollToRealTimeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Markers and TradeBadges', () => {
    it('renders POSITION and ORDER markers and excludes EXECUTION markers from DOM badges', () => {
      const markers: ChartMarker[] = [
        {
          id: 'pos_1',
          epic: 'AAPL',
          price: 150,
          direction: 'BUY',
          size: 10,
          type: 'POSITION',
        },
        {
          id: 'pos_1_SL',
          epic: 'AAPL',
          price: 140,
          direction: 'SELL',
          size: 10,
          type: 'ORDER',
          label: 'SL',
          parentPrice: 150,
        },
        {
          id: 'exec_1',
          epic: 'AAPL',
          price: 150,
          direction: 'BUY',
          size: 10,
          type: 'EXECUTION',
        },
      ];

      const onRegisterBadge = vi.fn();

      render(
        <ChartCanvas 
          {...defaultProps} 
          markers={markers} 
          onRegisterBadge={onRegisterBadge} 
        />
      );

      // Registers pos_1 and pos_1_SL, but NOT exec_1
      expect(onRegisterBadge).toHaveBeenCalledWith('pos_1', expect.anything());
      expect(onRegisterBadge).toHaveBeenCalledWith('pos_1_SL', expect.anything());
      expect(onRegisterBadge).not.toHaveBeenCalledWith('exec_1', expect.anything());
    });

    it('calls onCloseTrade with marker id when badge close is clicked', () => {
      const markers: ChartMarker[] = [
        {
          id: 'pos_1',
          epic: 'AAPL',
          price: 150,
          direction: 'BUY',
          size: 1,
          type: 'POSITION',
        },
      ];
      const onCloseTradeMock = vi.fn();
      const onRegisterBadgeMock = vi.fn();

      render(
        <ChartCanvas 
          {...defaultProps} 
          markers={markers} 
          onRegisterBadge={onRegisterBadgeMock}
          onCloseTrade={onCloseTradeMock}
        />
      );

      const closeBtn = screen.getByRole('button');
      fireEvent.click(closeBtn);
      expect(onCloseTradeMock).toHaveBeenCalledWith('pos_1');
    });

    it('renders legacy activeTrade when markers array is empty', () => {
      const activeTrade: ActiveTrade = {
        type: 'long',
        entryPrice: 100,
        size: 2,
      };

      render(
        <ChartCanvas 
          {...defaultProps} 
          activeTrade={activeTrade} 
          currentPrice={105}
        />
      );

      expect(screen.getByText('2')).toBeDefined();
      expect(screen.getByText('+10.00 USD')).toBeDefined();
    });
  });

  describe('BadgeWrapper Drag Interaction', () => {
    it('handles pointer down, pointer move, and pointer up for drag marker', () => {
      const markers: ChartMarker[] = [
        {
          id: 'pos_1_SL',
          epic: 'AAPL',
          price: 90,
          direction: 'SELL',
          size: 1,
          type: 'ORDER',
          label: 'SL',
        },
      ];
      const onDragMarker = vi.fn();
      const onDropMarker = vi.fn();
      const onHoverMarker = vi.fn();

      const { container } = render(
        <ChartCanvas 
          {...defaultProps} 
          markers={markers} 
          onRegisterBadge={vi.fn()}
          onDragMarker={onDragMarker}
          onDropMarker={onDropMarker}
          onHoverMarker={onHoverMarker}
        />
      );

      const badge = container.querySelector('.trade-badge-tv')!;
      expect(badge).toBeDefined();

      const wrapper = badge.parentElement!;
      badge.setPointerCapture = vi.fn();
      badge.releasePointerCapture = vi.fn();
      wrapper.setPointerCapture = vi.fn();
      wrapper.releasePointerCapture = vi.fn();

      // 1. Pointer Down
      fireEvent.pointerDown(badge, { button: 0, pointerId: 1 });
      expect(badge.setPointerCapture).toHaveBeenCalledWith(1);

      // 2. Pointer Move (dragging)
      fireEvent.pointerMove(wrapper, { clientY: 300, pointerId: 1 });
      expect(onDragMarker).toHaveBeenCalledWith('pos_1_SL', expect.any(Number));

      // 3. Pointer Up (dropped)
      fireEvent.pointerUp(wrapper, { pointerId: 1 });
      expect(wrapper.releasePointerCapture).toHaveBeenCalledWith(1);
      expect(onDropMarker).toHaveBeenCalledWith('pos_1_SL');
    });
  });
});
