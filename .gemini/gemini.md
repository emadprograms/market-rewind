# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v5.9 - Perception-Aware Zoom)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs, avoiding network fetching errors, and bypassing Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS**.
- **WASM Engine**: **sql.js** (Self-hosted).
- **Read Strategy**: **Distributed Chart-Level Fetching**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/components/ChartUnit.jsx`:
    - **Perception-Aware Initial Zoom**: Implemented logic that calculates the optimal candle thickness based on timeframe (e.g., 78 bars for 5m, 120 bars for 1D) to maintain visual consistency.
    - **True Full Screen Mode**: Fills entire window on maximize.
    - **Ergonomic Header**: Compact, functional controls.
- [x] `src/App.jsx`:
    - **Maximized Logic**: Toggles focus view.
- [x] `src/index.css`:
    - **Ultra-Compact Workspace**: 4px gaps.
    - **Slim Playback Bar**: 56px height.

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.

---
*Last Update: 2026-04-13*
