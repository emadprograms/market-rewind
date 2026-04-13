# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v6.1 - Refined Perceptual Zoom)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs, avoiding network fetching errors, and bypassing Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS**.
- **WASM Engine**: **sql.js**.
- **Read Strategy**: **Distributed Chart-Level Fetching**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/components/ChartUnit.jsx`:
    - **Perception-Aware Initial Zoom (Fixed)**: Implemented a 50ms stabilization delay to ensure zoom is applied correctly after data load. Adjusted 1D zoom to **80 bars** for weightier, more readable candles.
    - **True Full Screen Mode**: Fills window while keeping playback controls accessible at the bottom (48px bar).
    - **Ergonomic Header**: Compact, functional controls.
- [x] `src/App.jsx`:
    - **Maximized Logic**: Supports deep-focus views.
- [x] `src/index.css`:
    - **High-Density Workspace**: Gaps and padding reduced to **3px**.
    - **Ultra-Slim Playback Bar**: Height reduced to **48px**.

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.

---
*Last Update: 2026-04-13*
