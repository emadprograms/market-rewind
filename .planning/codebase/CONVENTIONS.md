# Coding Conventions

**Analysis Date:** 2026-06-01

## Naming Patterns

**Files:**
- **Components:** PascalCase (e.g., `src/components/ChartCanvas.tsx`, `src/components/PlaybackBar.tsx`)
- **Hooks:** camelCase starting with `use` (e.g., `src/hooks/useChartData.ts`, `src/hooks/useTradeManager.ts`)
- **Utilities/Library:** camelCase (e.g., `src/lib/resampling.ts`, `src/lib/timezones.ts`)
- **Types:** PascalCase (e.g., `src/types/index.ts`)

**Functions:**
- **Standard functions:** camelCase (e.g., `resampleData` in `src/lib/resampling.ts`)
- **React components:** PascalCase (e.g., `ChartHeader` in `src/components/ChartHeader.tsx`)

**Variables:**
- camelCase for local variables and state (e.g., `activeTrade`, `realizedPnL` in `src/hooks/useTradeManager.ts`)

**Types:**
- PascalCase for interfaces and types (e.g., `RawBar`, `ActiveTrade`, `ChartUnitProps` in `src/types/index.ts`)

## Code Style

**Formatting:**
- Standard TypeScript/React formatting is used.
- No explicit `.prettierrc` found in root, but consistent indentation and semi-colon usage observed.

**Linting:**
- No root-level `.eslintrc` found, but the project utilizes TypeScript for static analysis and type checking (`tsconfig.json`).

## Import Organization

**Order:**
1. React and core library imports.
2. Third-party dependencies (e.g., `lightweight-charts`, `lucide-react`).
3. Internal types (`src/types/index.ts`).
4. Internal hooks, components, and utilities.

**Path Aliases:**
- Standard relative paths are used (e.g., `../../src/types`).

## Error Handling

**Patterns:**
- **Try-Catch Blocks:** Used in complex side-effect logic and event handlers to prevent app crashes (e.g., `placeOrder` and mouse event handlers in `src/hooks/useTradeManager.ts`).
- **Error Boundaries:** Implemented via `src/components/ErrorBoundary.tsx` to wrap the application or specific components.

## Logging

**Framework:** `console`

**Patterns:**
- Use `console.error` for reporting exceptions within `try...catch` blocks (e.g., `src/hooks/useTradeManager.ts`).

## Comments

**When to Comment:**
- JSDoc-style comments are used to describe complex types and their purpose (e.g., `RawBar` in `src/types/index.ts`).

## Function Design

**Size:** Logic is decomposed into custom hooks to keep components lean.

**Parameters:** 
- Objects are used for complex parameter lists to improve readability and maintainability (e.g., `UseTradeManagerParams` in `src/hooks/useTradeManager.ts`).

**Return Values:**
- Hooks return objects containing state and control functions (e.g., `useTradeManager` returns `{ activeTrade, placeOrder, ... }`).

## Module Design

**Exports:**
- Named exports are preferred for utilities and hooks.
- Components are typically exported as named constants.

**Barrel Files:**
- `src/types/index.ts` acts as a central repository for all project types, reducing import clutter.

---

*Convention analysis: 2026-06-01*
