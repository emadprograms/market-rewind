# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v3 Final Oracle - Simplified)

The Market Rewind application is now a distributed, high-performance, and **Zero-Read** local-first application, strictly optimized for Turso read-limit protection.

### 🏗️ Architecture Map
- **Backend (GitHub Action)**: Manual utility. Performs a **single master sync** from Turso and exits. It is only run when you want to update the master data file.
- **Data Persistence**: Uses libSQL's Embedded Replica (`market_data.db`) force-pushed to an orphan `data-storage` branch to keep the main repo clean.
- **Frontend (Vercel)**: React + Vite application that fetches the master file from GitHub Raw and executes all queries locally using OPFS.
- **Read Strategy**: **0 Turso Reads** for all end-users. Turso is only touched once during your manual refresh.

### 🚥 Component Breakdown

#### Backend (database/)
- [x] `sync_backend.py`: Python master sync script (Single Pull logic).
- [x] `requirements.txt`: Minimal dependencies for GitHub Action runner.
- [x] `.github/workflows/market_backend.yml`: Manual sync utility (No idle session).

#### Frontend (frontend/)
- [x] `lib/db.js`: Local-first client (GitHub Raw -> OPFS).
- [x] `App.jsx`: Premium Replay UI with "Fetch from GitHub" master refresh.
- [x] `index.css`: Glassmorphism design system.
- [x] `vercel.json`: Mandatory COOP/COEP headers for WASM.

---
*Last Update: 2026-04-12*
 Greenland
