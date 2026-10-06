# Market Rewind ⏪

Market Rewind is a professional, high-performance market replay and order flow analysis tool featuring **institutional-grade tick-by-tick streaming** and local-first architecture.

Milestone **v5.0** reads Data Harvester's **partitioned Parquet tick lake** in compliance with the Repo B read contract (v1.5.0): no disk database, no file locks — queries run on isolated in-memory DuckDB sessions with filesystem-level partition pruning. This unlocks sub-second timeframes (`1s`, `5s`, `15s`, `30s`), deterministic candle resampling, and a live Time & Sales order flow tape.

---

## ⚡ Key Features

- **Partitioned Parquet Tick Lake**: Reads `../data-harvester/data/tick_lake` — symbol/date partitions resolved and pruned on the filesystem, percent-encoded symbol directories (`BRK.B` → `BRK%2EB`), structured fail-fast errors (`LakeUnavailable`, `LakeCorruptedMetadata`, `LakeIncompatibleSchema`, `LakeMaintenanceInProgress`), and dual physical schemas (v1 `price`/`volume`, v2 `bid_price`/`ask_price`) coalesced at query time.
- **Tick-by-Tick Replay Engine**:
  - Millisecond-accurate replay clock with play, pause, seek, and single-tick stepping (step forward, step backward).
  - Variable speed multipliers: `0.5x`, `1x`, `2x`, `5x`, `10x`, `25x`, `50x`, `100x`.
  - Interactive scrub slider across all buffered ticks.
  - Mode toggle: **TICK** mode (raw tick-by-tick prints) or **BAR** mode (aggregated candles).
- **Dynamic Real-Time Candle Synthesis**: Incoming ticks dynamically update the current candle's open, high, low, close, volume, and tick count in real-time on the chart without lag.
- **Time & Sales (Tape) Panel**: Collapsible live order flow tape displaying print timestamp, price, volume size, bid/ask spread, with real-time green uptick / red downtick coloring and active tick centering.
- **Sub-Second Timeframes**: Native support for `1s`, `5s`, `15s`, `30s` alongside standard `1m`, `5m`, `15min`, `30min`, `1H`, and `1D` candles.
- **Multi-Chart Synchronization**: Synchronized tick and timeframe replay across grouped charts (red, blue, green, yellow groups).
- **Offline-aware Boot**: Auto-detects the local streaming service at startup and shows a clear "start the service" state (with symbol/tick inventory when connected) instead of failing when it is offline.

---

## 🏗️ Architecture

```
market-rewind/
├── backend/streaming_service/     # Python DuckDB service (REST + WebSocket)
│   ├── tick_lake_reader.py        # Standalone lake reader: partition pruning, schema validation, structured errors
│   ├── duckdb_client.py           # Service adapter: in-memory DuckDB queries over the Parquet tick lake
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
│   │   └── useDatabase.ts         # Streaming-service detection and inventory state
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
The backend service serves the partitioned Parquet tick lake (discovered via `TICK_LAKE_ROOT`, `$DATA_DIR/tick_lake`, or the sibling `../data-harvester/data/tick_lake`) on port 8765:
```bash
npm run backend
```
*(Runs with Python 3.12 using the virtualenv in `../data-harvester/.venv` or local Python).*

### 2. Start the Frontend Dev Server
In another terminal:
```bash
npm run dev
```
Navigate to `http://localhost:3000` (or `http://localhost:5173`). The app will automatically connect to the streaming service, display the connected lake's symbol and tick inventory, and enable tick-by-tick replay.

---

## 🧪 Testing

Run all unit, performance, and integration tests:

```bash
# Frontend Vitest suite — 81 files / 422 tests (jsdom, fully mocked)
npm test

# Backend Pytest suite — 219 passed, 1 skipped (real lake test is TICK_LAKE_ROOT-gated)
npm run backend:test

# Production build check
npm run build

# Browser end-to-end "replay journey" suite (fully mocked; needs a Chromium install)
npx playwright install chromium && npm run test:journey
```

---

## 📄 License
MIT