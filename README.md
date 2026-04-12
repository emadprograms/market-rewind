# Market Rewind ⏪

Market Rewind is a high-performance market replay tool designed for traders to practice and backtest strategies. It features a modern, premium web interface and a managed data ingestion pipeline.

## 🏗️ Architecture

- **Frontend**: A high-performance Vite + React application optimized for Vercel. Performs real-time resampling of 1-minute data in the browser to minimize database costs.
- **Backend**: A Python-based ingestion engine running as a GitHub Action. Fetches 1-minute historical data from Yahoo Finance and populates the Turso database.
- **Database**: Turso (LibSQL) serves as the persistent store for all market data.

## 🚀 Getting Started

### Backend (Data Ingestion)

The backend runs automatically via GitHub Actions.
1. Add `TURSO_DB_URL` and `TURSO_AUTH_TOKEN` to your GitHub Repository Secrets.
2. The workflow in `.github/workflows/backend_runner.yml` will keep your database updated every 30 minutes during market hours.

### Frontend (React App)

To run the frontend locally:
1. Navigate to the `frontend/` directory.
2. Install dependencies: `npm install`.
3. Create a `.env` file with your Turso credentials:
   ```env
   VITE_TURSO_DB_URL=your_db_url
   VITE_TURSO_AUTH_TOKEN=your_auth_token
   ```
4. Run the dev server: `npm run dev`.

## 🛠️ Tech Stack

- **UI**: React, Lightweight Charts, Lucide Icons, Vanilla CSS (Glassmorphism).
- **Processing**: Client-side OHLCV resampling engine.
- **Ingestion**: Python, yfinance, GitHub Actions.
- **Hosting**: Vercel (Frontend), GitHub (Backend).

## 📄 License

MIT