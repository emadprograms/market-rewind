# Market Rewind ⏪

Market Rewind is a professional, **Local-First** market replay tool. It uses Turso's advanced WASM-based synchronization to pull data from a remote database into your browser's persistent storage (OPFS), allowing for buttery-smooth playback with minimal database overhead.

## 🏗️ Architecture

- **Local-First Sync**: Powered by `@tursodatabase/sync-wasm`, the app creates a full SQLite replica inside your browser. This means once you sync, you can work entirely offline.
- **Client-Side Processing**: All OHLCV resampling (1m → 5m, 1h, etc.) is performed in the browser, eliminating the need for a backend and saving on DB read costs.
- **Vercel Optimized**: Configured with COOP/COEP headers to support multi-threaded WASM and high-performance storage.

## 🚀 Getting Started

### Getting Started

#### Prerequisites
- A Turso (LibSQL) database populated with 1-minute market data.

#### Running Locally
1. Install dependencies: `npm install`.
2. Run the dev server: `npm run dev`.

### Managing the Database(s)

Market Rewind relies on two separate synchronization mechanisms managed in the `backend/` directory:

1. **App Database (`backend/app_db_sync/`)**
   - Automatically triggered via the "Sync Local Database" GitHub Action.
   - Syncs the lightweight production data from Turso and publishes it as the `latest-data` GitHub Release.
   - The React frontend fetches this release on load.

2. **Historical Data Archive (`backend/historical_archiver/`)**
   - A heavy-duty worker engine to backfill historical 1-minute OHLCV data from Polygon.io.
   - Triggered via the "Stock Data Archiver" GitHub Action, with configurable date ranges.
   - Optionally syncs the deep archive to the `latest-archive` GitHub Release for local inspection.

### Using the App
1. **Trigger Data Sync**: Execute the "Sync Local Database" workflow in GitHub Actions to update the `latest-data` release.
2. **Fetch in Browser**: In the Market Rewind UI, click "Fetch latest from GitHub" to download the remote data to your browser's persistent storage.
3. **Select Date & Ticker**: The app reads directly from your private local replica.
4. **Playback**: Use the playback controls to rewind the market.

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Lightweight Charts.
- **Backend/Scripts**: Python 3.12 (app db sync & archiver API workers), Infisical (Secrets).
- **Database**: libSQL (@tursodatabase/sync-wasm), Turso.
- **Hosting**: Vercel (Static Site).

## 📄 License

MIT