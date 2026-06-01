import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ChartUnit from '../../src/components/ChartUnit';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import { vi as vitestVi } from 'vitest';

// Mock heavy dependencies
vi.mock('../../src/hooks/useChartLifecycle', () => ({
  useChartLifecycle: vi.fn(() => ({
    tradePluginRef: {},
    chartRef: { current: null },
    priceSeriesRef: { current: null },
  })),
}));

vi.mock('../../src/hooks/useTradeManager', () => ({
  useTradeManager: vi.fn(() => ({
    realizedPnL: 0,
    unrealizedPnL: 0,
    setActiveTrade: vi.fn(),
    tradeSize: 1,
    setTradeSize: vi.fn(),
    placeOrder: vi.fn(),
    activeTrade: null,
  })),
}));

vi.mock('../../src/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(() => ({
    isDrawingMode: false,
    drawType: 'ray',
    rectAnchor: null,
    setRectAnchor: vi.fn(),
    ghostPoint: null,
    setGhostPoint: vi.fn(),
    keyboardAction: { active: false, value: '' },
    updateKeyboardAction: vi.fn(),
    keyboardInputRef: { current: null },
  })),
}));

vi.mock('../../src/lib/db', () => ({
  fetchMarketData: vi.fn().mockResolvedValue([]),
  fetchHistoricalChunk: vi.fn().mockResolvedValue([]),
}));

describe('Selection Integration Tests', () => {
  const mockProps = {
    selectedDate: '2024-01-01',
    isReplayMode: false,
    tickers: ['AAPL', 'MSFT', 'TSLA'],
    initialTicker: 'AAPL',
    initialTf: '1D',
    initialEth: false,
    onToggleMaximize: vi.fn(),
    isMaximized: false,
    onUpdateDrawings: vi.fn(),
    onTimeframeChange: vi.fn(),
    onPnLUpdate: vi.fn(),
  };

  beforeEach(() => {
    // Reset store to initial state
    useWorkspaceStore.setState({
      selectedId: null,
      tickers: {},
      groups: {},
      groupTickers: {},
    });
  });

  it('should set selectedId when clicking on the ChartUnit root', async () => {
    const { container } = render(<ChartUnit {...mockProps} id={1} />);
    
    const card = container.querySelector('.chart-card');
    if (!card) throw new Error('Chart card not found');
    
    fireEvent.click(card);
    
    expect(useWorkspaceStore.getState().selectedId).toBe('1');
  });

  it('should set selectedId when clicking on the ChartHeader', async () => {
    render(<ChartUnit {...mockProps} id={2} />);
    
    const header = screen.getByText('AAPL').closest('.chart-header');
    if (!header) throw new Error('Chart header not found');
    
    fireEvent.click(header);
    
    expect(useWorkspaceStore.getState().selectedId).toBe('2');
  });

  it('should update selection when switching between multiple ChartUnits', async () => {
    render(
      <>
        <ChartUnit {...mockProps} id={1} />
        <ChartUnit {...mockProps} id={2} />
      </>
    );
    
    const cards = document.querySelectorAll('.chart-card');
    
    fireEvent.click(cards[0] as HTMLElement);
    expect(useWorkspaceStore.getState().selectedId).toBe('1');
    
    fireEvent.click(cards[1] as HTMLElement);
    expect(useWorkspaceStore.getState().selectedId).toBe('2');
  });

  it('should trigger selection even when clicking deep inside the header controls', async () => {
    render(<ChartUnit {...mockProps} id={3} />);
    
    // Find the "Group" dropdown or any control in the header
    const groupDropdown = screen.getByText('Group');
    
    fireEvent.click(groupDropdown);
    
    expect(useWorkspaceStore.getState().selectedId).toBe('3');
  });

  it('should maintain selection when clicking non-interactive elements within the card', async () => {
    render(<ChartUnit {...mockProps} id={4} />);
    
    const card = document.querySelector('.chart-card');
    if (!card) throw new Error('Chart card not found');
    
    // Click on the card but not on a button/input
    fireEvent.click(card);
    
    expect(useWorkspaceStore.getState().selectedId).toBe('4');
  });
});
