import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimeAndSales } from '../../src/components/TimeAndSales';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

describe('Time and Sales Integration Tests', () => {
  const sampleTicks: MarketTick[] = [
    { time: '2026-09-25 14:30:00.100', symbol: 'NVDA', price: 180.0, volume: 10, bid: 179.9, ask: 180.1 },
    { time: '2026-09-25 14:30:00.350', symbol: 'NVDA', price: 180.25, volume: 5, bid: 180.2, ask: 180.3 },
    { time: '2026-09-25 14:30:01.000', symbol: 'NVDA', price: 179.9, volume: 20, bid: 179.8, ask: 180.0 },
  ];

  beforeEach(() => {
    usePlaybackStore.getState().reset();
    usePlaybackStore.getState().setBufferedTicks(sampleTicks);
  });

  it('should not render anything when isOpen is false', () => {
    const { container } = render(<TimeAndSales isOpen={false} onClose={vi.fn()} symbol="NVDA" />);
    expect(container.firstChild).toBeNull();
  });

  it('should render header and symbol badge when isOpen is true', () => {
    render(<TimeAndSales isOpen={true} onClose={vi.fn()} symbol="NVDA" />);
    expect(screen.getByText('TIME & SALES')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('PRICE')).toBeInTheDocument();
    expect(screen.getByText('SIZE')).toBeInTheDocument();
  });

  it('should display tick rows with prices and highlight current active tick', () => {
    usePlaybackStore.setState({ currentTickIndex: 2 });
    const { container } = render(<TimeAndSales isOpen={true} onClose={vi.fn()} symbol="NVDA" />);
    
    expect(screen.getByText('180.00')).toBeInTheDocument();
    expect(screen.getByText('180.25')).toBeInTheDocument();
    expect(screen.getByText('179.90')).toBeInTheDocument();

    const activeRows = container.querySelectorAll('.tick-row.is-active');
    expect(activeRows.length).toBe(1);
  });

  it('should call onClose when close button is clicked', () => {
    const onCloseMock = vi.fn();
    render(<TimeAndSales isOpen={true} onClose={onCloseMock} symbol="NVDA" />);

    const closeBtn = screen.getByTitle('Close Tape');
    fireEvent.click(closeBtn);

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('should strictly filter trades by the active symbol in multi-symbol sessions (RENDER-04)', () => {
    const multiSymbolTicks: MarketTick[] = [
      { time: '2026-09-25 14:30:00.100', symbol: 'NVDA', price: 180.0, volume: 10, bid: 179.9, ask: 180.1 },
      { time: '2026-09-25 14:30:00.200', symbol: 'TSLA', price: 250.0, volume: 50, bid: 249.9, ask: 250.1 },
      { time: '2026-09-25 14:30:00.350', symbol: 'NVDA', price: 180.25, volume: 5, bid: 180.2, ask: 180.3 },
      { time: '2026-09-25 14:30:00.500', symbol: 'TSLA', price: 251.0, volume: 30, bid: 250.9, ask: 251.1 },
    ];
    usePlaybackStore.getState().setBufferedTicks(multiSymbolTicks);
    usePlaybackStore.setState({ currentTickIndex: 3 });

    render(<TimeAndSales isOpen={true} onClose={vi.fn()} symbol="NVDA" />);

    expect(screen.getByText('180.00')).toBeInTheDocument();
    expect(screen.getByText('180.25')).toBeInTheDocument();
    expect(screen.queryByText('250.00')).not.toBeInTheDocument();
    expect(screen.queryByText('251.00')).not.toBeInTheDocument();
    expect(screen.getByText('TICK: 2/2')).toBeInTheDocument();
  });
});
