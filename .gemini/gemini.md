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
- [x] `src/lib/timezones.js`:
    - **Dynamic Ticker-Based Detection**: New classification utility that heuristically distinguishes between US Stocks (mapped to `America/New_York`) and Global Assets like ETFs or Crypto (mapped to `UTC`).
- [x] `src/lib/db.js`:
    - Provides Manual Upload parser that writes `.db` ArrayBuffer into OPFS.
    - Extracts `tickers` via guaranteed dynamic `SELECT DISTINCT symbol` query.
    - Fetches historical chart data inclusive of all previous available days `timestamp <= [selectedDate] 23:59:59` to render broader context.
- [x] `src/App.jsx`:
    - **Anti-Bias Session Entry**: A full-screen glassmorphism landing overlay explicitly demands a Target Date and Start Time (defaults to 13:29 UTC) before rendering any charts. The app's global clock and entry labels now dynamically switch between UTC and ET based on the primary ticker.
    - **Toggleable Sidebar UI**: Contains File UI, Grid Selection, Reset Session logic, and explicit GitHub external URL.
    - **Intuitive Toggles**: Features a 'Collapse' button inside the sidebar and a floating 'Expand' button in the workspace for 100% full-screen chart focus.
- [x] `src/components/ChartUnit.jsx`:
    - **Premium UI (Option B)**: Completely custom, div-based glassmorphism header UI.
    - **Dynamic Symbol Search**: Interactive ticker dropdown that includes a search input for filtering and selecting securities instantly.
    - **Bespoke Dropdowns**: Custom-built timeframe selectors with high-contrast hover effects and clean typography.
    - **Custom Session Switch**: Replaced native checkbox toggles with a professional animated switch for the ETH session state.
    - **Single-Pane Volume Separation**: Reverted to a high-performance single-chart architecture but mathematically scaled volume to perfectly occupy the bottom 25% of the chart without overlapping price candles.
    - **Per-Chart Dynamic TZ**: Each chart unit independently localized its X-axis and price-line crosshair labels to the specific timezone of its ticker (ET for Stocks, UTC for ETFs/Crypto).
    - **Default Timeframe (1D)**: All new charts now initialize to the Daily timeframe by default to provide immediate high-level market context.
    - **Forced RTH for Daily**: Implemented a strict logic where the **1D** timeframe ignores the ETH toggle and always calculates OHLCV data using Regular Trading Hours (RTH) records only.
    - **Responsive Canvas Sizing**: Implemented a localized `ResizeObserver` on the chart container for instant responsiveness.
    - **Automatic Price Scaling**: Implemented a forced re-scaling logic that resets the vertical price axis whenever a symbol changes.
- [x] `src/lib/resampling.js`:
    - **Timeframe Aggregation**: Implemented robust logic to compile 5m, 15m, 30m, 1H, and 1D OHLCV bars from raw 1-minute records.
- [x] `src/index.css`:
    - **Custom Dropdown Palette**: Added specialized styling for floating glassmorphism menus, including z-index management, animated entry transitions, and custom scrollbars.
    - **Vertical Grid Stretching**: Explicitly defined `grid-template-rows: 1fr` across all multi-chart layout variants (1, 2, 3, and 4 charts).
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
