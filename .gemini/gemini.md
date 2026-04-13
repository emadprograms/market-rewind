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
    - **Anti-Bias Session Entry**: A full-screen glassmorphism landing overlay explicitly demands a Target Date and Start Time (defaults to 13:29 UTC) before rendering any charts, comprehensively preventing look-ahead bias. The app uses a 24-hour clock throughout.
    - **Toggleable Sidebar UI**: Contains File UI, Grid Selection, Reset Session logic, and explicit GitHub external URL.
    - **Intuitive Toggles**: Features a 'Collapse' button inside the sidebar and a floating 'Expand' button in the workspace for 100% full-screen chart focus.
- [x] `src/components/ChartUnit.jsx`:
    - **Single-Pane Volume Separation**: Reverted to a high-performance single-chart architecture but mathematically scaled volume to perfectly occupy the bottom 25% of the chart without overlapping price candles. This preserves 100% fluid, kinetic panning and zooming physics natively.
    - **Responsive Canvas Sizing**: Implemented a localized `ResizeObserver` on the chart container. Whenever the sidebar is expanded or minimized, the chart dynamically re-calculates its own dimensions to instantly fill 100% of the newly available real estate without waiting for a global window resize event.
    - **Automatic Price Scaling**: Implemented a forced re-scaling logic that resets the vertical price axis whenever a symbol changes, ensuring that switching between stocks always auto-centers the data.
    - Applies a **Strict UTC Parsing Strategy** across data handling and LightweightCharts localization formats so UTC timestamps from the DB display correctly regardless of the user's physical timezone.
    - **Smooth Replay Engine**: Implemented an incremental `.update()` logic and explicitly disabled `shiftVisibleRangeOnNewBar` while adding a 15-bar `rightOffset`. This prevents the viewport from snapping to the right edge during replay, preserving the user's custom zoom/scroll position and giving price action breathing room.
- [x] `src/lib/resampling.js`:
    - **Timeframe Aggregation**: Implemented robust logic to compile 5m, 15m, 30m, 1H, and 1D OHLCV bars from raw 1-minute records while maintaining format compatibility with the replay engine.
- [x] `package.json`: `postinstall` script securely caches standard WASM binary.
- [x] `vite.config.js`: Excludes `sql.js` from pre-bundling.

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.
- **Backend**: `libsql` (Python).

---
> **🚨 MANDATORY SYSTEM DIRECTIVE**
> **Whenever ANY code change, feature addition, bug fix, or architectural modification is made to this project, this `gemini.md` file MUST be updated to reflect the new state, regardless of whether the user explicitly asks for it or not.**

---
*Last Update: 2026-04-13*
