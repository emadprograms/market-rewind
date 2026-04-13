# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v6.8 - Horizontal Ray Drawing)

Market Rewind is a zero-read, local-first market replay tool.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/App.jsx`:
    - **Ultra-Slim Logic**: Integrated with 40px playback system.
    - **Persistent Sidebar Access**: Sidebar toggle heavily integrated into the playback bar to prevent chart obfuscation.
- [x] `src/components/ChartUnit.jsx`:
    - **Grid-4 Resilience**: Enforced strict container adherence through ResizeObserver and CSS (nested `min-height: 0` for canvas containment).
    - **Context Anchoring**: Intelligent logical-center lookup to completely negate 'Overnight Gap Drift' when switching extreme timeframes.
    - **Horizontal Ray Drawing**:
        - `H` key toggles draw mode (crosshair cursor + orange status bar).
        - Click to place a solid orange price line with axis label.
        - Double-click near a ray to delete it (10px tolerance).
        - `Delete`/`Backspace` clears all rays. `Escape` exits draw mode.
- [x] `src/index.css`:
    - **Deterministic Layout Engine**: 
        - Root workspace height set to `calc(100vh - 40px)`.
        - Grid rows use `minmax(0, 1fr)` to force a perfect 50/50 vertical split.
        - `min-height: 0` applied to all cards to eliminate content-stiffness.
    - **Absolute Density Workspace**: 2px gaps.
    - **Ultra-Slim Aesthetics**:
        - **Chart Header**: 2px vertical padding.
        - **Playback Bar**: 40px total height.
- [x] `src/lib/SessionShading.js`:
    - **TradingView Session Shading**: 
        - Pre-Market: Warm Yellow (`rgba(255, 210, 0, 0.07)`).
        - Post-Market: Cool Blue (`rgba(0, 130, 255, 0.07)`).
        - RTH: Transparent (unshaded).
        - Night/Extended: Subtle neutral (`rgba(255, 255, 255, 0.03)`).
    - **DST Aware**: Uses `Intl.DateTimeFormat` for robust NY timezone handling.
- [x] `src/lib/VolumeProfilePlugin.js`:
    - **Visible Range Volume Profile (VRVP)**:
        - Dynamically computes volume-at-price distribution for the visible chart range.
        - 70-bin histogram anchored to left edge, max 25% chart width.
        - **Point of Control (POC)** highlighted in yellow (`rgba(255, 210, 0, 0.8)`).
        - Cache-aware: skips recomputation when logical range hasn't changed.
        - Toggled via `VP` switch in chart header (next to ETH toggle).

### 📦 Key Dependencies
- **Frontend**: `sql.js`, `lightweight-charts` (v4.2.1), `lucide-react`, `react`.

---
*Last Update: 2026-04-13*
