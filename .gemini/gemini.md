# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v3 Final Oracle)

The Market Rewind application is now a distributed, high-performance, and **Zero-Read** local-first application. There is no active backend server; instead, it uses a manual repository synchronization workflow to protect Turso read limits.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: A manual script you trigger when you want to update the master record. It performs a **single sync** from Turso and exits.
- **Data Persistence**: Uses libSQL's Embedded Replica (`market_data.db`) stored on an orphan `data-storage` branch to keep the main code branch clean.
- **Frontend (Vercel)**: React + Vite application that fetches the master file from GitHub Raw and executes all queries locally using browser OPFS.
- **Read Strategy**: **0 Turso Reads** for all end-users. Turso is only touched once during your manual data refresh.

### 🚥 Component Breakdown

#### Data Sync Logic (database/)
- [x] `sync_backend.py`: Python master sync script (Single Pull logic).
- [x] `requirements.txt`: Minimal dependencies for GitHub Action runner.
- [x] `.github/workflows/market_backend.yml`: Manual sync utility.

#### Core Application (root)
- [x] `src/lib/db.js`: Local-first client (GitHub Raw -> OPFS).
- [x] `App.jsx`: Premium Replay UI with "Fetch latest from GitHub" master refresh.
- [x] `index.css`: Glassmorphism design system.
- [x] `vercel.json`: Mandatory COOP/COEP headers for WASM.
- [x] `vite.config.js`: Root-level build configuration.

---
*Last Update: 2026-04-12*
 Greenland
