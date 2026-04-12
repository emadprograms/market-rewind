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

#### Root Directory
- `src/`: Core React application logic.
- `database/`: Master sync script and local database logic.
- `.github/workflows/`: Autonomous backend sync automation.
- `index.html`, `package.json`, `vite.config.js`: App configuration.
- `vercel.json`: Vercel security and routing.
- `gemini.md`: Project status.

---
*Last Update: 2026-04-12*
 Greenland
