# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v6.2 - Professional Session Shading)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs, avoiding network fetching errors, and bypassing Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS**.
- **WASM Engine**: **sql.js**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/lib/timezones.js`:
    - **ETF Reclassification**: SPY, QQQ, and other ETFs now correctly use `America/New_York` (ET) for accurate market hour detection.
- [x] `src/lib/SessionShading.js`:
    - **Session Shading Engine**: A custom Lightweight Charts primitive that draws subtle background highlights during Pre/Post market sessions. Features robust DST handling using `Intl.DateTimeFormat`.
- [x] `src/components/ChartUnit.jsx`:
    - **1D Perceptual Zoom (Fixed)**: Daily charts now load with a standard **50-bar** view, ensuring candles look 'thick' and professional on all screens.
    - **Shading Integration**: Automatically activates shading for ET-bound assets when ETH is toggled ON.
- [x] `src/index.css`:
    - **High-Density Workspace**: 3px gaps.
    - **Ultra-Slim Playback Bar**: 48px height.

### 📦 Key Dependencies
- **Frontend**: `sql.js`, `lightweight-charts` (v4.2.1), `lucide-react`, `react`.

---
*Last Update: 2026-04-13*
