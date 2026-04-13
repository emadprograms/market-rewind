# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v6.4 - Absolute Density)

Market Rewind is a zero-read, local-first market replay tool.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/components/ChartUnit.jsx`:
    - **Grid-4 Resilience**: Fixed row-height overflow.
    - **True Full Screen Mode**: 40px playback bar remains visible.
- [x] `src/index.css`:
    - **Absolute Density Workspace**: Gaps and padding reduced to the absolute limit of **2px**.
    - **Ultra-Slim Aesthetics**:
        - **Chart Header**: 2px vertical padding.
        - **Playback Bar**: 40px total height.

### 📦 Key Dependencies
- **Frontend**: `sql.js`, `lightweight-charts` (v4.2.1), `lucide-react`, `react`.

---
*Last Update: 2026-04-13*
