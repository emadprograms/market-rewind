# Architecture Research

**Domain:** Offline deterministic order-execution simulator inside a tick-replay charting app
**Researched:** 2026-10-12
**Confidence:** HIGH
**Scope:** How the NEW order-terminal capabilities integrate with the EXISTING replay engine

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  UI LAYER (React)                                                        │
│   OrderTicket · OrderActivityPanel · OrderTimeline · ExecutionSettings   │
│   ChartUnit / ChartCanvas / TradeBadge  (existing, now ID-projected)     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ selectors only (never mutates)
┌───────────────────────────────▼──────────────────────────────────────────┐
│  ADAPTER LAYER                                                           │
│   useOrderSimulatorStore (zustand, ONE per session)                      │
│   usePortfolio → account-wide selectors (dedup by entity ID)             │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ commands + tick batches + clock events
┌───────────────────────────────▼──────────────────────────────────────────┐
│  PURE ENGINE  src/lib/orderSimulator/**   (no React · no IO · no clock)  │
│   types.ts      entities, branded IDs, states                            │
│   engine.ts     command handling + state transitions                     │
│   scheduler.ts  (fireTime, tieBreakSeq) deadline heap + quote merge      │
│   quotes.ts     symbol quote resolver + provenance + freshness           │
│   profiles.ts   latency profiles + provenance labels                     │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ every crossed tick + target time
┌───────────────────────────────┴──────────────────────────────────────────┐
│  REPLAY LAYER (existing)                                                 │
│   usePlaybackStore  (clock, tick buffer, seekEpoch)                      │
│   PlaybackManager   (wall-time × speed → replay time; the ONLY clock)    │
│   stream / buffer loading, session + date lifecycle                      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Must NOT do |
|---|---|---|
| `PlaybackManager.tsx` | Convert wall time → replay time | Contain any order logic |
| `usePlaybackStore` | Own the replay clock, tick buffer, movement reason, `seekEpoch` | Evaluate orders; resume from `currentTick` watching alone |
| Engine (`src/lib/orderSimulator`) | All economic transitions; authoritative state + scheduled notices | Read a clock, touch React, touch storage, use randomness |
| `useOrderSimulatorStore` | Session-scoped adapter; command API; projection into React | Re-derive or "fix up" economic state for display |
| `useTradeManager.ts` | **Replaced** by engine commands + a thin render adapter | Instant-fill, net counter-orders, synthesise spread |
| `usePortfolio.ts` | Select unique account entities | Accept per-chart PnL or per-chart position lists |
| `ChartUnit` / `TradePlugin` | Project account entities into markers by ID + symbol | Hold trade state; mutate on mount/unmount |

---

## Recommended Project Structure

```
src/
├── lib/orderSimulator/          # NEW — pure, dependency-free, browser+node
│   ├── types.ts                 # entity + event + profile types
│   ├── engine.ts                # command handling, transitions, PnL
│   ├── scheduler.ts             # deadline heap + chronological quote/deadline merge
│   ├── quotes.ts                # quote resolution, freshness, provenance
│   ├── profiles.ts              # latency profiles + provenance labels
│   └── selectors.ts             # pure projections (orders, positions, timeline)
├── store/useOrderSimulatorStore.ts   # NEW — session-scoped adapter
└── components/                  # NEW — OrderTicket, OrderActivityPanel, OrderTimeline, ExecutionSettings
tests/
├── unit/orderSimulator.test.ts        # engine business cases
├── unit/orderSimulatorRaces.test.ts   # cancel/amend/close races + idempotency
├── unit/orderSimulatorReplay.test.ts  # 1x vs 10x vs batched equivalence
└── integration/orderSimulatorAccount.test.tsx
```

### Structure Rationale

- **`lib/` not `store/`:** the engine must be importable by tests, by the offline evidence script,
  and by the browser without pulling React or zustand.
- **One store, session-scoped:** registered once per session, not per chart — the direct fix for
  duplicate-chart double counting.
- **`selectors.ts` is pure and separate:** UI reads projections; nothing recomputes economics.

---

## Architectural Patterns

### Pattern 1: Virtual-clock discrete-event scheduler

A heap of `(fireTime, tieBreakSeq, task)`. `now()` **never advances on its own** — time moves only
when the interval processor explicitly pops the next event. This is the VirtualClock pattern from
the sources, and it is what makes pause, step, seek, and speed-changes exact rather than
approximate. Deterministic tie-break for identical replay timestamps: **stable tape sequence for
quotes, then scheduling sequence for due commands.**

### Pattern 2: Two-clock state split (authoritative vs observed)

The engine holds authoritative simulated-broker state *and* a client-visible projection advanced by
scheduled notices. A fill can occur before the UI learns it; the timeline may reveal both clocks for
teaching. Every notice must be idempotent — re-delivery must not create a second fill, position, or
realised PnL. This is what makes the sim honest and what protects against React Strict Mode
double-invocation.

### Pattern 3: Interval processor (never evaluate the frame's final quote)

Merge the quote stream and the deadline queue chronologically; advance to each next event, process it
using only quotes available by that time, then continue to the target frame time. Watching
`currentTick` in a React effect is **insufficient** — it silently drops threshold crossings inside a
fast frame. The repo has already been bitten by this exact class of bug (see PITFALLS P5).

### Pattern 4: Checkpoint + command log for seek/branch

Persist an in-memory command log alongside profile settings. Forward seek *evaluates* the skipped
path. Backward seek discards future fills/PnL and starts a new branch by truncating future user
commands, with one user-facing notice. Reconstruct from a checkpoint + the relevant prefix rather
than re-simulating from session start.

### Pattern 5: Provenance-carrying parameters

Every latency/price parameter is a value *plus* a source label, snapshotted into each command at
submission. Editing settings affects future commands only; completed or already-scheduled work keeps
its original snapshot.

---

## Data Flow

### Command Flow

```
Ticket submit → command { requestId, snapshot(profile), capturedQuoteId, replayTime }
   → store → engine.submit()
        → schedule travel delay  → ACCEPTED   (validation runs AT ARRIVAL, not at click)
        → WORKING | EXECUTING
        → FILLED | CANCELLED | REJECTED(reason)
   → events appended → notice scheduled → projection updated → UI + chart markers
```

### Key Data Flows

1. **Quote flow:** buffer → ordered ticks → engine (only symbols with active exposure need full tape;
   a symbol with no orders/positions can be skipped for speed).
2. **Deadline flow:** command/travel, acceptance, execution dispatch, and notification delays each
   schedule separately so the timeline can show them as distinct intervals.
3. **Projection flow:** engine state → selectors → React/chart. Never the reverse.

---

## Scaling Considerations

| Concern | Approach |
|---|---|
| Dense tape at high speed | Process events without per-tick React updates; publish one projection at frame end (or bounded progress) |
| Large seek | Chunk work or move to a worker only if dense-tape fixtures show a main-thread stall — do not add another animation loop |
| Multiple charts, one symbol | Evaluate once per account entity; charts are views |
| Hidden symbol with live exposure | Still consume that symbol's tape (exposure, not visibility, decides) |
| Missing/unloaded tape | Freeze advancement, show loading state, resume from the same engine cursor; never fill against a future or foreign quote |

---

## Anti-Patterns

### Anti-Pattern 1: Wall-clock mutation of economic state

Any `setTimeout`/`rAF` that changes an order or position. Breaks pause, breaks speed-independence,
makes tests flaky, and cannot be fast-forwarded by a seek. The engine takes time as a parameter.

### Anti-Pattern 2: Frame-final-quote evaluation

Evaluating deadlines against only the last tick of a frame. A price that crosses and returns inside
one frame must still trigger; a test must exist that fails under final-tick-only logic.

### Anti-Pattern 3: Business logic in selectors or render effects

React Strict Mode remounts, badge effects, and selector re-runs must not execute transitions.
Duplicate notices must not double-apply.

### Anti-Pattern 4: Identity by array index

Buffer prepends and merges (existing app behaviour) renumber indices. Quote identity must survive;
use stable source sequence, not position in an array.

### Anti-Pattern 5: Resetting the engine on every `seekEpoch` change

`seekEpoch` also bumps for ordinary single steps. Resetting on every change would discard state on a
normal forward step; the engine must instead *execute the crossed path*.

---

## Sources

- VirtualClock (heap + seq tie-break, `now()` never advances alone, `run_until_idle`): https://www.thegreenreport.blog/articles/deterministic-simulation-testing-a-practical-guide-for-qa-engineers/deterministic-simulation-testing-a-practical-guide-for-qa-engineers.html
- Injected simulation clock; "scheduler decisions use simulation time"; simulation behaviour vs application infrastructure: https://github.com/golgimed/mimic/issues/27
- Guaranteeing a race deterministically by controlling event timing: https://adhdecode.com/distributed-systems/testing-distributed-systems/deterministic-simulation/
- Determinism digest table (identical inputs ⇒ identical digest; wall clock +1 day unchanged): https://github.com/payswapdotorg/TradRL-2.0/pull/9
- Event log as sole source of truth; live and replay share one code path: https://github.com/alicegogogogogo/matchbook
- Repo-internal: plan §3 (ownership map), §5 (clock/scheduling/replay), §4 (domain contract)
