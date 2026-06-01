import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ChartUnit from '../../src/components/ChartUnit';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';

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

describe('Sync-Lag Integration Tests', () => {
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
    useWorkspaceStore.setState({
      selectedId: null,
      tickers: {},
      groups: {},
      groupTickers: {},
    });
  });

  it('should propagate ticker updates atomically across grouped charts', async () => {
    // Setup: Two charts in the 'red' group
    useWorkspaceStore.setState({
      groups: { '1': 'red', '2': 'red' },
      groupTickers: { 'red': 'AAPL' },
    });

    const { container } = render(
      <>
        <ChartUnit {...mockProps} id={1} />
        <ChartUnit {...mockProps} id={2} />
      </>
    );

    // Chart 1 updates the ticker to 'MSFT'
    // In a real scenario, this would happen via the UI (ChartHeader -> setTicker)
    // We'll use the store directly to simulate the action, but we can also use UI
    
    act(() => {
      useWorkspaceStore.getState().setTicker('1', 'MSFT');
      // Since Chart 1 is in 'red' group, setTicker in useChartData will also call setGroupTicker
      // But let's simulate exactly what useChartData.setTicker does:
      const state = useWorkspaceStore.getState();
      state.setTicker('1', 'MSFT');
      state.setGroupTicker('red', 'MSFT');
    });

    // Verify that BOTH charts now see 'MSFT' immediately
    // We check this by looking at the rendered tickers in the headers
    const tickers = screen.getAllByText('MSFT');
    expect(tickers).toHaveLength(2);
    
    // Verify no 'AAPL' remains in the headers
    const oldTickers = screen.queryAllByText('AAPL');
    expect(oldTickers).toHaveLength(0);
  });

  it('should not propagate ticker updates to charts outside the group', async () => {
    // Setup: Chart 1 is 'red', Chart 2 is 'blue'
    useWorkspaceStore.setState({
      groups: { '1': 'red', '2': 'blue' },
      groupTickers: { 'red': 'AAPL', 'blue': 'MSFT' },
    });

    render(
      <>
        <ChartUnit {...mockProps} id={1} />
        <ChartUnit {...mockProps} id={2} />
      </>
    );

    act(() => {
      useWorkspaceStore.getState().setGroupTicker('red', 'TSLA');
    });

    // Chart 1 should update to TSLA
    expect(screen.getByText('TSLA')).toBeDefined();
    // Chart 2 should remain MSFT
    expect(screen.getByText('MSFT')).toBeDefined();
  });
});
