import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act, renderHook } from '@testing-library/react';
import { PlaybackBar } from '../../src/components/PlaybackBar';
import { useWorkspaceStore } from '../../src/store/useWorkspaceStore';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { useKeyboardShortcuts } from '../../src/hooks/useKeyboardShortcuts';
import App from '../../src/App';

vi.mock('../../src/hooks/useDatabase', () => ({
  useDatabase: () => ({
    tickers: ['AAPL', 'MSFT', 'NVDA', 'TSLA'],
    isLoading: false,
    isDbLoaded: true,
    isStreamingConnected: true,
    serviceUrl: 'http://localhost:8420',
    changeServiceUrl: vi.fn(),
    resetServiceUrl: vi.fn(),
  }),
}));

vi.mock('../../src/lib/streamingClient', async () => {
  const actual = await vi.importActual('../../src/lib/streamingClient') as any;
  return {
    ...actual,
    streamingClient: {
      getCandles: vi.fn(async () => []),
      getTicks: vi.fn(async () => []),
      getLiveTape: vi.fn(async () => []),
      getSymbols: vi.fn(async () => [
        { symbol: 'AAPL' },
        { symbol: 'MSFT' },
        { symbol: 'NVDA' },
        { symbol: 'TSLA' },
      ]),
      checkStatus: vi.fn(async () => ({ status: 'OK' })),
      getBaseUrl: () => 'http://localhost:8420',
      getWsUrl: () => 'ws://localhost:8420',
      subscribeUrlChange: () => () => {},
      setServiceUrl: vi.fn(),
      resetToDefaultUrl: vi.fn(),
    },
  };
});

vi.mock('../../src/components/ChartWorkspace', () => ({
  ChartWorkspace: () => <div data-testid="chart-workspace" />,
}));
vi.mock('../../src/components/PlaybackManager', () => ({
  PlaybackManager: () => null,
}));
vi.mock('../../src/components/TimeAndSales', () => ({
  TimeAndSales: () => null,
}));
vi.mock('../../src/components/ConnectionSetupCard', () => ({
  ConnectionSetupCard: () => null,
}));

describe('PlaybackBar Next Symbol Button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.getState().reset();
  });

  it('renders next symbol button with correct label, aria-label, and title when onNextSymbol is provided', () => {
    const handleNextSymbol = vi.fn();
    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="AAPL"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
        onNextSymbol={handleNextSymbol}
        nextSymbol="MSFT"
      />
    );

    const nextBtn = screen.getByTestId('next-symbol-btn');
    expect(nextBtn).toBeInTheDocument();
    expect(nextBtn).toHaveTextContent('NEXT SYMBOL');
    expect(nextBtn).toHaveAttribute('aria-label', 'Next Symbol: MSFT');
    expect(nextBtn).toHaveAttribute('title', 'Next Symbol: MSFT (Space)');

    fireEvent.click(nextBtn);
    expect(handleNextSymbol).toHaveBeenCalledTimes(1);
  });

  it('does not render next symbol button if onNextSymbol is not provided', () => {
    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="AAPL"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
      />
    );

    expect(screen.queryByTestId('next-symbol-btn')).toBeNull();
  });

  it('renders with fallback title and aria-label if nextSymbol is not passed', () => {
    const handleNextSymbol = vi.fn();
    render(
      <PlaybackBar
        totalRealized={0}
        totalUnrealized={0}
        isDbLoaded={true}
        sessionTicker="AAPL"
        onResetToOpen={vi.fn()}
        minStepMinutes={1}
        onNextSymbol={handleNextSymbol}
      />
    );

    const nextBtn = screen.getByTestId('next-symbol-btn');
    expect(nextBtn).toBeInTheDocument();
    expect(nextBtn).toHaveAttribute('aria-label', 'Next Symbol');
    expect(nextBtn).toHaveAttribute('title', 'Next Symbol (Space)');
  });
});

describe('App Next Symbol Switching Integration', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('lastUsedTicker', 'AAPL');
    useWorkspaceStore.setState({
      selectedId: '0',
      tickers: { '0': 'AAPL' },
      groups: {},
      groupTickers: { red: 'AAPL', blue: 'AAPL', green: 'AAPL', yellow: 'AAPL' },
    });
    usePlaybackStore.getState().reset();
    vi.clearAllMocks();
  });

  it('clicking next symbol button cycles through symbols in useWorkspaceStore', async () => {
    render(<App />);

    await act(async () => {
      await Promise.resolve();
    });

    const nextBtn = screen.getByTestId('next-symbol-btn');
    expect(nextBtn).toBeInTheDocument();

    // Initial ticker is AAPL, next should be MSFT
    expect(nextBtn).toHaveAttribute('aria-label', 'Next Symbol: MSFT');

    // Click 1: AAPL -> MSFT
    act(() => {
      fireEvent.click(nextBtn);
    });
    expect(useWorkspaceStore.getState().tickers['0']).toBe('MSFT');

    // Click 2: MSFT -> NVDA
    act(() => {
      fireEvent.click(nextBtn);
    });
    expect(useWorkspaceStore.getState().tickers['0']).toBe('NVDA');

    // Click 3: NVDA -> TSLA
    act(() => {
      fireEvent.click(nextBtn);
    });
    expect(useWorkspaceStore.getState().tickers['0']).toBe('TSLA');

    // Click 4: TSLA -> AAPL (wraps around)
    act(() => {
      fireEvent.click(nextBtn);
    });
    expect(useWorkspaceStore.getState().tickers['0']).toBe('AAPL');
  });

  it('switches symbol for the selected chart in multi-chart setup', async () => {
    // Select chart 1
    useWorkspaceStore.setState({
      selectedId: '1',
      tickers: { '0': 'AAPL', '1': 'MSFT' },
    });

    render(<App />);

    await act(async () => {
      await Promise.resolve();
    });

    const nextBtn = screen.getByTestId('next-symbol-btn');
    // Active chart is chart 1 ('MSFT'), next should be 'NVDA'
    expect(nextBtn).toHaveAttribute('aria-label', 'Next Symbol: NVDA');

    act(() => {
      fireEvent.click(nextBtn);
    });

    // Chart 1 updated to NVDA, Chart 0 remains AAPL
    expect(useWorkspaceStore.getState().tickers['1']).toBe('NVDA');
    expect(useWorkspaceStore.getState().tickers['0']).toBe('AAPL');
  });
});

describe('useKeyboardShortcuts Space key behavior', () => {
  it('pressing Space cycles to next ticker and wraps around', () => {
    const setTicker = vi.fn();
    const container = document.createElement('div');
    const containerRef = { current: container };

    renderHook(() =>
      useKeyboardShortcuts({
        chartContainerRef: containerRef,
        onUpdateDrawings: vi.fn(),
        ticker: 'MSFT',
        setShowEth: vi.fn(),
        isSelected: true,
        tickers: ['AAPL', 'MSFT', 'NVDA'],
        setTicker,
      })
    );

    fireEvent.keyDown(window, { key: ' ' });
    expect(setTicker).toHaveBeenCalledWith('NVDA');
  });

  it('pressing Space falls back to first ticker if current ticker not in list', () => {
    const setTicker = vi.fn();
    const container = document.createElement('div');
    const containerRef = { current: container };

    renderHook(() =>
      useKeyboardShortcuts({
        chartContainerRef: containerRef,
        onUpdateDrawings: vi.fn(),
        ticker: 'UNKNOWN',
        setShowEth: vi.fn(),
        isSelected: true,
        tickers: ['AAPL', 'MSFT', 'NVDA'],
        setTicker,
      })
    );

    fireEvent.keyDown(window, { key: ' ' });
    expect(setTicker).toHaveBeenCalledWith('AAPL');
  });
});
