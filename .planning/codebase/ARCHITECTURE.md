<!-- refreshed: 2025-05-22 -->
# Architecture

**Analysis Date:** 2025-05-22

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                      User Interface                          │
│   `src/App.tsx` → `src/components/ChartWorkspace.tsx`        │
└────────┬─────────┬──────────────────┬───────────────────────┘
         │         │                  │
         ▼         ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Logic & State Layer                      │
│   `src/hooks/` (Business Logic)   `src/store/` (Global State)│
└────────┬─────────┬──────────────────┬───────────────────────┘
         │         │                  │
         ▼         ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data & Engine Layer                      │
│   `src/lib/db.ts` (SQLite/OPFS)   `lightweight-charts` (UI)  │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `App` | Root orchestrator, initializes core hooks and manages top-level views. | `src/App.tsx` |
| `ChartWorkspace` | Manages multi-chart layout, synchronization, and windowing. | `src/components/ChartWorkspace.tsx` |
| `ChartUnit` | Individual chart instance wrapper. | `src/components/ChartUnit.tsx` |
| `PlaybackManager` | Controls the virtual time progression for replay mode. | `src/components/PlaybackManager.tsx` |
| `useDatabase` | Handles DB initialization and OPFS persistence. | `src/hooks/useDatabase.ts` |
| `useChartData` | Fetches, resamples, and filters market data for a specific chart. | `src/hooks/useChartData.ts` |
| `usePlaybackStore` | Global source of truth for "current time" in replay mode. | `src/store/usePlaybackStore.ts` |
| `db.ts` | Low-level SQLite queries using `sql.js`. | `src/lib/db.ts` |

## Pattern Overview

**Overall:** Hook-based Functional Architecture with Global State Synchronization.

**Key Characteristics:**
- **Data-Driven UI:** The UI is a projection of the state managed in hooks and stores.
- **Virtual Time Synchronization:** All charts synchronize their data visibility based on a single global timestamp from the playback store.
- **Browser-Side Heavy Lifting:** Uses WASM (sql.js) and OPFS to handle large datasets entirely on the client side.
- **Resampling Pipeline:** Raw data $ightarrow$ Filter (Time/Session) $ightarrow$ Resample (Timeframe) $ightarrow$ Chart.

## Layers

**UI Layer:**
- Purpose: Rendering and User Interaction.
- Location: `src/components/`
- Contains: React components.
- Depends on: `src/hooks/`, `src/store/`
- Used by: User.

**Logic Layer (Hooks):**
- Purpose: Encapsulating domain logic and state transitions.
- Location: `src/hooks/`
- Contains: Custom React hooks.
- Depends on: `src/lib/`, `src/store/`
- Used by: UI Layer.

**State Layer:**
- Purpose: Cross-component synchronization.
- Location: `src/store/`
- Contains: Zustand stores.
- Depends on: `src/types/`
- Used by: Logic Layer, UI Layer.

**Data Layer:**
- Purpose: Data persistence and retrieval.
- Location: `src/lib/`
- Contains: DB access logic, data transformation utilities.
- Depends on: `sql.js`
- Used by: Logic Layer.

## Data Flow

### Primary Request Path (Data to Chart)

1. **Initialization:** `useDatabase` loads `.db` file into OPFS. (`src/hooks/useDatabase.ts`)
2. **Data Request:** `useChartData` calls `fetchMarketData` for a ticker/date. (`src/hooks/useChartData.ts` $ightarrow$ `src/lib/db.ts`)
3. **Resampling:** Raw data is passed through `resampleData` to match the requested timeframe (e.g., 1min $ightarrow$ 15min). (`src/lib/resampling.ts`)
4. **Replay Filtering:** Data is filtered against `usePlaybackStore.currentTime`. (`src/hooks/useChartData.ts`)
5. **Rendering:** Filtered data is pushed to `lightweight-charts` series. (`src/components/ChartCanvas.tsx`)

### Playback Tick Flow

1. **Trigger:** `PlaybackManager` calls `tick()` in the store. (`src/components/PlaybackManager.tsx`)
2. **State Update:** `usePlaybackStore` increments `currentTime` based on `stepMinutes`. (`src/store/usePlaybackStore.ts`)
3. **Propagation:** All `useChartData` hooks re-calculate their filtered data due to the `globalTime` dependency.
4. **Update:** Charts update their visible range to match the new virtual time.

**State Management:**
- **Global State:** Handled by Zustand in `src/store/usePlaybackStore.ts` for time and playback settings.
- **Local State:** Handled by React `useState` and `useMemo` within custom hooks for ticker-specific data.

## Key Abstractions

**The "Replay" Engine:**
- Purpose: Simulates a live market by advancing a virtual clock.
- Examples: `src/store/usePlaybackStore.ts`
- Pattern: Singleton store with deterministic time-advancement logic.

**The DB Proxy:**
- Purpose: Abstracts the complexities of WASM/OPFS file handling.
- Examples: `src/lib/db.ts`
- Pattern: Module-level singleton for the `sql.js` database instance.

## Entry Points

**`main.tsx`:**
- Location: `src/main.tsx`
- Triggers: Browser load.
- Responsibilities: Mounts the React application.

**`App.tsx`:**
- Location: `src/App.tsx`
- Triggers: React mount.
- Responsibilities: Initializes the core set of hooks and manages high-level navigation (Loading $ightarrow$ Config $ightarrow$ Workspace).

## Architectural Constraints

- **WASM dependency:** The application cannot start until `sql-wasm.wasm` is fetched and initialized.
- **Storage Limits:** OPFS is used to bypass standard IndexedDB/LocalStorage limits, but still depends on browser support.
- **Single-Threaded Processing:** Data resampling and filtering happen on the main thread; very large datasets may cause UI stutters.

## Error Handling

**Strategy:** Boundary-based catching and user-facing status indicators.

**Patterns:**
- **Error Boundaries:** `src/components/ErrorBoundary.tsx` wraps the application to prevent total crashes.
- **Status-based UI:** `useDatabase` provides a `dbStatus` string used to inform the user about DB loading/errors.

## Cross-Cutting Concerns

**Logging:** Console-based logging for DB errors and performance tracking.
**Validation:** Type safety enforced via TypeScript definitions in `src/types/index.ts`.
**Authentication:** Not implemented (Local-first application).

---

*Architecture analysis: 2025-05-22*
