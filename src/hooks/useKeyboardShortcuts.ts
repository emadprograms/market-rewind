import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DrawType, KeyboardAction, RayDrawing, RectDrawing, RectPoint } from '../types';
import { usePlaybackStore } from '../store/usePlaybackStore';
import type { IChartApi } from 'lightweight-charts';

interface UseKeyboardShortcutsParams {
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  chartRef?: React.MutableRefObject<IChartApi | null>;
  onUpdateDrawings: (ticker: string, type: 'rays' | 'rects', items: RayDrawing[] | RectDrawing[]) => void;
  ticker: string;
  setShowEth: React.Dispatch<React.SetStateAction<boolean>>;
  isSelected: boolean;
  tickers?: string[];
  setTicker?: (ticker: string) => void;
}

export function useKeyboardShortcuts({
  chartContainerRef,
  chartRef,
  onUpdateDrawings,
  ticker,
  setShowEth,
  isSelected,
  tickers = [],
  setTicker,
}: UseKeyboardShortcutsParams) {
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawType, setDrawType] = useState<DrawType>('ray');
  const [rectAnchor, setRectAnchor] = useState<RectPoint | null>(null);
  const [ghostPoint, setGhostPoint] = useState<RectPoint | null>(null);
  const [keyboardAction, setKeyboardAction] = useState<KeyboardAction>({ active: false, type: null, value: '' });

  const keyboardInputRef = useRef<HTMLInputElement>(null);
  const keyboardActionRef = useRef(keyboardAction);

  const updateKeyboardAction = useCallback((newState: Partial<KeyboardAction>) => {
    const merged = { ...keyboardActionRef.current, ...newState } as KeyboardAction;
    keyboardActionRef.current = merged;
    setKeyboardAction(merged);
  }, []);

  useEffect(() => {
    if (keyboardAction.active && keyboardInputRef.current) {
      keyboardInputRef.current.focus();
    }
  }, [keyboardAction.active]);

  const currentTickerRef = useRef(ticker);
  const tickersRef = useRef(tickers);
  const setTickerRef = useRef(setTicker);
  useEffect(() => {
    currentTickerRef.current = ticker;
    tickersRef.current = tickers;
    setTickerRef.current = setTicker;
  }, [ticker, tickers, setTicker]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target && ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'TEXTAREA')) return;

      const container = chartContainerRef.current;
      if (!container) return;
      const isHovered = container.matches(':hover') || container.contains(document.activeElement);
      if (!isHovered && !isSelected && !keyboardActionRef.current.active) return;

      if (e.altKey || e.ctrlKey) {
        const keyLower = e.key.toLowerCase();
        const isKeyJ = e.code === 'KeyJ' || e.keyCode === 74 || keyLower === 'j' || keyLower === '∆';
        const isKeyE = e.code === 'KeyE' || e.keyCode === 69 || keyLower === 'e' || keyLower === '´';
        const isKeyR = e.code === 'KeyR' || e.keyCode === 82 || keyLower === 'r' || keyLower === '‰';

        if (isKeyJ && !e.shiftKey) {
          e.preventDefault();
          setDrawType('ray');
          setIsDrawingMode(prev => !prev || drawType !== 'ray');
          setRectAnchor(null);
        }
        if (isKeyE && e.shiftKey) {
          e.preventDefault();
          setShowEth(prev => !prev);
        }
        if (isKeyR && e.shiftKey) {
          e.preventDefault();
          setDrawType('rect');
          setIsDrawingMode(prev => !prev || drawType !== 'rect');
          setRectAnchor(null);
        }
        return;
      }

      if (e.key === 'Escape') {
        if (keyboardActionRef.current.active) {
          updateKeyboardAction({ active: false, type: null, value: '' });
          return;
        }
        setIsDrawingMode(false);
        setRectAnchor(null);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (keyboardActionRef.current.active) {
          updateKeyboardAction({ value: keyboardActionRef.current.value.slice(0, -1) });
          return;
        }
        onUpdateDrawings(currentTickerRef.current, 'rays', []);
        onUpdateDrawings(currentTickerRef.current, 'rects', []);
      }

      if (e.key === ' ' && !keyboardActionRef.current.active) {
        e.preventDefault();
        const currentTickers = tickersRef.current;
        const currentSetTicker = setTickerRef.current;
        if (currentTickers.length > 0 && currentSetTicker) {
          const currentIndex = currentTickers.indexOf(currentTickerRef.current);
          if (currentIndex !== -1) {
            let nextIndex = e.shiftKey ? currentIndex - 1 : currentIndex + 1;
            if (nextIndex >= currentTickers.length) nextIndex = 0;
            if (nextIndex < 0) nextIndex = currentTickers.length - 1;
            currentSetTicker(currentTickers[nextIndex]);
          }
        }
        return;
      }

      if (e.key === 'ArrowLeft') {
        if (e.shiftKey) {
          e.preventDefault();
          usePlaybackStore.getState().stepBackward();
        } else if (chartRef?.current) {
          e.preventDefault();
          const timeScale = chartRef.current.timeScale();
          const visibleRange = timeScale.getVisibleLogicalRange();
          if (visibleRange) {
            const span = visibleRange.to - visibleRange.from;
            const shift = Math.max(1, Math.floor(span * 0.1)); // Shift by 10% of visible range, at least 1 bar
            timeScale.setVisibleLogicalRange({
              from: visibleRange.from - shift,
              to: visibleRange.to - shift,
            });
          }
        }
        return;
      }

      if (e.key === 'ArrowRight') {
        if (e.shiftKey) {
          e.preventDefault();
          usePlaybackStore.getState().stepForward();
        } else if (chartRef?.current) {
          e.preventDefault();
          const timeScale = chartRef.current.timeScale();
          const visibleRange = timeScale.getVisibleLogicalRange();
          if (visibleRange) {
            const span = visibleRange.to - visibleRange.from;
            const shift = Math.max(1, Math.floor(span * 0.1));
            timeScale.setVisibleLogicalRange({
              from: visibleRange.from + shift,
              to: visibleRange.to + shift,
            });
          }
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && e.key !== ' ') {
        if (keyboardActionRef.current.active) {
          // If already active but input not yet focused, append to value
          updateKeyboardAction({ value: (keyboardActionRef.current.value + e.key).toUpperCase() });
          return;
        }

        const isNum = /^[0-9]$/.test(e.key);
        const isLetter = /^[a-zA-Z]$/.test(e.key);

        if (isNum) {
          e.preventDefault();
          updateKeyboardAction({ active: true, type: 'timeframe', value: e.key });
        } else if (isLetter) {
          e.preventDefault();
          updateKeyboardAction({ active: true, type: 'ticker', value: e.key.toUpperCase() });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chartContainerRef, chartRef, drawType, onUpdateDrawings, setShowEth, updateKeyboardAction, isSelected]);

  return {
    isDrawingMode,
    setIsDrawingMode,
    drawType,
    setDrawType,
    rectAnchor,
    setRectAnchor,
    ghostPoint,
    setGhostPoint,
    keyboardAction,
    updateKeyboardAction,
    keyboardInputRef,
  };
}
