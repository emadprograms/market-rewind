import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getAskPrice, getBidPrice, useTradeManager } from '../../src/hooks/useTradeManager';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { useAccountStore } from '../../src/store/useAccountStore';
import { trainingProfile } from '../../src/lib/orderSimulator/profiles';
import { quotesFromTicks } from '../../src/lib/orderSimulator/playbackBridge';
import type { InstrumentRules } from '../../src/lib/orderSimulator/types';
import type { MarketTick } from '../../src/types';

/**
 * Execution price is the side of the book the order consumes: a BUY pays the ask, a SELL receives
 * the bid.
 *
 * The pure helpers are unchanged. The execution tests used to set a single display tick and expect an
 * immediate fill; execution now happens against the account's tape, so they seed a tape and let the
 * playhead move. That is a stricter test than before: it proves the fill price comes from the quote
 * the engine actually had at the moment the instruction arrived.
 */

const SYMBOL = 'AAPL';

const AAPL_RULES: InstrumentRules = {
  symbol: SYMBOL,
  tickSize: 0.05,
  minSize: 1,
  sizeIncrement: 1,
  priceDecimals: 2,
  contractMultiplier: 1,
  currency: 'USD',
  provenance: 'OBSERVED_SAMPLE',
};

function tick(price: number, atMs: number, bid?: number | null, ask?: number | null): MarketTick {
  return {
    time: new Date(atMs).toISOString(),
    symbol: SYMBOL,
    price,
    volume: 50,
    bid: bid ?? null,
    ask: ask ?? null,
    session: 'REG',
  };
}

function createMockRefs(overrides: Record<string, unknown> = {}) {
  return {
    chartData: [{ time: 1600000000, open: 100, high: 105, low: 95, close: 100, volume: 1000 }],
    chartContainerRef: { current: document.createElement('div') } as never,
    priceSeriesRef: { current: null } as never,
    tradePluginRef: { current: { setTrade: () => undefined } } as never,
    ...overrides,
  };
}

/**
 * Seed the shared account with a tape built from these ticks.
 *
 * The playhead is moved to the FIRST QUOTE'S OWN TIME, not to an arbitrary small number. Advancing
 * to t=2000 while the tape starts at a real Unix timestamp would leave the engine at a moment with
 * no quote at all, and an order arriving there is correctly rejected for having no price — which
 * would make this suite test the wrong thing.
 */
function seedAccount(ticks: MarketTick[]) {
  useAccountStore.getState().configure({ instruments: [AAPL_RULES], profile: trainingProfile(), sessionId: 'bidask' });
  const quotes = quotesFromTicks(ticks, SYMBOL, AAPL_RULES);
  useAccountStore.getState().registerTape(SYMBOL, quotes);
  if (quotes.length > 0) useAccountStore.getState().advanceTo(quotes[0].replayMs, 'PLAY');
  return quotes;
}

beforeEach(() => {
  usePlaybackStore.getState().reset();
});

// ---------------------------------------------------------------------------
// Pure price helpers (unchanged behaviour)
// ---------------------------------------------------------------------------

describe('getAskPrice / getBidPrice', () => {
  it('uses tick.ask and tick.bid when explicitly provided and > 0', () => {
    const t = { time: '2026-09-25 14:30:00', symbol: 'AAPL', price: 150.10, volume: 10, ask: 150.25, bid: 150.05 } as MarketTick;
    expect(getAskPrice(t, 100)).toBe(150.25);
    expect(getBidPrice(t, 100)).toBe(150.05);
  });

  it('synthesizes ask/bid with a +/-0.01 offset when ask/bid are missing but price exists', () => {
    const t = { time: '2026-09-25 14:30:00', symbol: 'AAPL', price: 150.10, volume: 10 } as MarketTick;
    expect(getAskPrice(t, 100)).toBe(150.11);
    expect(getBidPrice(t, 100)).toBe(150.09);
  });

  it('falls back to fallbackPrice when the tick is null or has no valid prices', () => {
    expect(getAskPrice(null, 100)).toBe(100);
    expect(getBidPrice(null, 100)).toBe(100);

    const invalidTick = { time: '2026-09-25 14:30:00', symbol: 'AAPL', price: 0, volume: 10 } as MarketTick;
    expect(getAskPrice(invalidTick, 100)).toBe(100);
    expect(getBidPrice(invalidTick, 100)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Execution against the account's tape
// ---------------------------------------------------------------------------

describe('BUY order execution at Ask price', () => {
  it('executes a BUY at the ask of the quote available when the instruction arrived', () => {
    const base = Date.UTC(2026, 8, 25, 14, 30, 0);
    seedAccount([tick(100.1, base), tick(100.1, base + 5_000)]);

    const { result } = renderHook(() => useTradeManager(createMockRefs({ ticker: SYMBOL })));

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(base + 5_000, 'PLAY');
    });

    expect(result.current.activeTrade).not.toBeNull();
    expect(result.current.activeTrade?.type).toBe('long');
    // The tick carried no ask, so the quote is derived with a one-tick spread; a BUY pays the ask.
    expect(result.current.activeTrade?.entryPrice).toBe(100.15);
  });

  it('pays the ask when the tick carries an explicit book', () => {
    const base = Date.UTC(2026, 8, 25, 14, 30, 0);
    seedAccount([tick(100.1, base, 100.05, 100.25), tick(100.1, base + 5_000, 100.05, 100.25)]);

    const { result } = renderHook(() => useTradeManager(createMockRefs({ ticker: SYMBOL })));

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(base + 5_000, 'PLAY');
    });

    expect(result.current.activeTrade?.entryPrice).toBe(100.25);
  });

  it('opens nothing when the tape carries no quote at all', () => {
    useAccountStore.getState().configure({ instruments: [AAPL_RULES], profile: trainingProfile(), sessionId: 'empty' });
    useAccountStore.getState().registerTape(SYMBOL, []);

    const { result } = renderHook(() => useTradeManager(createMockRefs({ ticker: SYMBOL })));

    act(() => {
      const outcome = result.current.placeOrder('long');
      // Accepted at the ticket; the broker is the one that cannot act without a price.
      expect(outcome.ok).toBe(true);
    });
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    expect(result.current.activeTrade).toBeNull();
    expect(useAccountStore.getState().state.fills).toHaveLength(0);
  });
});

describe('SELL order execution at Bid price', () => {
  it('executes a SELL at the bid', () => {
    const base = Date.UTC(2026, 8, 25, 14, 30, 0);
    seedAccount([tick(100.1, base, 100.05, 100.25), tick(100.1, base + 5_000, 100.05, 100.25)]);

    const { result } = renderHook(() => useTradeManager(createMockRefs({ ticker: SYMBOL })));

    act(() => {
      result.current.placeOrder('short');
    });
    act(() => {
      useAccountStore.getState().advanceTo(base + 5_000, 'PLAY');
    });

    expect(result.current.activeTrade?.type).toBe('short');
    expect(result.current.activeTrade?.entryPrice).toBe(100.05);
  });

  it('a BUY and a SELL on the same tape fill on opposite sides', () => {
    const base = Date.UTC(2026, 8, 25, 14, 30, 0);
    // Three quotes, because the second order needs a quote to arrive against: the tape is what
    // advancement is bounded by, and running off its end freezes the account rather than inventing
    // a price.
    seedAccount([
      tick(100.1, base, 100.05, 100.25),
      tick(100.1, base + 5_000, 100.05, 100.25),
      tick(100.1, base + 10_000, 100.05, 100.25),
    ]);

    const { result } = renderHook(() => useTradeManager(createMockRefs({ ticker: SYMBOL })));

    act(() => {
      result.current.placeOrder('long');
    });
    act(() => {
      useAccountStore.getState().advanceTo(base + 5_000, 'PLAY');
      result.current.placeOrder('short');
    });
    act(() => {
      useAccountStore.getState().advanceTo(base + 10_000, 'PLAY');
    });

    const positions = useAccountStore.getState().state.positions;
    expect(positions).toHaveLength(2);
    const long = positions.find((p) => p.direction === 'LONG')!;
    const short = positions.find((p) => p.direction === 'SHORT')!;
    expect(long.entryPrice).toBe(100.25); // paid the ask
    expect(short.entryPrice).toBe(100.05); // received the bid
  });
});
