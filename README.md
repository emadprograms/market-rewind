# Market Rewind ⏪

Market Rewind is a professional, **Local-First** market replay tool. It uses Turso's advanced WASM-based synchronization to pull data from a remote database into your browser's persistent storage (OPFS), allowing for buttery-smooth playback with minimal database overhead.

## 🏗️ Architecture

- **Local-First Sync**: Powered by `@tursodatabase/sync-wasm`, the app creates a full SQLite replica inside your browser. This means once you sync, you can work entirely offline.
- **Client-Side Processing**: All OHLCV resampling (1m → 5m, 1h, etc.) is performed in the browser, eliminating the need for a backend and saving on DB read costs.
- **Vercel Optimized**: Configured with COOP/COEP headers to support multi-threaded WASM and high-performance storage.

## 🚀 Getting Started

### Prerequisites

- A Turso (LibSQL) database populated with 1-minute market data.

### Running Locally

1. Navigate to the `frontend/` directory.
2. Install dependencies: `npm install`.
3. Create a `.env` file:
   ```env
   VITE_TURSO_DB_URL=your_db_url
   VITE_TURSO_AUTH_TOKEN=your_auth_token
   ```
4. Run the dev server: `npm run dev`.

### Using the App

1. **Click "Sync with Turso"**: This will download the remote data to your browser's local storage.
2. **Select Date & Ticker**: The app will read directly from the local replica.
3. **Playback**: Use the playback controls to rewind the market.

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite.
- **Database**: libSQL (@tursodatabase/sync-wasm).
- **Charting**: Lightweight Charts.
- **Hosting**: Vercel (Frontend only, no backend required).

## 📄 License

MIT