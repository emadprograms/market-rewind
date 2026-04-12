# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v4 Production)

Market Rewind is a zero-read, local-first market replay tool. There is no active backend server. Data is synced manually via GitHub Actions and served to users as a static file download.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger. Pulls from Turso once using libSQL embedded replicas, then uploads `market_data.db` as a **GitHub Release** asset (bypasses the 100MB Git file limit, supports up to 2GB).
- **Data Storage**: GitHub Releases (`latest-data` tag). Not stored in Git history or branches.
- **App (Vercel)**: React + Vite. Downloads the `.db` file from the GitHub Release URL, saves it to browser OPFS, and queries it locally using **sql.js** (SQLite compiled to WASM).
- **Read Strategy**: **0 Turso Reads** for all end-users. Turso is only touched once during your manual sync.

### 🚥 Component Breakdown

#### Data Sync Logic (database/)
- [x] `sync_backend.py`: Python script using `libsql` (single pull, then exit).
- [x] `requirements.txt`: `libsql` only.
- [x] `.github/workflows/market_backend.yml`: Manual dispatch, uploads to GitHub Releases.

#### Core Application (root)
- [x] `src/lib/db.js`: Local-first client using `sql.js`. Fetches from GitHub Releases → OPFS → local SQL queries.
- [x] `src/App.jsx`: Replay UI with "Fetch latest from GitHub" button.
- [x] `src/index.css`: Glassmorphism design system.
- [x] `vercel.json`: COEP (`credentialless`) + COOP headers. Rewrites for SPA routing.
- [x] `vite.config.js`: Root-level build configuration.

### 📦 Key Dependencies
- **Frontend**: `sql.js`, `lightweight-charts`, `lucide-react`, `react`
- **Backend (GitHub Action only)**: `libsql` (Python)

---
*Last Update: 2026-04-13*
