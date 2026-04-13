# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v6.0 - High Density Terminal)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs, avoiding network fetching errors, and bypassing Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS**.
- **Read Strategy**: **Distributed Chart-Level Fetching**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/App.jsx`:
    - **Maximized Logic**: Supports deep-focus views.
- [x] `src/components/ChartUnit.jsx`:
    - **True Full Screen Mode**: Fills window while keeping playback controls accessible at the bottom.
    - **Perception-Aware Initial Zoom**: Timeframe-specific candle thickness.
- [x] `src/index.css`:
    - **High-Density Workspace**: Gaps and padding reduced to an absolute minimum of **3px**.
    - **Ultra-Slim Playback Bar**: Height reduced to **48px** with prioritized `z-index` to remain visible during full-screen analysis.

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.

---
*Last Update: 2026-04-13*
