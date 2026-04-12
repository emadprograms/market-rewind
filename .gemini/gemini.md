# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v4.5 - Manual Upload Architecture)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs, avoiding network fetching errors, and bypassing Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger. Pulls from Turso once using libSQL, then uploads `market_data.db` as a **GitHub Release** asset.
- **Frontend Storage**: Uses Browser **OPFS** (Origin Private File System) for lightning-fast database access.
- **Manual Upload Workflow**: Instead of automatic fetching (which caused massive CORS/Vite/CDN/Vercel failures), the user downloads the latest release and manually uploads the `.db` file into the sidebar UI once. OPFS persists it across sessions.
- **WASM Engine**: **sql.js** (Self-hosted). The engine is initiated by directly passing the WASM binary data from fetch into `initSqlJs({ wasmBinary })`, which bypasses Vite's aggressive bundle rewriting that breaks `locateFile`.
- **Read Strategy**: **0 Turso Reads** for end-users. Turso is only touched during your manual sync.

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
    - Applies a **UTC Proxy Parsing Hack** across data handling and LightweightCharts localization formats so "Eastern Time" strings from the DB display strictly correctly regardless of the user's physical timezone.
    - **Volume Visualization**: Includes a secondary histogram series for volume, mapped and colored relative to price action, with dedicated vertical scaling.
- [x] `package.json`: `postinstall` script securely caches standard WASM binary.
- [x] `vite.config.js`: Excludes `sql.js` from pre-bundling.

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.
- **Backend**: `libsql` (Python).

---
*Last Update: 2026-04-13*
