import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChartCanvas } from '../../src/components/ChartCanvas';
import type { ChartMarker } from '../../src/lib/TradePlugin';

describe('Chart Canvas & Badges Interactive Integration', () => {
  it('handles the complete interactive SL/TP drag-and-drop lifecycle', () => {
    const markers: ChartMarker[] = [
      {
        id: 'pos_trade_1',
        epic: 'AAPL',
        price: 150,
        direction: 'BUY',
        size: 10,
        type: 'POSITION',
        hasSL: false,
        hasTP: false,
      },
    ];

    const onDragMarker = vi.fn();
    const onDropMarker = vi.fn();
    const onRegisterBadge = vi.fn();

    const { container } = render(
      <ChartCanvas
        chartContainerRef={{ current: document.createElement('div') }}
        isDrawingMode={false}
        isHydrated={true}
        markers={markers}
        onRegisterBadge={onRegisterBadge}
        onDragMarker={onDragMarker}
        onDropMarker={onDropMarker}
      />
    );

    // 1. Check position badge is rendered
    expect(screen.getByText('10')).toBeDefined();
    const tpHandle = screen.getByText('TP');
    const slHandle = screen.getByText('SL');
    expect(tpHandle).toBeDefined();
    expect(slHandle).toBeDefined();

    // 2. Drag TP handle
    const badgeWrapper = container.querySelector('.trade-badge-tv')?.parentElement!;
    expect(badgeWrapper).toBeDefined();

    badgeWrapper.setPointerCapture = vi.fn();
    badgeWrapper.releasePointerCapture = vi.fn();
    tpHandle.setPointerCapture = vi.fn();
    tpHandle.releasePointerCapture = vi.fn();

    // User presses pointer down on TP handle
    fireEvent.pointerDown(tpHandle, { button: 0, pointerId: 10 });
    expect(tpHandle.setPointerCapture).toHaveBeenCalledWith(10);

    // User moves pointer up (towards higher price)
    fireEvent.pointerMove(badgeWrapper, { clientY: 180, pointerId: 10 });
    expect(onDragMarker).toHaveBeenCalledWith('pos_trade_1_TP', 180);

    // User releases pointer
    fireEvent.pointerUp(badgeWrapper, { pointerId: 10 });
    expect(badgeWrapper.releasePointerCapture).toHaveBeenCalledWith(10);
    expect(onDropMarker).toHaveBeenCalledWith('pos_trade_1_TP');
  });

  it('toggles Reset View button based on viewport state and resets on click', () => {
    const mockResetView = vi.fn();

    const InteractiveChart = () => {
      const [isViewModified, setIsViewModified] = useState(false);

      return (
        <div>
          <button data-testid="simulate-pan" onClick={() => setIsViewModified(true)}>
            Simulate Pan
          </button>
          <ChartCanvas
            chartContainerRef={{ current: document.createElement('div') }}
            isDrawingMode={false}
            isHydrated={true}
            isViewModified={isViewModified}
            resetView={() => {
              mockResetView();
              setIsViewModified(false);
            }}
          />
        </div>
      );
    };

    render(<InteractiveChart />);

    // Initially at real-time -> reset button must be hidden
    expect(screen.queryByTitle('Reset View')).toBeNull();

    // User pans back in time -> isViewModified becomes true
    fireEvent.click(screen.getByTestId('simulate-pan'));

    // Reset button should now be visible
    const resetBtn = screen.getByTitle('Reset View');
    expect(resetBtn).toBeDefined();

    // User clicks Reset View button
    fireEvent.click(resetBtn);

    // resetView callback was invoked
    expect(mockResetView).toHaveBeenCalledTimes(1);

    // Reset button disappears because viewport returned to real-time
    expect(screen.queryByTitle('Reset View')).toBeNull();
  });
});
