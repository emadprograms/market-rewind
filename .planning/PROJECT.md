# Market Rewind - Stability & Maintenance Wrap-up

## What This Is
Market Rewind is a zero-read, local-first market replay tool. The project is functionally complete but has entered a "fragile" state where critical UI behaviors (viewport stability and symbol grouping) are regressing. This phase is focused on hardening the system for long-term maintenance.

## Core Value
The system must be deterministic and stable; a user should be able to replay markets and manage layouts without unpredictable viewport jumps or synchronization failures.

## Requirements

### Validated
- ✓ Basic market replay engine — existing
- ✓ Local-first storage (OPFS/sql.js) — existing
- ✓ Multi-chart layouts and resizable panels — existing
- ✓ Basic trade execution and P&L tracking — existing
- ✓ TypeScript modularization — existing

### Active
- [ ] **STAB-01**: Deterministic Viewport Management (No "single candle" loads or violent jumps during infinite scroll).
- [ ] **SYNC-01**: Bulletproof Selection & Grouping (100% reliable focus and symbol synchronization on mount and change).
- [ ] **QUAL-01**: Regression Guardrails (Automated test suite for critical stability paths).
- [ ] **QUAL-02**: Fragility Map (Documentation of high-risk "danger zones" in the codebase).
- [ ] **QUAL-03**: Technical Debt Audit (Identification and resolution of systemic fragility).

### Out of Scope
- New feature development (unless required for stability).
- Performance optimizations that don't directly address stability/fragility.

## Context
The app has been refactored from a JS "God Component" to a TS modular architecture. While the structure is better, complex interactions between `useChartData`, `useChartLifecycle`, and `useWorkspace` have introduced race conditions and state synchronization bugs. The developer wants a "Stability Baseline" to ensure the app is maintainable and verifiable.

## Constraints
- **Tech Stack**: Must stay within the existing React/TS/Lightweight-Charts/sql.js stack.
- **Stability First**: No change should be merged without a corresponding verification check (test or manual script).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Stability Baseline Approach | Move from "patching bugs" to "establishing a verifiable baseline" to ensure long-term maintainability. | — Pending |

## Evolution
This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-01 after initialization*
