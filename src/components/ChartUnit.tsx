import React, { useRef } from 'react';
import { useChartData } from '../hooks/useChartData';
import { useChartLifecycle } from '../hooks/useChartLifecycle';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useTradeManager } from '../hooks/useTradeManager';
import { ChartHeader } from './ChartHeader';
import { ChartCanvas } from './ChartCanvas';
import { TradeControls } from './TradeControls';
import { DrawingStatus } from './DrawingStatus';
import type { ChartUnitProps } from '../types';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

export default function ChartUnit({ 
  id, 
  selectedDate,
  isReplayMode, 
  tickers, 
  initialTicker, 
  initialTf,
  initialEth,
  onToggleMaximize,
  isMaximized,
  allDrawings = {},
  onUpdateDrawings,
  onTimeframeChange,
  onPnLUpdate,
  groupColor = 'none',
  groupTicker,
  onGroupChange,
  onTickerChange,
  style = {}
}: ChartUnitProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [showVP, setShowVP] = React.useState(false);

  // 1. Data management
  const data = useChartData({ 
    initialTicker, 
    initialTf, 
    initialEth, 
    selectedDate, 
    isReplayMode, 
    groupColor, 
    groupTicker, 
    tickers, 
    chartRef, 
    priceSeriesRef, 
    onTimeframeChange, 
    onTickerChange, 
    id 
  });

  // Unified Ticker Updater
  const handleTickerUpdate = React.useCallback((newTicker: string) => {
    data.setTicker(newTicker);
    if (onTickerChange) {
      onTickerChange(newTicker);
    }
  }, [data, onTickerChange]);


  // 2. Keyboard & Drawing state
  const keyboard = useKeyboardShortcuts({ 
    chartContainerRef, 
    onUpdateDrawings, 
    ticker: data.ticker,
    setShowEth: data.setShowEth
  });

  // 3. Trade badge ref (needed for chart lifecycle)
  const tradeBadgeRef = useRef<HTMLDivElement>(null);

  // 4. Chart lifecycle
  const chart = useChartLifecycle({ 
    chartContainerRef,
    ticker: data.ticker,
    timeframe: data.timeframe,
    showEth: data.showEth,
    showVP,
    chartData: data.chartData,
    localMasterData: data.localMasterData,
    isReplayMode,
    isLoadingHistory: data.isLoadingHistory,
    pendingHistoryPrependRef: data.pendingHistoryPrependRef,
    isDrawingMode: keyboard.isDrawingMode,
    drawType: keyboard.drawType,
    rectAnchor: keyboard.rectAnchor,
    setRectAnchor: keyboard.setRectAnchor,
    ghostPoint: keyboard.ghostPoint,
    setGhostPoint: keyboard.setGhostPoint,
    drawings: allDrawings[data.ticker] || { rays: [], rects: [] },
    onUpdateDrawings,
    activeTrade: null, // handled inside trade manager and trade plugin directly
    tradeBadgeRef,
    chartRef,
    priceSeriesRef,
  });

  // 5. Trade management
  const trade = useTradeManager({ 
    chartData: data.chartData, 
    chartContainerRef, 
    priceSeriesRef, 
    tradePluginRef: chart.tradePluginRef 
  });

  // Sync PnL to App
  React.useEffect(() => {
    onPnLUpdate(id, trade.realizedPnL, trade.unrealizedPnL);
  }, [trade.realizedPnL, trade.unrealizedPnL, id, onPnLUpdate]);

  const currentPrice = data.chartData[data.chartData.length - 1]?.close ?? 0;

  const hasExplicitSize = style.width || style.height;
  const mergedStyle = { 
    ...style, 
    ...(!isMaximized ? { position: 'relative' as any } : {}), 
    ...(hasExplicitSize ? { flex: 'none' } : {}) 
  };

  const BORDER_COLORS: Record<string, string> = {
    red: '#ef5350',
    blue: '#42a5f5',
    green: '#26a69a',
    yellow: '#ffca28',
  };

  return (
    <div className={`chart-card ${isMaximized ? 'is-maximized' : ''}`} style={{
      ...mergedStyle,
      borderTop: groupColor !== 'none' && BORDER_COLORS[groupColor] ? `3px solid ${BORDER_COLORS[groupColor]}` : undefined,
    }}>
      <ChartHeader 
        ticker={data.ticker}
        setTicker={data.setTicker}
        timeframe={data.timeframe}
        setTimeframe={data.setTimeframe}
        showEth={data.showEth}
        setShowEth={data.setShowEth}
        showVP={showVP}
        setShowVP={setShowVP}
        isDrawingMode={keyboard.isDrawingMode}
        setIsDrawingMode={keyboard.setIsDrawingMode}
        drawType={keyboard.drawType}
        setDrawType={keyboard.setDrawType}
        tickers={tickers}
        groupColor={groupColor}
        onGroupChange={onGroupChange}
        onTickerChange={handleTickerUpdate}
        onUpdateDrawings={onUpdateDrawings}
        isMaximized={isMaximized}
        onToggleMaximize={onToggleMaximize}
      />
      
      <div className="chart-panes" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ChartCanvas
          chartContainerRef={chartContainerRef}
          isDrawingMode={keyboard.isDrawingMode}
          isAtEnd={chart.isAtEnd}
          scrollToRealTime={chart.scrollToRealTime}
          activeTrade={trade.activeTrade}
          currentPrice={currentPrice}
          tradeBadgeRef={tradeBadgeRef}
          onCloseTrade={() => trade.setActiveTrade(null)}
        />
        
        <DrawingStatus 
          isDrawingMode={keyboard.isDrawingMode}
          drawType={keyboard.drawType}
          rectAnchor={keyboard.rectAnchor}
        />
        
        <TradeControls 
          tradeSize={trade.tradeSize}
          setTradeSize={trade.setTradeSize}
          placeOrder={trade.placeOrder}
        />
        
        {/* KEYBOARD ACTION MODAL */}
        {keyboard.keyboardAction.active && (
          <div className="keyboard-action-modal">
            <div className="modal-header">
              {keyboard.keyboardAction.type === 'timeframe' ? 'Change Interval' : 'Change Symbol'}
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const val = keyboard.keyboardAction.value.trim().toLowerCase();
              if (!val) {
                keyboard.updateKeyboardAction({ active: false });
                return;
              }

              if (keyboard.keyboardAction.type === 'timeframe') {
                let newTf = null;
                if (/^\d+$/.test(val)) {
                  const num = parseInt(val);
                  if (num === 1) newTf = '1min';
                  else if (num === 5) newTf = '5min';
                  else if (num === 15) newTf = '15min';
                  else if (num === 30) newTf = '30min';
                  else if (num === 60) newTf = '1H';
                } else if (val === '1h') newTf = '1H';
                else if (val === '1d') newTf = '1D';

                if (newTf) {
                  data.setTimeframe(newTf as any);
                }
              } else if (keyboard.keyboardAction.type === 'ticker') {
                handleTickerUpdate(val.toUpperCase());
              }

              keyboard.updateKeyboardAction({ active: false, value: '' });
            }}>
              <input
                ref={keyboard.keyboardInputRef}
                type="text"
                value={keyboard.keyboardAction.value}
                onChange={(e) => keyboard.updateKeyboardAction({ value: e.target.value.toUpperCase() })}
                onBlur={() => keyboard.updateKeyboardAction({ active: false })}
              />
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
