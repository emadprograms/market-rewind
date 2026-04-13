# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v5.6 - UI Fixes & Dropdown Stability)

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
- [x] `src/App.jsx`:
    - **Trade Ticker Selection**: Added a focus ticker selector to the landing page.
    - **Default Dual-Chart Layout**: Set `gridSize` to 2 by default.
    - **Smart Initialization**: Configures a dual-perspective setup upon launch.
- [x] `src/components/ChartUnit.jsx`:
    - **Premium UI (Option B)**: Custom glassmorphism dropdowns with symbol search and refined aesthetics.
    - **Dropdown Stability Fix**: Implemented `e.stopPropagation()` on toggle buttons to prevent race conditions with the global click-outside listener.
    - **initialEth Prop**: Supports pre-configuring chart sessions with Extended Trading Hours visible.
    - **Forced RTH for Daily**: Daily bars ignore ETH toggle to ensure official session data accuracy.
- [x] `src/index.css`:
    - **Dropdown Positioning Fix**: Added `position: relative` to `.custom-dropdown-container` to correctly anchor absolute-positioned menus to their buttons.
    - **UI Recovery**: Restored baseline input/select styles to fix broken sidebars.

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.
- **Backend**: `libsql` (Python).

---
> **🚨 MANDATORY SYSTEM DIRECTIVE**
> **Whenever ANY code change, feature addition, bug fix, or architectural modification is made to this project, this `gemini.md` file MUST be updated to reflect the new state, regardless of whether the user explicitly asks for it or not.**

---
*Last Update: 2026-04-13*
