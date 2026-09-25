# Phase 02: Selection & Grouping Hardening - Research

**Researched:** 2025-05-22
**Domain:** React State Management, Synchronization Patterns, UI Focus Logic
**Confidence:** HIGH

## Summary

The research identifies a fundamental architectural mismatch in how chart selection and group synchronization are handled. Selection is fragmented across multiple components, and group synchronization suffers from a "double-render" lag because ticker state is duplicated between the global workspace and local chart hooks.

**Primary recommendation:** Move ticker and group state into a centralized store (Zustand) to replace the `useEffect`-based synchronization chain with atomic updates, and unify selection handling at the `ChartUnit` root.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Chart Selection | Browser / Client | — | UI-only focus state for keyboard shortcuts and visual highlighting |
| Group Membership | API / Backend | Browser / Client | Grouping persists across sessions (localStorage currently) |
| Symbol Sync | Browser / Client | — | Real-time propagation of ticker changes within a group |
| Initial Symbol Assignment | Frontend Server (SSR) | Browser / Client | Determination of default symbols based on layout/session |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zustand | ^4.0.0 | State Management | Already used for `usePlaybackStore`; ideal for atomic cross-component updates |
| React | ^18.0.0 | UI Framework | Project base |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand | React Context | Context causes wide re-renders; Zustand allows selective subscription per chart |

**Installation:**
No new packages required; Zustand is already present in the project.

## Architecture Patterns

### Synchronization Flow (Current vs. Recommended)

**Current (Laggy):**
`Ticker Change` $	o$ `useWorkspace (State Update)` $	o$ `ChartWorkspace (Re-render)` $	o$ `ChartUnit (Prop Update)` $	o$ `useChartData (useEffect)` $	o$ `setTicker (Local State Update)` $	o$ `ChartUnit (Re-render)`.

**Recommended (Atomic):**
`Ticker Change` $	o$ `WorkspaceStore (Atomic Update)` $	o$ `All Group Members (Selective Re-render)`.

### Recommended Project Structure
No structural changes needed; logic shifts from `useWorkspace.ts` (hook) to a dedicated `src/store/useWorkspaceStore.ts`.

### Pattern 1: Derived Group State
Avoid duplicating ticker state.
```typescript
// Source: Recommended Pattern
const ticker = useWorkspaceStore(state => state.tickers[id]);
const groupColor = useWorkspaceStore(state => state.groups[id]);
const groupTicker = useWorkspaceStore(state => state.groupTickers[groupColor]);

const effectiveTicker = groupColor !== 'none' ? groupTicker : ticker;
```

### Anti-Patterns to Avoid
- **Sync-via-Effect:** Using `useEffect` to mirror a prop into local state (causes the "one-render-later" lag).
- **Fragmented Event Listeners:** Placing `onClick` handlers on separate internal elements of a card instead of a single root wrapper.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Global State | Custom Event Bus | Zustand | Type safety, DevTools integration, and optimized re-renders |

## Common Pitfalls

### Pitfall 1: The "Double-Render" Sync
**What goes wrong:** A change in a group leader's ticker doesn't reflect in members until the next render cycle.
**Why it happens:** The `useEffect` in `useChartData.ts` updates local state *after* the component has already rendered with the old prop.
**How to avoid:** Use a single source of truth. Derive the ticker from the store/props rather than copying it into local state.

### Pitfall 2: Selection "Dead Zones"
**What goes wrong:** Clicking certain parts of the `ChartUnit` (like header buttons) doesn't trigger selection.
**Why it happens:** Child elements call `e.stopPropagation()` to handle their own logic (e.g., opening a dropdown), blocking the selection event.
**How to avoid:** Use a root-level `onClick` and carefully audit where `stopPropagation` is used.

## Code Examples

### Unified Selection Wrapper
```typescript
// Recommended implementation for ChartUnit.tsx
<div 
  ref={cardRef}
  className={`chart-card ${isSelected ? 'is-selected' : ''}`} 
  onClick={() => onSelect()} // Root level selection
>
  <ChartHeader onSelect={onSelect} ... />
  <div className="chart-panes">
    <ChartCanvas ... />
  </div>
</div>
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zustand is already installed | Standard Stack | Low - trivial to install if missing |
| A2 | LocalStorage is the intended persistence | Summary | Medium - if a DB is planned, the store needs async sync |

## Open Questions

1. **Group Persistence:** Should group memberships be synced to a database or remain in `localStorage`?
   - What we know: Currently using `localStorage`.
   - Recommendation: Keep as is for now, but encapsulate in the Store to allow easy migration to an API.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Quick run command | `npm test` |

### Phase Requirements $	o$ Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEL-01 | Any click in ChartUnit focuses chart | integration | `vitest tests/integration/viewport.test.ts` | ❌ Wave 0 |
| GRP-01 | Grouped charts sync symbol on mount | unit | `vitest tests/unit/group-sync.test.ts` | ❌ Wave 0 |
| GRP-02 | Ticker changes propagate without lag | integration | `vitest tests/integration/sync-lag.test.ts` | ❌ Wave 0 |

### Wave 0 Gaps
- [ ] `tests/integration/selection.test.ts` — verify selection triggers on all unit areas.
- [ ] `tests/integration/group-sync.test.ts` — verify atomic ticker updates across multiple `ChartUnit`s.
