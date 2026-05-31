import React from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';

// --- Market Data ---

/** Raw 1-minute bar from the database */
export interface RawBar {
  time: string;          // "2024-01-15 14:30:00" (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: 'REG' | 'PRE' | 'POST' | string;
}

/** Resampled OHLCV bar (same shape, but time may be bucketed) */
export type ChartBar = RawBar;

/** Formatted bar ready for lightweight-charts (unix timestamp) */
export interface FormattedBar {
  time: number;   // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- Timeframes ---

export type Timeframe = '1min' | '5min' | '15min' | '30min' | '1H' | '1D';

export const TF_MINUTES: Record<Timeframe, number> = {
  '1min': 1,
  '5min': 5,
  '15min': 15,
  '30min': 30,
  '1H': 60,
  '1D': 1440,
};

// --- Trades ---

export type TradeType = 'long' | 'short';

export interface ActiveTrade {
  type: TradeType;
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  size: number;
  entryTime: string;
}

// --- Drawings ---

export interface RayDrawing {
  price: number;
  time: Time;
}

export interface RectPoint {
  price: number;
  time: Time;
}

export interface RectDrawing {
  p1: RectPoint;
  p2: RectPoint;
}

export interface TickerDrawings {
  rays: RayDrawing[];
  rects: RectDrawing[];
}

export type AllDrawings = Record<string, TickerDrawings>;

// --- Group Colors ---

export type GroupColor = 'red' | 'blue' | 'green' | 'yellow' | 'none';

export const BORDER_COLORS: Record<Exclude<GroupColor, 'none'>, string> = {
  red: '#ef5350',
  blue: '#42a5f5',
  green: '#26a69a',
  yellow: '#ffca28',
};

// --- Keyboard Action ---

export type KeyboardActionType = 'timeframe' | 'ticker' | null;

export interface KeyboardAction {
  active: boolean;
  type: KeyboardActionType;
  value: string;
}

// --- Draw Mode ---

export type DrawType = 'ray' | 'rect';

// --- Chart Unit Props ---

export interface ChartUnitProps {
  id: number;
  globalTime: string | null;
  selectedDate: string;
  isReplayMode: boolean;
  tickers: string[];
  initialTicker: string;
  initialTf: Timeframe;
  initialEth: boolean;
  onToggleMaximize: () => void;
  isMaximized: boolean;
  allDrawings: AllDrawings;
  onUpdateDrawings: (ticker: string, type: 'rays' | 'rects', items: RayDrawing[] | RectDrawing[]) => void;
  onTimeframeChange: (id: number, tf: Timeframe) => void;
  onPnLUpdate: (id: number, realized: number, unrealized: number) => void;
  groupColor: GroupColor;
  groupTicker?: string;
  onGroupChange?: (color: GroupColor) => void;
  onTickerChange?: (ticker: string) => void;
  style?: React.CSSProperties;
}

// --- Chart Refs (for useChartLifecycle) ---

export interface ChartRefs {
  chartRef: React.MutableRefObject<IChartApi | null>;
  priceSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  volumeSeriesRef: React.MutableRefObject<ISeriesApi<'Histogram'> | null>;
  chartContainerRef: React.RefObject<HTMLDivElement>;
}
