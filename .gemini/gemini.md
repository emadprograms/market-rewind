# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v4.5 - Manual Upload Architecture)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs, avoiding network fetching errors, and bypassing Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger. Pulls from Turso once using libSQL, then uploads `market_data.db` as a **GitHub Release** asset.
- **Frontend Storage**: Uses Browser **OPFS** (Origin Private File System) for lightning-fast database access.
- **Manual Upload Workflow**: Instead of automatic fetching (which caused massive CORS/Vite/CDN/Vercel failures), the user downloads the latest release and manually uploads the `.db` file into the sidebar UI once. OPFS persists it across sessions.
- **WASM Engine**: **sql.js** (Self-hosted). The engine is initiated by directly passing the WASM binary data from fetch into `initSqlJs({ wasmBinary })`, which bypasses Vite's aggressive bundle rewriting that breaks `locateFile`.
- **Read Strategy**: **Distributed Chart-Level Fetching**. Each `ChartUnit` is responsible for fetching its own raw data based on its locally selected symbol. `App.jsx` handles global time synchronization using a reference ticker.
- **Data Storage**: **0 Turso Reads** for end-users. Turso is only touched during your manual sync.

### 🚥 Component Breakdown

#### Data Sync Logic (`database/`)
- [x] `sync_backend.py`: Python master sync script (Single Pull logic).
- [x] `.github/workflows/market_backend.yml`: Manual sync utility with GitHub CLI release management.

#### Core Application (`src/`)
- [x] `src/lib/db.js`:
    - Provides Manual Upload parser that writes `.db` ArrayBuffer into OPFS.
    - Extracts `tickers` via guaranteed dynamic `SELECT DISTINCT symbol` query.
    - Fetches historical chart data inclusive of all previous available days `timestamp <= [selectedDate] 23:59:59` to render broader context.
- [x] `src/App.jsx`:
    - **Toggleable Sidebar UI**: Contains File UI, Grid Selection, and explicit GitHub external URL.
    - **Intuitive Toggles**: Features a 'Collapse' button inside the sidebar and a floating 'Expand' button in the workspace for 100% full-screen chart focus.
    - **Playhead Safety**: Initializes Replay `currentTime` to exactly 09:30 AM on the explicitly selected date, despite the larger payload of historical data.
- [x] `src/components/ChartUnit.jsx`:
    - **Multi-Pane Architecture**: Refactored to a dual-chart system where Price and Volume reside in separate, synchronized panes (75/25 split). X-axes are locked together.
    - **Automatic Price Scaling**: Implemented a forced re-scaling logic that resets the vertical price axis whenever a symbol changes, ensuring that switching between stocks with different price levels (e.g. AAPL vs AMD) always auto-centers the data.
    - Applies a **Strict UTC Parsing Strategy** across data handling and LightweightCharts localization formats so UTC timestamps from the DB display correctly regardless of the user's physical timezone.
    - **Volume Visualization**: Moved to a dedicated pane with its own scaling to prevent price action overlap.
    - **Smooth Replay Engine**: Implemented an incremental `.update()` logic and explicitly disabled `shiftVisibleRangeOnNewBar` while adding a 15-bar `rightOffset`. This prevents the viewport from snapping to the right edge during replay, preserving the user's custom zoom/scroll position and giving price action breathing room.
- [x] `src/lib/resampling.js`:
    - **Timeframe Aggregation**: Implemented robust logic to compile 5m, 15m, 30m, 1H, and 1D OHLCV bars from raw 1-minute records while maintaining format compatibility with the replay engine.
- [x] `package.json`: `postinstall` script securely caches standard WASM binary.
- [x] `vite.config.js`: Excludes `sql.js` from pre-bundling.

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.
- **Backend**: `libsql` (Python).

---
*Last Update: 2026-04-13*
