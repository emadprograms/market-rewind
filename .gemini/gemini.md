# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v4 Production - Final)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs and Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger. Pulls from Turso once using libSQL, then uploads `market_data.db` as a **GitHub Release** asset (bypasses 100MB Git limit, supports up to 2GB).
- **Data Storage**: GitHub Releases (`latest-data` tag). 
- **WASM Engine**: **sql.js** (Self-hosted). The WASM binary is copied to `public/` via a `postinstall` script to guarantee reliability on Vercel without CDN dependencies.
- **Frontend Persistence**: Uses Browser **OPFS** (Origin Private File System) for lightning-fast database access.
- **Read Strategy**: **0 Turso Reads** for end-users. Turso is only touched during your manual sync.

### 🚥 Component Breakdown

#### Data Sync Logic (database/)
- [x] `sync_backend.py`: Python master sync script (Single Pull logic).
- [x] `.github/workflows/market_backend.yml`: Manual sync utility with GitHub CLI release management.

#### Core Application (root)
- [x] `src/lib/db.js`: Auto-loading client. Checks OPFS cache first, falls back to GitHub Release download.
- [x] `src/App.jsx`: Clean Replay UI with auto-load state and today's date default.
- [x] `package.json`: `postinstall` script for self-hosting standard WASM binary.
- [x] `vite.config.js`: Configured to exclude `sql.js` from pre-bundling to ensure stable WASM resolution.
- [x] `vercel.json`: Standard SPA routing (COOP/COEP removed as they are no longer required for sql.js).

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.
- **Backend**: `libsql` (Python).

---
*Last Update: 2026-04-13*
