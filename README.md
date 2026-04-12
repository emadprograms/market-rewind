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

1. Install dependencies: `npm install`.
2. Run the dev server: `npm run dev`.

### Using the App

1. **Trigger Data Sync**: Manually trigger the GitHub Action "Market Rewind Backend" in the Repository to update the initial DB.
2. **Click "Fetch latest from GitHub"**: This will download the remote data to your browser's local storage.
3. **Select Date & Ticker**: The app will read directly from the local replica.
4. **Playback**: Use the playback controls to rewind the market.

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite.
- **Database**: libSQL (@tursodatabase/sync-wasm).
- **Charting**: Lightweight Charts.
- **Hosting**: Vercel (Static Site).

## 📄 License

MIT