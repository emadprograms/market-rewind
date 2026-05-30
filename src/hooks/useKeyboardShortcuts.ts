import { useState, useEffect, useRef, useCallback } from 'react';
import type { DrawType, KeyboardAction, RayDrawing, RectDrawing, RectPoint } from '../types';

interface UseKeyboardShortcutsParams {
  chartContainerRef: React.RefObject<HTMLDivElement>;
  onUpdateDrawings: (ticker: string, type: 'rays' | 'rects', items: RayDrawing[] | RectDrawing[]) => void;
  ticker: string;
  setShowEth: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useKeyboardShortcuts({
  chartContainerRef,
  onUpdateDrawings,
  ticker,
  setShowEth,
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
  useEffect(() => {
    currentTickerRef.current = ticker;
  }, [ticker]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target && ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'TEXTAREA')) return;

      const container = chartContainerRef.current;
      if (!container) return;
      const isHovered = container.matches(':hover') || container.contains(document.activeElement);
      if (!isHovered) return;

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
        if (keyboardActionRef.current.active) return;
        onUpdateDrawings(currentTickerRef.current, 'rays', []);
        onUpdateDrawings(currentTickerRef.current, 'rects', []);
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !keyboardActionRef.current.active) {
        const isNum = /^[0-9]$/.test(e.key);
        const isLetter = /^[a-zA-Z]$/.test(e.key);

        if (isNum) {
          e.preventDefault();
          updateKeyboardAction({ active: true, type: 'timeframe', value: e.key });
        } else if (isLetter) {
          e.preventDefault();
          updateKeyboardAction({ active: true, type: 'ticker', value: e.key });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chartContainerRef, drawType, onUpdateDrawings, setShowEth, updateKeyboardAction]);

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
