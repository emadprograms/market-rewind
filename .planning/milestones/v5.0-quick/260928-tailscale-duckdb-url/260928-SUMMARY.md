---
quick_id: 260928-url
slug: tailscale-duckdb-url
status: complete
date: 2026-09-28
---

# Quick Task Summary: Configurable DuckDB Streaming Service URL

## Overview
Added complete support for accessing Market Rewind across devices (Tailscale / local network) without hardcoding `localhost:8420`. The DuckDB streaming backend URL now resolves automatically from the browser's access hostname (`http://${window.location.hostname}:8420`), can be configured dynamically in the UI, and persists across sessions via `localStorage`.

## Root Cause & Need
When users access Market Rewind from remote/client devices over Tailscale (e.g. `http://100.x.y.z:3000` or `http://my-desktop:3000`), the DuckDB backend is running on the host machine (`100.x.y.z:8420`), NOT on the client device. Previously, the client code and error messages hardcoded `localhost:8420` and lacked UI configuration mechanisms, causing connection failures on all remote devices.

## Changes Made

1. **`src/lib/streamingClient.ts`**:
   - Implemented `resolveServiceUrl`: dynamically determines backend URL with precedence: `localStorage` preference > smart host default (`http://${window.location.hostname}:8420`) > environment variable > fallback (`http://localhost:8420`).
   - Implemented `normalizeServiceUrl`: auto-prepends `http://` if protocol omitted, strips trailing slashes, and synchronously derives WebSocket URL (`ws://` / `wss://`).
   - Refactored `StreamingClient` class: replaces static constants with dynamic getters `getBaseUrl()` and `getWsUrl()`.
   - Added `setServiceUrl` and `resetToDefaultUrl` methods with `localStorage` persistence and event-subscriber support (`subscribeUrlChange`).
   - Fixed variable scoping bug for `fallbackEndpoint` in `getCandles`.

2. **`src/hooks/useDatabase.ts`**:
   - Added reactive `serviceUrl` state synced with `streamingClient`.
   - Subscribed to runtime URL changes to trigger automatic reconnection and metadata refresh.
   - Exposed `changeServiceUrl` and `resetServiceUrl`.

3. **`src/components/ConnectionSetupCard.tsx`**:
   - Replaced dead-end static offline text with an interactive connection setup card.
   - Pre-fills input with current URL or smart host default.
   - Provides quick preset buttons: `Current Host (${window.location.hostname}:8420)` and `Localhost (8420)`.
   - Includes verification testing before connection with inline error diagnostics.

4. **`src/components/ConnectionModal.tsx` & `src/components/Sidebar.tsx`**:
   - Enabled interactive clicking on the sidebar database/zap status indicator.
   - Added modal dialog for configuring, testing, and resetting the DuckDB streaming service URL at any time.

5. **`tests/unit/streamingUrlConfig.test.tsx`**:
   - Added 16 unit tests verifying resolution priority, URL normalization, WebSocket URL mapping, `localStorage` persistence, subscriber callbacks, and UI component workflows.

## Verification
- **Unit & Regression Tests**: All 35 test suites passed (`35/35 passed, 165/165 tests passed`).
- **Production Build**: `npm run build` completed cleanly in 843ms with 0 errors.
