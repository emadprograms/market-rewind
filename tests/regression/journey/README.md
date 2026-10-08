# Replay Journey — offline Playwright suite

An extensive, fully-mocked Playwright suite that walks through **everything a
user does to replay a chart** in Market Rewind — no DuckDB backend and no real
market data required.

## The user journey under test

1. **Open the website** → the app connects to the (mocked) streaming service.
2. **Enter the date you want to replay** → pick a ticker, target date, and the
   09:10 ET entry anchor.
3. **The chart opens with all the previous days before it**, and **stops at
   09:10 AM** of the target day (strict temporal isolation — no look-ahead).
4. **Click PLAY** → the chart plays timewise; the clock advances, candles form,
   and the Time & Sales tape streams.
5. **Click BUY / SELL** → orders are placed and the **live updates reflect the
   change** (trade badge, unrealized PnL, realized PnL).

## How it stays offline

`tests/regression/mocks/` intercepts every REST call the app makes with
`page.route`, serving a deterministic synthetic market:

| File | Responsibility |
| --- | --- |
| `marketSimulator.ts` | Seeded random-walk price series → raw ticks + OHLCV candles at any timeframe. Pure function of `(symbol, date)`. |
| `apiMock.ts` | `installApiMocks(page, options)` wires `/api/status`, `/api/symbols`, `/api/ticks`, `/api/candles`, `/api/streaming/candles`, `/api/stream/tape`. Supports `offline`, `emptyMarket`, `latencyMs`. |
| `replayJourney.ts` | Intention-revealing helpers: `openWebsite`, `enterReplayDate`, `beginReplay`, `pressPlay`, `buyButton`, `readPlaybackState`, `readBadgePnL`, `seekScrubber`, … |

## Specs

| Spec | Covers |
| --- | --- |
| `01-boot.spec.ts` | Boot, backend connection, offline guidance, read-only traffic. |
| `02-session-config.spec.ts` | Date/ticker/entry-time entry, 09:10 anchor, start/end session. |
| `03-historical-context.spec.ts` | Previous days load on the intraday + daily charts. |
| `04-temporal-isolation.spec.ts` | Stops at 09:10; no afternoon/EOD candle leaks. |
| `05-playback-transport.spec.ts` | Play/pause, time advance, speed, step, scrub, reset. |
| `06-live-replay.spec.ts` | Live clock/price, candle synthesis, Time & Sales tape. |
| `07-trading.spec.ts` | Buy/sell, sizing, add, partial/full close, flip, badge, PnL. |
| `08-trading-live.spec.ts` | Live unrealized/realized PnL reflect price movement during playback. |
| `09-edge-cases.spec.ts` | Weekend/holiday, empty market, sub-second timeframe, latency, full smoke run. |

## Running

```bash
# Standalone (mocked — no backend needed), boots Vite automatically:
npx playwright test -c playwright.journey.config.ts

# Or via npm:
npm run test:journey
```

The specs also run under the default `playwright.config.ts` (they are
self-mocking, so they pass with or without a live backend).
