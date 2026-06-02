---
phase: 04-systemic-hardening-audit
plan: 04
subsystem: Data Layer
tags: [worker, sqlite, performance]
dependency_graph:
  requires: ["04-03"]
  provides: ["worker-db-access"]
  affects: ["useChartData"]
tech-stack:
  added: [Web Worker]
  patterns: [Proxy Pattern, Request-Response]
key-files:
  - src/lib/workers/db.worker.ts
  - src/lib/db.ts
decisions:
  - "Used a Request-Response pattern with unique IDs to handle async worker communication."
  - "Maintained original function signatures in db.ts for seamless integration with hooks."
  - "Kept OPFS persistence logic inside the worker for reduced main-thread overhead."
metrics:
  duration: "30m"
  completed_date: "2026-06-02"
---

# Phase 04 Plan 04: Database Worker Migration Summary

Migrated `sql.js` database operations to a Web Worker to eliminate main-thread blocking and UI stutters during large data fetches.

## Implementation Details

- **Database Worker (`src/lib/workers/db.worker.ts`)**:
    - Encapsulates `sql.js` initialization and database instance.
    - Handles WASM binary loading within the worker context.
    - Implements a message handler for `FETCH_MARKET_DATA`, `FETCH_HISTORICAL_CHUNK`, and `FETCH_TICKERS`.
    - Manages OPFS persistence (loading/saving) inside the worker.

- **Worker Proxy (`src/lib/db.ts`)**:
    - Replaced direct `sql.js` calls with a `DatabaseWorkerProxy` class.
    - Implements a request-response pattern using `crypto.randomUUID()` for matching responses to promises.
    - Maintains the same public API as the original `db.ts` to avoid breaking changes in `useChartData` and other consumers.
    - Implements a 10-second timeout for worker requests to prevent hanging promises.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- [x] `src/lib/workers/db.worker.ts` exists.
- [x] `src/lib/db.ts` refactored to use Worker.
- [x] Type-checks pass.
- [x] Public API of `db.ts` remains compatible.
