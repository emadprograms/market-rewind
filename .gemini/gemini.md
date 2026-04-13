# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v6.5 - Grid Force-Alignment)

Market Rewind is a zero-read, local-first market replay tool.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/App.jsx`:
    - **Ultra-Slim Logic**: Integrated with 40px playback system.
- [x] `src/components/ChartUnit.jsx`:
    - **Grid-4 Resilience**: Enforced strict container adherence through ResizeObserver and CSS.
- [x] `src/index.css`:
    - **Deterministic Layout Engine**: 
        - Root workspace height set to `calc(100vh - 40px)`.
        - Grid rows use `minmax(0, 1fr)` to force a perfect 50/50 vertical split.
        - `min-height: 0` applied to all cards to eliminate content-stiffness.
    - **Absolute Density Workspace**: 2px gaps.
    - **Ultra-Slim Aesthetics**:
        - **Chart Header**: 2px vertical padding.
        - **Playback Bar**: 40px total height.

### 📦 Key Dependencies
- **Frontend**: `sql.js`, `lightweight-charts` (v4.2.1), `lucide-react`, `react`.

---
*Last Update: 2026-04-13*
