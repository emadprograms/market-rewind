# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v6.3 - Ultra-Slim Grid Resilience)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs, avoiding network fetching errors, and bypassing Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS**.
- **WASM Engine**: **sql.js**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/App.jsx`:
    - **Maximized Logic**: Deep-focus view.
- [x] `src/components/ChartUnit.jsx`:
    - **True Full Screen Mode**: Fills window while keeping 40px playback bar visible.
    - **Perception-Aware Initial Zoom**: 50-bar Daily view.
- [x] `src/index.css`:
    - **Grid-4 Resilience**: Implemented `min-height: 0` and `height: 0; flex: 1;` logic to ensure multi-chart layouts strictly respect their assigned row heights.
    - **Ultra-Slim Aesthetics**:
        - **Chart Header**: 2px vertical padding.
        - **Playback Bar**: 40px total height.
    - **Gutters**: 3px gaps.

### 📦 Key Dependencies
- **Frontend**: `sql.js`, `lightweight-charts` (v4.2.1), `lucide-react`, `react`.

---
*Last Update: 2026-04-13*
