# Codebase Structure

**Analysis Date:** 2025-05-22

## Directory Layout

```
[project-root]/
├── backend/             # Python scripts for DB sync and historical archiving
├── public/              # Static assets (including sql-wasm.wasm)
├── src/                 # Main frontend application
│   ├── components/      # UI components (Chart, Sidebar, Playback)
│   ├── hooks/           # Domain-specific business logic and state management
│   ├── lib/             # Pure utility functions, DB access, and charting plugins
│   ├── store/           # Global state management (Zustand)
│   └── types/           # TypeScript interface and type definitions
├── tests/               # Test suites (Unit, Integration, Performance)
└── vite.config.ts       # Build configuration
```

## Directory Purposes

**src/components:**
- Purpose: Presentation layer.
- Contains: React components.
- Key files: `ChartWorkspace.tsx`, `ChartUnit.tsx`, `PlaybackBar.tsx`.

**src/hooks:**
- Purpose: Logic layer. Encapsulates complex state transitions and data fetching.
- Contains: Custom hooks.
- Key files: `useChartData.ts`, `useDatabase.ts`, `useSession.ts`.

**src/lib:**
- Purpose: Infrastructure and Utility layer.
- Contains: DB clients, data resampling logic, and Lightweight Charts plugins.
- Key files: `db.ts`, `resampling.ts`, `TradePlugin.ts`.

**src/store:**
- Purpose: Application-wide state synchronization.
- Contains: Zustand stores.
- Key files: `usePlaybackStore.ts`.

**src/types:**
- Purpose: Centralized type definitions.
- Contains: TypeScript interfaces.
- Key files: `index.ts`.

## Key File Locations

**Entry Points:**
- `src/main.tsx`: Application mount point.
- `src/App.tsx`: Main application shell and layout orchestrator.

**Configuration:**
- `vite.config.ts`: Vite build and dev server config.
- `tsconfig.json`: TypeScript compiler configuration.

**Core Logic:**
- `src/lib/db.ts`: The primary interface for the SQLite database.
- `src/lib/resampling.ts`: Logic for converting raw ticks/bars to higher timeframes.
- `src/store/usePlaybackStore.ts`: The "clock" driving the replay simulation.

**Testing:**
- `tests/unit/`: Smallest unit of logic (e.g., resampling, timezones).
- `tests/performance/`: Rendering and data slicing benchmarks.
- `tests/integration/`: End-to-end lifecycle tests.

## Naming Conventions

**Files:**
- Components: PascalCase (e.g., `ChartCanvas.tsx`).
- Hooks: camelCase starting with `use` (e.g., `useChartData.ts`).
- Utilities/Lib: camelCase (e.g., `resampling.ts`).

**Directories:**
- Lowercase (e.g., `components`, `hooks`).

## Where to Add New Code

**New Feature (UI):**
- Primary code: `src/components/`
- State/Logic: `src/hooks/`

**New Data Processing/Algorithm:**
- Implementation: `src/lib/`

**New Global State:**
- Implementation: `src/store/`

**New Type Definition:**
- Implementation: `src/types/index.ts`

## Special Directories

**backend/**:
- Purpose: Off-line data preparation scripts (Python).
- Generated: No.
- Committed: Yes.

**public/**:
- Purpose: Static files served by Vite.
- Contains: `sql-wasm.wasm` (critical for DB operation).
- Generated: No.
- Committed: Yes.

---

*Structure analysis: 2025-05-22*
