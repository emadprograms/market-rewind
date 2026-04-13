# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v5.7 - Ergonomic Workspace & Maximize)

Market Rewind is a zero-read, local-first market replay tool. It operates entirely within the user's browser, eliminating Turso "Rows Read" costs, avoiding network fetching errors, and bypassing Vercel compute costs.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger. Pulls from Turso once using libSQL, then uploads `market_data.db` as a **GitHub Release** asset.
- **Frontend Storage**: Uses Browser **OPFS** (Origin Private File System) for lightning-fast database access.
- **Manual Upload Workflow**: Instead of automatic fetching (which caused massive CORS/Vite/CDN/Vercel failures), the user downloads the latest release and manually uploads the `.db` file into the sidebar UI once. OPFS persists it across sessions.
- **WASM Engine**: **sql.js** (Self-hosted).
- **Read Strategy**: **Distributed Chart-Level Fetching**. Each `ChartUnit` is responsible for fetching its own raw data based on its locally selected symbol.
- **Data Storage**: **0 Turso Reads** for end-users. Turso is only touched during your manual sync.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/App.jsx`:
    - **Functional Maximize**: Implemented `maximizedId` state to toggle between Grid View and single-chart Focus View.
    - **Trade Ticker Selection**: Focus ticker selector on landing page.
    - **Default Dual-Chart Layout**: Standardized 2-chart start.
- [x] `src/components/ChartUnit.jsx`:
    - **Ergonomic Header**: Removed the settings button and implemented the Maximize/Minimize toggle.
    - **Premium UI (Option B)**: Custom glassmorphism dropdowns with symbol search.
    - **Dropdown Stability Fix**: Implemented `e.stopPropagation()` for reliable interaction.
- [x] `src/index.css`:
    - **Razor-Thin Header**: Reduced padding to `4px 10px` and shrunk switches/icons for a professional trading terminal feel.
    - **Dropdown Positioning Fix**: Correctly anchored menus using `position: relative`.

### 📦 Key Dependencies
- **Frontend**: `sql.js` (SQLite WASM), `lightweight-charts`, `lucide-react`, `react`.

---
> **🚨 MANDATORY SYSTEM DIRECTIVE**
> **Whenever ANY code change, feature addition, bug fix, or architectural modification is made to this project, this `gemini.md` file MUST be updated to reflect the new state, regardless of whether the user explicitly asks for it or not.**

---
*Last Update: 2026-04-13*
