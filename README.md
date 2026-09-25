# Market Rewind ⏪

Market Rewind is a professional, high-performance market replay and order flow analysis tool featuring **institutional-grade tick-by-tick streaming** and local-first architecture.

Milestone **v2.0** connects Market Rewind directly to the `data-harvester` repository's dedicated DuckDB databases (`streaming.duckdb` with 40M+ ticks and `historical.duckdb` with 8.8M+ candles), unlocking sub-second timeframes (`1s`, `5s`, `15s`, `30s`), real-time candle synthesis, and a live Time & Sales order flow tape.

---

## ⚡ Key Features

- **Direct DuckDB Integration**: Connects read-only and zero-copy to `../data-harvester/data/streaming.duckdb` (40.9M+ ticks across 30+ symbols like `NVDA`, `AAPL`, `AMZN`, `MU`, `MSFT`, `GOOGL`, `TSLA`, `QQQ`) and `historical.duckdb`.
- **Tick-by-Tick Replay Engine**:
  - Millisecond-accurate replay clock with play, pause, seek, and single-tick stepping (step forward, step backward).
  - Variable speed multipliers: `0.5x`, `1x`, `2x`, `5x`, `10x`, `25x`, `50x`, `100x`.
  - Interactive scrub slider across all buffered ticks.
  - Mode toggle: **TICK** mode (raw tick-by-tick prints) or **BAR** mode (aggregated candles).
- **Dynamic Real-Time Candle Synthesis**: Incoming ticks dynamically update the current candle's open, high, low, close, volume, and tick count in real-time on the chart without lag.
- **Time & Sales (Tape) Panel**: Collapsible live order flow tape displaying print timestamp, price, volume size, bid/ask spread, with real-time green uptick / red downtick coloring and active tick centering.
- **Sub-Second Timeframes**: Native support for `1s`, `5s`, `15s`, `30s` alongside standard `1m`, `5m`, `15min`, `30min`, `1H`, and `1D` candles.
- **Multi-Chart Synchronization**: Synchronized tick and timeframe replay across grouped charts (red, blue, green, yellow groups).
- **Graceful Fallbacks**: Automatically auto-detects the DuckDB streaming service on startup with instant fallback to local SQLite / OPFS if offline.

---

## 🏗️ Architecture

```
market-rewind/
├── backend/streaming_service/     # Python DuckDB service (REST + WebSocket)
│   ├── duckdb_client.py           # Read-only DuckDB client for streaming.duckdb & historical.duckdb
│   ├── server.py                  # aiohttp async server (/api/status, /api/symbols, /api/ticks, /api/candles, /ws/replay)
│   └── tests/                     # Backend pytest unit and API tests
├── src/
│   ├── components/
│   │   ├── TimeAndSales.tsx       # Live Time & Sales order flow tape widget
│   │   ├── PlaybackBar.tsx        # Tick/Bar playback controller & scrubber
│   │   ├── ChartHeader.tsx        # Symbol and sub-second timeframe switcher
│   │   └── ChartUnit.tsx          # Multi-chart display unit
│   ├── hooks/
│   │   ├── useChartData.ts        # Dynamic candle fetch & live tick synthesis
│   │   └── useDatabase.ts         # Dual-mode DuckDB streaming + SQLite detection
│   ├── lib/
│   │   ├── candleSynthesizer.ts   # Dynamic tick-to-candle math across all timeframes
│   │   ├── streamingClient.ts     # Frontend REST/WebSocket API client
│   │   └── resampling.ts          # Sub-second and minute OHLCV resampling
│   └── store/
│       └── usePlaybackStore.ts    # Replay clock, tick buffer & transport state
```

---

## 🚀 Quick Start

### 1. Start the DuckDB Streaming Backend Service
The backend service connects directly to `../data-harvester/data/streaming.duckdb` on port 8765:
```bash
npm run backend
```
*(Runs with Python 3.12 using the virtualenv in `../data-harvester/.venv` or local Python).*

### 2. Start the Frontend Dev Server
In another terminal:
```bash
npm run dev
```
Navigate to `http://localhost:3000` (or `http://localhost:5173`). The app will automatically connect to the streaming service, display the active symbol count and 40M+ tick inventory, and enable tick-by-tick replay!

---

## 🧪 Testing

Run all unit, performance, and integration tests:

```bash
# Frontend Vitest test suite (95 tests across 24 test files)
npm test

# Backend Pytest test suite (10 tests)
npm run backend:test

# Production build check
npm run build
```

---

## 📄 License
MIT