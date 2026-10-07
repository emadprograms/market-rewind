/**
 * Boot-inventory contract — the startup symbol fetch must take the cheap path.
 *
 * The frontend's first data call populates the symbol inventory. If it uses the
 * aggregate form of the symbols endpoint, the backend performs a full-lake scan
 * (count/min/max over every tick row) whose result the client discards, which stalled
 * startup for seconds on a large lake on external storage.
 *
 * The backend half of this contract is pinned by
 * `backend/streaming_service/tests/test_hotpath_budgets.py`
 * (`test_boot_symbols_path_does_not_run_full_lake_aggregation`). This file pins the
 * client half, so the two cannot drift apart: either both stay cheap, or one suite fails.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamingClient } from '../../src/lib/streamingClient';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startup symbol inventory contract', () => {
  it('requests the names-only variant on the primary endpoint', async () => {
    const urls: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      urls.push(String(url));
      return { ok: true, json: async () => [{ symbol: 'AAPL' }, { symbol: 'SPY' }] } as any;
    });

    await streamingClient.getSymbols();

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/api/streaming/symbols');
    expect(urls[0]).toMatch(/names_only=1/);
  });

  it('keeps names_only on the fallback endpoint', async () => {
    const urls: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      urls.push(String(url));
      // First call (streaming alias) fails; the client falls back.
      if (urls.length === 1) return { ok: false, status: 404 } as any;
      return { ok: true, json: async () => [{ symbol: 'AAPL' }] } as any;
    });

    await streamingClient.getSymbols();

    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const u of urls) {
      expect(u).toMatch(/names_only=1/);
    }
  });

  it('still parses every response shape the service may return', async () => {
    // Object rows
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      ({ ok: true, json: async () => [{ symbol: 'AAPL', tick_count: 5 }, { symbol: 'BRK.B' }] } as any));
    expect((await streamingClient.getSymbols()).map(s => s.symbol)).toEqual(['AAPL', 'BRK.B']);

    vi.restoreAllMocks();

    // Wrapped payload with alternate ticker fields
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      ({ ok: true, json: async () => ({ symbols: [{ display_name: 'SPY' }, { ticker: 'QQQ' }] }) } as any));
    expect((await streamingClient.getSymbols()).map(s => s.symbol)).toEqual(['SPY', 'QQQ']);

    vi.restoreAllMocks();

    // Bare strings
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      ({ ok: true, json: async () => ['IWM', 'DIA'] } as any));
    expect((await streamingClient.getSymbols()).map(s => s.symbol)).toEqual(['IWM', 'DIA']);

    vi.restoreAllMocks();

    // Names-only rows carry no stats; they must still map cleanly.
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      ({ ok: true, json: async () => [{ symbol: 'TSLA' }] } as any));
    const [only] = await streamingClient.getSymbols();
    expect(only.symbol).toBe('TSLA');
    expect(only.tick_count).toBe(0);
    expect(only.first_tick).toBeNull();
  });
});
