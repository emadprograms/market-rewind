/**
 * Specified oracle for the candle `session` contract.
 *
 * The tick lake's candle projection returns time/symbol/OHLCV/tick_count and NO session column.
 * For `tf=1d` the service enforces `session='REG'` in SQL, so the label is known. For every other
 * timeframe the session is unknown, and inventing `'REG'` labelled pre-market, post-market and
 * overnight bars as RTH — which short-circuited `isRthBar`'s session fast path and pulled
 * extended-hours prices into the 1D candle (open = previous evening's post-market print).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamingClient } from '../../src/lib/streamingClient';

const backendRow = {
  time: '2026-10-14T12:00:00', // 08:00 ET — pre-market
  symbol: 'TSLA',
  open: 110,
  high: 110.5,
  low: 109.5,
  close: 110.2,
  volume: 20,
  tick_count: 4,
};

function mockFetchOnce(payload: unknown) {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response);
  return spy;
}

describe('streamingClient.getCandles session contract', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('does NOT fabricate a session for intraday candles (1m)', async () => {
    mockFetchOnce([backendRow]);
    const bars = await streamingClient.getCandles('TSLA', { timeframe: '1min', limit: 10 });
    expect(bars).toHaveLength(1);
    expect(bars[0].time).toBe('2026-10-14 12:00:00');
    expect(bars[0].session, 'intraday session must stay unknown so callers derive it from the timestamp')
      .toBeUndefined();
  });

  it('does NOT fabricate a session for intraday candles (5m)', async () => {
    mockFetchOnce([backendRow]);
    const bars = await streamingClient.getCandles('TSLA', { timeframe: '5min', limit: 10 });
    expect(bars[0].session).toBeUndefined();
  });

  it('keeps session=REG for daily candles, which the service RTH-filters in SQL', async () => {
    mockFetchOnce([{ ...backendRow, time: '2026-10-14T00:00:00' }]);
    const bars = await streamingClient.getCandles('TSLA', { timeframe: '1D', limit: 10 });
    expect(bars).toHaveLength(1);
    expect(bars[0].session).toBe('REG');
  });

  it('preserves an explicit session reported by the backend', async () => {
    mockFetchOnce([{ ...backendRow, session: 'PRE' }]);
    const bars = await streamingClient.getCandles('TSLA', { timeframe: '1min', limit: 10 });
    expect(bars[0].session).toBe('PRE');
  });
});
