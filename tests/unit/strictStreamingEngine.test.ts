import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingClient } from '../../src/lib/streamingClient';

describe('Strict Single-DB Engine Enforcement (streaming.duckdb only)', () => {
  let client: StreamingClient;

  beforeEach(() => {
    client = new StreamingClient();
    client.setServiceUrl('http://100.72.128.22:8420');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const allTimeframes = ['1s', '5s', '15s', '30s', '1min', '5min', '15min', '30min', '1H', '1D'] as const;

  for (const tf of allTimeframes) {
    it(`routes timeframe ${tf} exclusively to /api/streaming/candles with source=streaming and db=streaming`, async () => {
      let requestedUrl = '';
      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        requestedUrl = String(url);
        return {
          ok: true,
          json: async () => ({
            symbol: 'SPY',
            timeframe: tf,
            database: 'streaming',
            candles: [],
          }),
        } as any;
      });

      await client.getCandles('SPY', { timeframe: tf });

      expect(requestedUrl).toContain('/api/streaming/candles');
      const urlObj = new URL(requestedUrl);
      expect(urlObj.searchParams.get('source')).toBe('streaming');
      expect(urlObj.searchParams.get('db')).toBe('streaming');
    });
  }

  it('guarantees fallback endpoint also explicitly carries source=streaming and db=streaming', async () => {
    const requestedUrls: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      requestedUrls.push(String(url));
      // Fail first request to trigger fallback
      if (requestedUrls.length === 1) {
        throw new Error('Primary streaming endpoint temporary failure');
      }
      return {
        ok: true,
        json: async () => ({ candles: [] }),
      } as any;
    });

    await client.getCandles('TSLA', { timeframe: '5min' });

    expect(requestedUrls.length).toBe(2);
    expect(requestedUrls[0]).toContain('/api/streaming/candles');
    const fallbackUrl = new URL(requestedUrls[1]);
    expect(fallbackUrl.searchParams.get('source')).toBe('streaming');
    expect(fallbackUrl.searchParams.get('db')).toBe('streaming');
  });

  it('queries /api/streaming/symbols for strict single-DB symbol inventory', async () => {
    let requestedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          symbols: [
            { display_name: 'AAPL', capital_ticker: 'AAPL', databento_ticker: 'AAPL', is_active: true },
            { display_name: 'SPY', capital_ticker: 'SPY', databento_ticker: 'SPY', is_active: true },
          ],
          total: 2,
          database: 'streaming',
        }),
      } as any;
    });

    const symbols = await client.getSymbols();

    expect(requestedUrl).toContain('/api/streaming/symbols');
    expect(symbols.map(s => s.symbol)).toEqual(['AAPL', 'SPY']);
  });
});
