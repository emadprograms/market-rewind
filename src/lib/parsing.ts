import type { Timeframe } from '../types';

/**
 * Unified parser for symbols and timeframes.
 * Matches: 
 * - Symbols: AAPL, TSLA, 45 (if not a TF)
 * - Timeframes: 5, 5m, 1h, 1d, 1H, 1D
 */
export function parseInput(input: string): { type: 'timeframe' | 'ticker', value: string } {
  const val = input.trim().toLowerCase();
  
  // Try timeframe parsing
  const numericMatch = val.match(/^(\d+)(m|h|d)?$/);
  if (numericMatch) {
    const num = parseInt(numericMatch[1]);
    const unit = (numericMatch[2] || 'm').toLowerCase();

    if (unit === 'm') {
      if (num === 1) return { type: 'timeframe', value: '1min' };
      if (num === 5) return { type: 'timeframe', value: '5min' };
      if (num === 15) return { type: 'timeframe', value: '15min' };
      if (num === 30) return { type: 'timeframe', value: '30min' };
      if (num === 60) return { type: 'timeframe', value: '1H' };
    } else if (unit === 'h') {
      if (num === 1) return { type: 'timeframe', value: '1H' };
    } else if (unit === 'd') {
      if (num === 1) return { type: 'timeframe', value: '1D' };
    }
  } else {
    // String aliases
    if (val === '1h') return { type: 'timeframe', value: '1H' };
    if (val === '1d') return { type: 'timeframe', value: '1D' };
  }

  // Default to ticker
  return { type: 'ticker', value: input.trim().toUpperCase() };
}
