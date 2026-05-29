# Gemini Status - Market Rewind ⏪

## Project State: COMPLETED (v7.5 - Sidebar Icon Dock & Context Isolation)

Market Rewind is a zero-read, local-first market replay tool.

### 🏗️ Architecture Map
- **Data Sync Utility (GitHub Actions)**: Manual trigger.
- **Frontend Storage**: Uses Browser **OPFS**.

### 🚥 Component Breakdown

#### Core Application (`src/`)
- [x] `src/App.jsx`:
    - **Minimal Icon Dock Sidebar**: 
        - Fixed 48px width sidebar containing only icons.
        - **Tooltips**: Hovering over any icon reveals its purpose (title attributes).
        - **Compact Layout Selector**: Single-column vertical grid for selecting up to 10 chart layouts.
        - **Integrated Date Picker**: Invisible date input overlaid on a calendar icon for clean aesthetics.
    - **Intelligent Layout Defaults**: 
        - **1-Chart**: `5m` company chart.
        - **2-Chart**: Automatically loads `5m` (with ETH) and `1D` for context.
        - **3-Chart**: `5m`, `1H`, `1D` vertical stack/grid.
        - **4-Chart**: `5m`, `1H`, `1D` + `5m SPY` context chart.
        - **Force-Remount**: Charts now use a composite key `${layoutMode}-${i}` to ensure defaults are re-applied instantly upon layout switch.
    - **Grouped Symbol Linking System**: Replaced the global "Link" toggle with a multi-group synchronization system (Red, Blue, Green, Yellow). 
        - **Group Picker**: Colored circles in each chart header allow assigning charts to specific sync groups.
        - **Visual Indicators**: Chart cards display a colored top border corresponding to their active group.
        - **Persistence**: Group assignments and group-specific tickers are persisted via `localStorage`.
    - **Resizable Chart Panels**: 
        - **Draggable Dividers**: Real-time resizing support for `2V`, `2H`, `3V`, and `3H` layouts.
        - **Splitter System**: Uses a custom Flex-based engine with draggable gutters that remember their positions per layout session.
        - **Touch Support**: Full `touchstart`/`touchmove`/`touchend` event handling for tablet resizing. Gutters widen to 12px on touch devices (`pointer: coarse` media query) for easier targeting. `touch-action: none` prevents browser gesture interference.
    - **Ultra-Slim Logic**: Integrated with 40px playback system.
    - **Step Overrides**: Added manual "STEP" selector (Auto, 1m, 5m, etc.) to the replay bar, allowing users to override the minimum chart timeframe.
    - **Unified Replay Engine**: 
        - Synchronized playback across multiple charts.
        - Dynamic tick rate driven by the lowest timeframe in the layout.
        - **Squash Fix**: Backwards replay steps naturally crop data on the right without aggressive logical range shifts, preventing candle squishing.
    - **Local-Time Start/Reset Engine**: 
        - Default `entryTime` updated to `09:20` (ET).
        - DST-aware conversion logic (`getUtcTimeFromEt`) ensures the simulator starts and resets to the exact ET time selected by the user, regardless of seasonal timezone offsets (EST vs EDT).
        - **Target Date Persistence**: Uses `localStorage` to automatically remember and restore the exact target date the user was last simulating.
        - **Ticker Persistence**: Uses `localStorage` to remember the last used ticker symbol across sessions.
- [x] `src/components/ChartUnit.jsx` & `src/lib/db.js`:
    - **Dynamic Data Optimization**: Initial payload size maps to the timeframe (e.g., `1m` chart fetches 3 days, `1D` chart fetches 2 years). Drops initial load from 500,000 rows to <5,000 rows for intraday, eliminating UI lag.
    - **Infinite Scroll Engine**: Tracks scroll viewport bounds (`subscribeVisibleLogicalRangeChange`) to dynamically fetch 30-day SQLite chunks when approaching the left boundary.
    - **Seamless Viewport Prepend**: Mathematically shifts the `timeScale` rightwards by the exact number of prepended candles, completely masking the background chunk injections.
    - **Right Margin Padding**: Enforced via native `scrollToRealTime()`, guaranteeing space on the right side of the active candle on reset/load.
    - **Timeframe Jump Fix**: Replaced rigid anchoring with dynamic fallback to prevent `1D` to intraday switches from jumping backwards to the morning open.
    - **Context Isolation (Sync Protection)**: 
        - Implemented a **Data Payload Tagging System** that prevents the chart from rendering intermediate, out-of-sync data during an async database fetch. 
        - Completely eliminates the '1h to 1m' resampler crash.
    - **ETH Toggle Stabilization**: Added `showEth` to context tracking, preventing the chart from squishing against the Y-axis when injecting extended hours data.
    - **Grid-4 Resilience**: Enforced strict container adherence through ResizeObserver and CSS.
    - **Context Anchoring**: Intelligent logical-center lookup to completely negate 'Overnight Gap Drift'.
    - **Stale Data Fix**: Eliminated race condition where switching symbols displayed old data under the new ticker.

    - **Stable Replay View & Auto-Reveal**: Viewport stays frozen during replay analysis; automatically shifts to reveal new candles if the user is at the right edge.
    - **Persistent Zoom Level**: Tracks manual `barSpacing` changes to maintain consistent candle width across all timeframe switches, preventing visual reset.



    - **Live Price Line (1D)**: Dynamic dashed yellow line indicator for extended hours / incomplete daily candles.
    - **Header Action Bar**:
        - **ETH Toggle**: Extended trading hours visibility.
        - **VP Toggle**: Visible range volume profile visibility.
        - **RAY Button**: Click to enter Horizontal Ray drawing mode (matches `Alt+J`).
        - **RECT Button**: Click to enter Rectangle drawing mode (matches `Alt+Shift+R`).
        - **CLEAR Button**: Tablet-friendly trash icon to clear all drawings for the current ticker.
    - **Scroll to End UI**: Floating "return to latest" button appears on hover when scrolled away from the most recent data point. Click action binds to `scrollToRealTime()` to enforce proper right-margin padding.


    - **TradingView-Style Keyboard Navigation**:
        - **Standalone Letters (`A-Z`)**: Instantly opens the "Change Symbol" popup to swap tickers without clicking.
        - **Standalone Numbers (`0-9`)**: Instantly opens the "Change Interval" popup to swap timeframes (e.g., `5`, `1D`).
    - **Drawing & View Tools (Synced & Persistent)**:
        - *Note: Shortcuts are hardened against Mac OS interception via robust `keyCode` fallbacks, and feature a full `Ctrl` alternative if the OS totally blocks the `Option/Alt` key.*
        - `Alt/Ctrl + J`: Toggle **Horizontal Ray** mode (anchored start, extends right).
        - `Alt/Ctrl + Shift + R`: Toggle **Rectangle** drawing mode (click-to-start, click-to-finish).
        - `Alt/Ctrl + Shift + E`: Toggle **Extended Trading Hours (ETH)** on/off.
        - `Escape` exits draw mode.
    - **Keyboard Action Modal**: Global `?` key triggers an overlay displaying all active hotkeys and navigation shortcuts.
- [x] `src/index.css`:
    - **Deterministic Layout Engine**: 
        - Root workspace height set to `calc(100vh - 40px)`.
        - Grid rows use `minmax(0, 1fr)` to force a perfect 50/50 vertical split.
        - `min-height: 0` applied to all cards to eliminate content-stiffness.
    - **Absolute Density Workspace**: 2px gaps.
    - **Ultra-Slim Aesthetics**:
        - **Chart Header**: 2px vertical padding.
        - **Playback Bar**: 40px total height.
    - **OLED Glass Theme**:
        - Base background is absolute `#000000`.
        - Restored **Radial Gradients** (Subtle Green/Red) for depth.
        - Restored **Glass-morphism** (Blurs) on Sidebar, Playback Bar, and Cards for a premium, multi-layered aesthetic.
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
- [x] `src/lib/HorizontalRayPlugin.js`:
    - **Anchored Horizontal Rays**: Syncs orange rays anchored at price/time.
- [x] `src/lib/RectanglePlugin.js`:
    - **Synced Rectangles**: 
        - Renders orange-bordered, semi-transparent rectangles (`rgba(255, 152, 0, 0.15)`).
        - Supports 2-point placement logic with live canvas previews.
        - Robust off-screen clipping for persistent chart analysis.
- [x] `src/lib/TradePlugin.js`:
    - **Trade Visuals**: Renders draggable SL/TP and Entry lines for simulated trades.

- **Frontend**: `sql.js`, `lightweight-charts` (v4.2.1), `lucide-react`, `react`.

#### Backends (`backend/`)
- [x] **App DB Sync (`backend/app_db_sync/`)**: Scripts for syncing the main Turso database into the local application.
- [x] **Historical Archiver (`backend/historical_archiver/`)**: 
    - Worker-Per-Day Architecture: Each of 9 workers owns a dedicated API key and processes ALL tickers for one day before moving to the next.
    - Strict Rate Limiting: 60s mandatory cooldown between API calls per key. Resume checks (no API call) skip without consuming cooldown.
    - Day Queue: Days are distributed via a thread-safe queue. Days beyond 9 are queued and only start when a worker finishes its current day.
    - `infisical_client.py`: Dual-DB connectivity (Source: `aw_ticker_notes`, Target: Archive).
    - `massive_fetcher.py`: Dedicated per-worker clients (no rotation/sharing). Progressive backoff on 429 (60s, 120s, 180s).
    - `turso_writer.py`: Per-thread Turso connections with batch writes via libSQL tuple protocol. Tier-1 source protection.
    - `main.py`: Day-queue orchestrator with `--cooldown` flag (default 60s) and real-time ETA tracking.

#### GitHub Actions Workflows (`.github/workflows/`)
- [x] `sync_app_db.yml`: Manual trigger to sync main Turso DB → local SQLite and publish as `latest-data` GitHub Release.
- [x] `sync_archive_db.yml`: Manual trigger with configurable inputs:
    - `from_date` / `to_date`: Date range for backfill.
    - `cooldown`: Seconds between API calls per worker (default: 60).
    - `update_release`: Toggle to sync the **archive** Turso DB → SQLite and publish as `latest-archive` GitHub Release.
    - All credentials sourced from **Infisical** (no extra GitHub secrets needed beyond the 3 Infisical auth secrets).
    - **Required Secrets**: `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`.

---
*Last Update: 2026-05-29*
worker (default: 60).
    - `update_release`: Toggle to sync the **archive** Turso DB → SQLite and publish as `latest-archive` GitHub Release.
    - All credentials sourced from **Infisical** (no extra GitHub secrets needed beyond the 3 Infisical auth secrets).
    - **Required Secrets**: `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`.

---
*Last Update: 2026-05-29*
