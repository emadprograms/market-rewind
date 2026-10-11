# Roadmap: Market Rewind

## Shipped Milestones

Phase numbering is continuous across milestones; it never restarts at 01.

| Milestone | Name | Phases | Shipped | Archive |
|-----------|------|--------|---------|---------|
| v1.0 | Stability Guardrails & Multi-Chart Core | 1-4 | 2026-09-25 | [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) |
| v2.0 | Tick-by-Tick Streaming Engine & Modern UI | 5-8 | 2026-09-26 | [v2.0-ROADMAP.md](./milestones/v2.0-ROADMAP.md) |
| v3.0 | Pure Tick-by-Tick Replay & Temporal Isolation Engine | 9-13 | 2026-09-26 | [v3.0-ROADMAP.md](./milestones/v3.0-ROADMAP.md) |
| v3.1 | Pure Streaming DuckDB Replay Engine, Global Multi-Asset Sync & Playwright Hardening | 14-19 | 2026-09-26 | [v3.1-ROADMAP.md](./milestones/v3.1-ROADMAP.md) |
| v3.2 | High-Performance Chart Playback & Data Reliability Engine | 20-25 | 2026-09-28 | [v3.2-ROADMAP.md](./milestones/v3.2-ROADMAP.md) |
| v4.0 | Canonical Single-Database Replay Engine & Defect Elimination | 26-30 | 2026-09-29 | [v4.0-ROADMAP.md](./milestones/v4.0-ROADMAP.md) |
| v4.1 | Replay Convergence, State Machine Synchronization & Transition Integrity | 31-33 | 2026-09-30 | [v4.1-ROADMAP.md](./milestones/v4.1-ROADMAP.md) |
| v4.2 | State Machine Convergence & Temporal Strictness | — | 2026-09-30 | [v4.2-ROADMAP.md](./milestones/v4.2-ROADMAP.md) |
| v4.3 | Live Data Stabilization and Testing | 34-38 | 2026-09-30 | `milestones/v4.3-phases/` |
| v5.0 | Partitioned Parquet Tick Lake Integration (Repo B Contract Compliance) | 39-42 | 2026-10-06 | [v5.0-ROADMAP.md](./milestones/v5.0-ROADMAP.md) |

**Current milestone:** none active — awaiting `/gsd-new-milestone`.

**Archive conventions:** each milestone keeps its full phase detail at
`milestones/v{X.Y}-ROADMAP.md`, its requirements at `milestones/v{X.Y}-REQUIREMENTS.md`, and its
executed phase directories at `milestones/v{X.Y}-phases/`. Full delivery notes, stats, and any
verification overrides live in [MILESTONES.md](./MILESTONES.md).

**Next milestone (planned):** mock Capital.com order terminal — offline simulated order engine
(market/limit/stop, cancel/amend, SL/TP, latency profiles, explanatory timelines). Source plan:
`docs/research/capital-order-simulator-implementation-plan.md`. Not yet scoped into phases.
