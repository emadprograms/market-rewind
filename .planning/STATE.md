---
gsd_state_version: "1.0"
milestone: v6.0
milestone_name: "Offline Order Simulator (Mock Capital.com Terminal)"
status: In progress
last_updated: "2026-10-12T00:10:00.000Z"
last_activity: 2026-10-12
last_activity_desc: Milestone v6.0 started — research, requirements and roadmap defined
state_head: 0736e99
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Milestone: v6.0 — Offline Order Simulator (Mock Capital.com Terminal)

### Completed Milestones

- **Milestone v1.0**: Stability Guardrails & Multi-Chart Core (Shipped 2026-09-25)
- **Milestone v2.0**: Tick-by-Tick Streaming Engine & Modern UI (Shipped 2026-09-26)
- **Milestone v3.0**: Pure Tick-by-Tick Replay & Temporal Isolation Engine (Shipped 2026-09-26)
- **Milestone v3.1**: Pure Streaming DuckDB Replay Engine, Global Multi-Asset Sync & Playwright Hardening (Shipped 2026-09-26)
- **Milestone v3.2**: High-Performance Chart Playback & Data Reliability Engine (Shipped 2026-09-28)
- **Milestone v4.0**: Canonical Single-Database (`streaming.db`) Replay Engine & Defect Elimination (Shipped 2026-09-29)
- **Milestone v4.1**: Replay Convergence, State Machine Synchronization & Transition Integrity (Shipped 2026-09-30)
- **Milestone v4.2**: State Machine Convergence & Temporal Strictness (Shipped 2026-09-30)
- **Milestone v4.3**: Live Data Stabilization and Testing (Shipped 2026-09-30)
- **Milestone v5.0**: Partitioned Parquet Tick Lake Integration (Repo B Contract Compliance) (Shipped 2026-10-06)

## Project Reference

See: [.planning/PROJECT.md](./PROJECT.md)
See: [.planning/REQUIREMENTS.md](./REQUIREMENTS.md)
See: [.planning/ROADMAP.md](./ROADMAP.md)

**Core value:** High-fidelity, deterministic tick-by-tick market replay with sub-second timeframes, dynamic Parquet tick lake resampling, multi-symbol global playback synchronization, and absolute temporal isolation (zero future data leakage).
**Current focus:** Building an offline order terminal whose transmission and execution delays change execution outcomes. Source plan: `docs/research/capital-order-simulator-implementation-plan.md`; research: `.planning/research/`.

## Current Position

Phase: Not started — roadmap defined (phases 43–48)
Plan: —
Status: In progress
Last activity: 2026-10-12 — Milestone v6.0 started (research, requirements, roadmap)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|

## Operator Next Steps

- Begin Phase 43 with /gsd-plan-phase 43 (or /gsd-discuss-phase 43 first)

## Deferred Items

| Item | Carry-forward | Rationale |
|------|---------------|-----------|
| Playwright journey suite cannot run in-sandbox (no obtainable browser binary) | From v5.0 (LAKE-VERIFY-02 override) | Adds NSS/browser deps unavailable here; run `npx playwright install chromium && npm run test:journey` on a machine with a browser. Phase 48 must disclose rather than claim a pass. |
| Stage 2 latency calibration | Deferred to a later milestone | v6.0 repairs the collector but executes nothing against Capital.com. |
