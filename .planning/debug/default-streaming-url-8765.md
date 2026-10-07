---
status: resolved
trigger: "The default streaming URL is set for Arshad PC, it's set for another PC so it always runs into this error. Then I need to change the streaming service URL to localhost8765 by default."
created: 2026-10-07T09:38:30Z
updated: 2026-10-07T09:48:45Z
symptoms:
  expected: "Default streaming URL is http://localhost:8765 everywhere, with all Arshad PC Tailscale IP references removed."
  actual: "Default URL was hardcoded to http://100.72.128.22:8420 (Arshad PC), throwing offline connection errors on clean browser boot."
  errors: "Failed to reach http://100.72.128.22:8420/api/status."
  timeline: "Configured during remote host testing and never reset to local port 8765."
  reproduction: "Open http://localhost:3000 or http://localhost:3001 without pre-existing localStorage item."
resolution:
  root_cause: "Default fallback URLs in .env, .env.example, vite.config.ts, streamingClient.ts, and UI preset buttons were hardcoded to Arshad PC Tailscale IP 100.72.128.22 on port 8420."
  fix: "Replaced all defaults with http://localhost:8765 and ws://localhost:8765. Removed all Arshad PC constants and presets, updated unit tests to assert localhost:8765 as default."
  verification: "422 Vitest unit tests passed (81 test files), 226 backend tests passed, Vite production build clean, and unseeded headless browser boot test confirmed immediate successful connection to local tick lake."
  files_changed:
    - .env
    - .env.example
    - vite.config.ts
    - src/lib/streamingClient.ts
    - src/components/ConnectionSetupCard.tsx
    - src/components/ConnectionModal.tsx
    - tests/unit/streamingUrlConfig.test.tsx
    - tests/unit/realTickPlayback.test.ts
    - tests/unit/streamingClientTimeouts.test.ts
    - tests/unit/strictStreamingEngine.test.ts
    - tests/unit/timeAndSalesDensity.test.ts
    - tests/regression/e2e-utils.ts
---

# Debug Session: default-streaming-url-8765 (Resolved)

## Root Cause
The repository had hardcoded fallback references to Arshad PC (`100.72.128.22:8420`) and `arshad-pc-1:8420` dating back to when the DuckDB backend was hosted on an external machine. As a result, any fresh browser load without a pre-populated `market_rewind_duckdb_url` entry in `localStorage` attempted to connect to the remote Tailscale IP and immediately displayed the offline connection card.

## Resolution
1. **Config & Env Files:** Updated `.env`, `.env.example`, and `vite.config.ts` to default `VITE_STREAMING_URL` to `http://localhost:8765` and `VITE_WS_URL` to `ws://localhost:8765`.
2. **Client Resolution:** In `src/lib/streamingClient.ts`, replaced `DEFAULT_STREAMING_URL` with `http://localhost:8765`, purged `TAILSCALE_STREAMING_IP` and `TAILSCALE_STREAMING_MAGICDNS`, and aligned dynamic host resolution to port `8765`.
3. **UI Presets:** In `ConnectionSetupCard.tsx` and `ConnectionModal.tsx`, replaced remote Tailscale preset chips with `Localhost (localhost:8765)` and `Current Host` presets, and updated instructions/placeholders.
4. **Test Alignment:** Updated unit tests in `tests/unit/streamingUrlConfig.test.tsx`, `realTickPlayback.test.ts`, `streamingClientTimeouts.test.ts`, `strictStreamingEngine.test.ts`, `timeAndSalesDensity.test.ts`, and `tests/regression/e2e-utils.ts`.

## Verification
- Vitest: 81 files / 422 passed, 2 skipped
- Backend Pytest: 226 passed, 2 skipped
- Clean boot browser test: Navigated with empty `localStorage` directly to `http://localhost:3001`; immediately showed `Configure Session` with real tick lake symbols loaded, zero errors.
