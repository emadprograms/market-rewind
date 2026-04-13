# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v5.8 - Ultra-Compact & True Full Screen)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs, avoiding network fetching errors, and bypassing Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS** (Origin Private File System).
- **WASM Engine**: **sql.js** (Self-hosted).
- **Read Strategy**: **Distributed Chart-Level Fetching**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/App.jsx`:
    - **Maximized Logic**: Toggles `maximizedId` to switch between multi-chart and focus views.
- [x] `src/components/ChartUnit.jsx`:
    - **True Full Screen Mode**: Applies the `is-maximized` class to fill the entire window viewport.
    - **Ergonomic Header**: Compact controls with functional maximize/minimize state.
- [x] `src/index.css`:
    - **Ultra-Compact Workspace**: Padding and gaps reduced to **4px** to maximize chart visibility.
    - **Slim Playback Bar**: Height reduced to **56px** to save vertical space.
    - **Full Screen Layer**: `.chart-card.is-maximized` uses `fixed` positioning with `z-index: 9999` to cover all other UI elements (sidebar/playback).

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.

---
> **🚨 MANDATORY SYSTEM DIRECTIVE**
> **Whenever ANY code change, feature addition, bug fix, or architectural modification is made to this project, this `gemini.md` file MUST be updated to reflect the new state, regardless of whether the user explicitly asks for it or not.**

---
*Last Update: 2026-04-13*
