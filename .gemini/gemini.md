# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v2 Oracle Architecture)

The Market Rewind application has been completely rebuilt as a distributed, high-performance, and **Zero-Read** local-first application.

### 🏗️ Architecture Map
- **Backend (GitHub Actions)**: Manual trigger with duration input. Performs a single pull from Turso and then maintains an autonomous sync-and-push loop to an orphan `data-storage` branch.
- **Data Persistence**: Uses libSQL's Embedded Replica (`market_data.db`) force-pushed to GitHub.
- **Frontend (Vercel)**: React + Vite application that fetches the master DB from GitHub Raw and executes all queries locally using OPFS.
- **Read Strategy**: **0 Turso Reads** for all end-users. Turso is only touched by the manual GitHub Action.

### 🚥 Component Breakdown

#### Backend (database/)
- [x] `sync_backend.py`: Python master sync script using `libsql-client`.
- [x] `requirements.txt`: Minimal dependencies for GitHub Action runner.
- [x] `.github/workflows/market_backend.yml`: Manual dispatcher with duration input.

#### Frontend (frontend/)
- [x] `lib/db.js`: Local-first client using `@tursodatabase/database-wasm`.
- [x] `App.jsx`: Premium Replay UI with "Refresh from GitHub" logic.
- [x] `index.css`: Glassmorphism design system.
- [x] `vercel.json`: Mandatory COOP/COEP headers.

---
*Last Update: 2026-04-12*
