---
id: 260926-0ym
slug: remove-cloud-upload-option-and-read-dire
title: "Remove cloud upload option and read directly from streaming.db"
date: "2026-09-25"
type: quick
status: complete
commit: f1f3b08
---

# Quick Task Summary: Remove Cloud Upload Option & Read Directly from streaming.db

## Executive Summary
Completely removed all database and cloud upload options, file inputs, drag-and-drop zones, and upload prompts from the Market Rewind frontend. The frontend now communicates directly with the active DuckDB streaming backend on port 8000 (running `streaming.duckdb` with 42.6M+ ticks and 40 active symbols). In addition, documented and clarified the exact role and history of each subfolder inside `backend/`.

## Key Changes Made

### 1. UI & State Cleanup
- **`Sidebar.tsx`**: Removed the `UploadCloud` icon, `<label className="upload-zone">` file input, and `handleFileUpload` prop. Removed obsolete external GitHub release download links. Replaced the upload trigger with an active glowing status badge (`Zap` / `Database` icon) displaying the live streaming DB connection state and symbol count.
- **`App.tsx`**: Removed `handleFileUpload` destructuring and prop passing. Updated the fallback workspace message from prompting for a database file upload to indicating live DuckDB connectivity on `localhost:8000`.
- **`useDatabase.ts`**: Removed `handleFileUpload` callback and `loadDatabaseFromFile` invocation. Prioritized direct connectivity to DuckDB streaming service with automatic symbol hydration and live status tracking (`Streaming DuckDB Connected (42.6M Ticks • 40 Symbols)`).
- **`index.css`**: Removed obsolete `.upload-zone` and hover styling rules.

### 2. Direct DuckDB Streaming & Schema Adaptation
- **`vite.config.ts`**: Updated default proxy target to `http://localhost:8000` (and `ws://localhost:8000`), matching `data-harvester`'s active `src.dashboard.server` with optional `VITE_STREAMING_URL` override.
- **`streamingClient.ts`**:
  - Pointed default fallback URL to `http://localhost:8000`.
  - Normalized `checkStatus()` to support both `data-harvester`'s `/api/status` schema (`streaming.ticks_rows`, `streaming.size_mb`) and `streaming_service`'s schema.
  - Normalized `getSymbols()` to accept both `{ symbols: [...] }` dictionary formats and flat lists.
  - Added dual routing for `getTicks()` to query `/api/stream/tape` or `/api/ticks`.
  - Added dual routing for `getCandles()` to query `/api/streaming/candles` or `/api/candles`.

### 3. Backend Folder Clarification (`backend/README.md`)
Created `backend/README.md` clearly documenting the three folders in `backend/`:
- `backend/app_db_sync`: Legacy Turso libSQL delta sync script (`sync.py`) used in v1.0 to download `market_data.db`. Deprecated.
- `backend/historical_archiver`: Legacy Polygon.io archiver (`massive_fetcher.py`, `turso_writer.py`) used in v1.0 to populate Turso. Deprecated.
- `backend/streaming_service`: High-performance Python / DuckDB service developed in Phase 6 for tick-by-tick streaming and WebSocket replay.

## Verification
- **Unit & Integration Tests**: All 24 Vitest test suites (95 tests) passed with 100% green status.
- **Production Build**: `npm run build` executed and created production assets in 1.56s without errors.
- **Live Endpoint Integration**: Verified connection to `http://localhost:8000/api/status`, `/api/symbols`, `/api/streaming/candles`, and `/api/stream/tape`.
