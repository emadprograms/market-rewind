# Milestone v6.0 Roadmap: Offline Order Simulator (Mock Capital.com Terminal)

**6 phases** | **38 requirements mapped** | All covered ✓

Phase numbering continues from v5.0 (which ended at 42). Source plan:
`docs/research/capital-order-simulator-implementation-plan.md`. Research: `.planning/research/`.

| # | Phase | Goal | Requirements | Success Criteria | Status |
|---|-------|------|--------------|------------------|--------|
| 43 | Pilot Evidence Audit & Collector Repair | Normalise the eight saved demo run bundles into offline fixtures with provenance, and repair the collector's known defects without running it | SIM-EVIDENCE-01, SIM-EVIDENCE-02, SIM-EVIDENCE-03 | 3 | PENDING |
| 44 | Pure Deterministic Engine, Scheduler & Profiles | Build the dependency-free order engine, deadline scheduler, quote resolver, and latency profiles that make delay change execution | SIM-ENGINE-01..06, SIM-QUOTE-01..06, SIM-LATENCY-01..05 | 4 | PENDING |
| 45 | Replay & Session Integration | Feed the engine every crossed tick on replay time and make pause, step, seek, and reset deterministic without reviving the seek freeze | SIM-REPLAY-01..07 | 4 | PENDING |
| 46 | Shared Account & Chart Projection | Replace chart-local instant fills with one engine-authoritative account so PnL and positions cannot double-count across charts | SIM-ACCOUNT-01..05 | 3 | PENDING |
| 47 | Ticket, Activity, Timeline & Settings | Deliver the order terminal UI: ticket, order/position activity, per-order timeline, and editable latency profiles | SIM-UI-01..06 | 3 | PENDING |
| 48 | Regression Verification & Handover | Prove the behavioural matrix and regression immunity, and document defaults, provenance, and limitations | SIM-VERIFY-01, SIM-VERIFY-02 | 3 | PENDING |

---

## Phase Details

### Phase 43: Pilot Evidence Audit & Collector Repair
- **Goal:** Convert the pilot's raw bundles into trustworthy offline fixtures, and make the collector fit for a later Stage 2 run — without executing it.
- **Requirements:** SIM-EVIDENCE-01, SIM-EVIDENCE-02, SIM-EVIDENCE-03
- **Success criteria:**
  1. A new offline analysis script parses all relevant run bundles and joins submission → affected position → stop linkage → failed cleanup → later recovery, recomputing response times and observation intervals while retaining raw clock-domain fields. No network call occurs.
  2. A derived audit document states how the unsupported numerical assumptions are superseded (209 ms mixed clock, 2499 ms observation gap, 816.5 ms including a 400 ms polling wait, no measured distribution), and sanitized fixtures with stable local aliases land under `tests/fixtures/orderSimulator/`. Original raw artifacts are untouched.
  3. The collector's defects are repaired behind tests but never executed: affected-position-ID cleanup, non-2xx reconciliation, consumed working orders, snapshot-derived unresolved state, CSV outcome persistence, recorded subscription results, no generic credential fallback, bounded requests/timeouts, dispatch-aligned clock probes, and a success message gated on observed final state.

### Phase 44: Pure Deterministic Engine, Scheduler & Profiles
- **Goal:** Build the dependency-free engine whose output depends only on tape, commands, and profile.
- **Requirements:** SIM-ENGINE-01..06, SIM-QUOTE-01..06, SIM-LATENCY-01..05
- **Success criteria:**
  1. `src/lib/orderSimulator/**` models distinct request/order/fill/position identities, the full lifecycle state machine, idempotent notices, and PnL with retained spread cost — with no React, IO, wall clock, or randomness (enforced by a guard test).
  2. Quote resolution is provenance-carrying and instrument-rule-driven, with correct quote sides, **stop** semantics (never the MIT inverse), inclusive equality, latched triggers, boundary-respecting limits, and submit-time plus arrival-time validation.
  3. Latency is modelled as separated, editable, provenance-labelled components with three profiles and per-command snapshots; the pilot's 231.499 / 203.837 / 204.384 ms envelopes appear only as reference samples and never as a fitted distribution.
  4. The engine passes the plan §10 business cases, including a price excursion that crosses and returns inside one simulated frame, a late cancellation, and a delayed limit that cannot fill worse than its boundary — and the same tape plus commands plus profile always yields identical events.

### Phase 45: Replay & Session Integration
- **Goal:** Connect one engine to the existing replay clock and session lifecycle so market-time and instruction-time advance together.
- **Requirements:** SIM-REPLAY-01..07
- **Success criteria:**
  1. Every tick traversed by playback reaches the engine with a typed movement reason; deadlines and quotes are merged chronologically and evaluated only against quote history available at that instant.
  2. Identical command schedules produce identical fills and PnL at 1×, 10×, and large batched frames; pause freezes price progression and instruction deadlines together.
  3. Forward seek evaluates the skipped path; backward seek discards future actions and branches with a single user notice; session reset begins a fresh session ID without fabricating closing fills; timeframe and ordinary symbol changes are treated as view changes only.
  4. Exposure symbols are consumed even when hidden, advancement freezes through missing tape rather than filling against a future or foreign quote, and the existing dense replay/seek performance suites show no revived freeze or dropped events.

### Phase 46: Shared Account & Chart Projection
- **Goal:** Make the engine the single source of economic truth so duplicated charts cannot multiply trades or PnL.
- **Requirements:** SIM-ACCOUNT-01..05
- **Success criteria:**
  1. BUY/SELL/Close/drag route through engine commands; no selector, chart primitive, badge effect, or Strict Mode remount mutates economic state.
  2. Two charts displaying the same symbol show one order/position set and one portfolio total; switching a chart's symbol cannot change a position's symbol or execution price.
  3. Entries open independent positions with default attachments off; SL/TP form one shared closing group where a latched SL or accepted manual close reserves the close and a merely-eligible TP cannot disable the SL.
  4. Markers and badges project working levels, positions, SL/TP, and fills bound by ID and symbol, so detaching a chart changes only its view.

### Phase 47: Ticket, Activity, Timeline & Settings
- **Goal:** Deliver the terminal UI that makes delay, pending state, and lost races inspectable.
- **Requirements:** SIM-UI-01..06
- **Success criteria:**
  1. The ticket supports Market/Limit/Stop, BUY/SELL, increment-valid quantity, pending levels, optional SL/TP, live bid/ask and spread, estimated delay, and a profile label — and never shows a position merely because submit was clicked.
  2. Order and position activity expose sending/working/triggered/executing/filled/cancelled/rejected states, with pending rows stating the exact price side and condition, and lost cancel races acknowledged plainly.
  3. The timeline separates submitted, broker arrival, accepted/working, quote eligible, executed, and notice received, distinguishing execution delay, market waiting time, and notification delay with the quote side and reason at each transition.
  4. Delay settings are editable with inspectable provenance and per-command snapshots; evidence reference cards stay separate from simulated output; accessibility and "Simulated account" labelling are in place.

### Phase 48: Regression Verification & Handover
- **Goal:** Prove the milestone and document exactly what is measured, assumed, and excluded.
- **Requirements:** SIM-VERIFY-01, SIM-VERIFY-02
- **Success criteria:**
  1. The full plan §10 behavioural matrix passes, including cancel-before vs cancel-after-trigger, latched triggers across gaps, single close under competing exits, idempotency under repeated notices and remounts, intra-frame cross-and-return, pause/speed/step/seek equivalence, rewind branching, and offline operation after data load.
  2. The focused engine/account suites, existing frontend suite, production build, and available browser verification pass with recorded results; tests asserting instant fills, fabricated quote sides, or implicit netting in the realistic path are replaced rather than preserved.
  3. Documentation records defaults and provenance, independent-position mode, pause/seek behaviour, the unknown broker timing, data requirements, and how a later Stage 2 can calibrate profiles — with the environment limitation of any unrun suite disclosed rather than claimed as passed.

---

## Shipped Milestones

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
