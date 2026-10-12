# Stack Research

**Domain:** Offline deterministic order-execution simulator (retail CFD broker model)
**Researched:** 2026-10-12
**Confidence:** HIGH
**Scope:** NEW capabilities only — offline order terminal for Milestone v6.0

---

## Executive Summary

**This milestone adds zero runtime dependencies.** The engine must be pure TypeScript that runs
without React, HTTP, browser storage, or a wall clock, so that a given (tape + commands + profile)
always produces identical events. Every candidate dependency for this domain (decimal libraries,
scheduler libraries, order-book libraries) either breaks that property or is unnecessary at the
fidelity this milestone targets.

---

## Recommended Stack

### Core Technologies (all already present)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| TypeScript | existing (`tsconfig.json`) | Engine + UI | Engine needs typed entity separation (request/order/fill/position IDs are all strings today — a type error waiting to happen) |
| Zustand | existing (`src/store/`) | One session-scoped engine store | Repo already uses zustand for `usePlaybackStore`; adding a second state lib would fork the replay clock |
| Vite | existing (`vite.config.ts`) | Build | No change |
| Vitest | existing (`vitest.config.ts`) | Engine unit tests | Engine is pure → tested with plain `vitest run`, no jsdom, no fake timers |
| Playwright | existing | Journey/browser gates | Env-blocked in sandbox (see PITFALLS); maintainer machine only |

### Supporting Libraries

**None.** Deliberate.

| Need | Decision | Why not a library |
|---|---|---|
| Deterministic scheduler | Inline binary heap over `(fireTime, tieBreakSeq)` | A promise/timer library reintroduces wall-clock coupling; the heap is ~40 lines and matches the VirtualClock pattern in the sources |
| Price arithmetic | Scaled-integer arithmetic (`price / tickSize` as integers, `decimalPlacesFactor` for display) | Never compare floats for tick increments or limit boundaries. `decimal.js` would work but a scaled integer is exact, dependency-free, and serialises cleanly into the event log |
| Order book | **Not required** | This milestone models full fills against a single quoted bid/ask stream with no depth and no partial fills. A real LOB/matching engine solves a problem this milestone explicitly excludes |
| Event log / digests | Plain JSON + a cheap FNV-1a/djb2 hash of the canonical event stream | Same technique as the "determinism digest" pattern (see Sources); no hashing dependency needed |

### Development Tools

| Tool | Purpose | Notes |
|---|---|---|
| `vitest` | Engine, races, replay determinism | Add `tests/unit/orderSimulator*.test.ts` per plan §10 |
| A guard test asserting no clock/random calls in the engine | Enforce P4 | Static scan of `src/lib/orderSimulator/**` for `Date.now`, `performance.now`, `setTimeout`, `setInterval`, `Math.random`. This is the cheapest possible defence for the milestone's central invariant |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why not |
|---|---|---|---|
| Simulator time | Replay-market ms passed in as a parameter | Reuse `Date.now()` + offsets | The whole milestone depends on pause/step/seek speed-independence; wall time cannot express "paused" |
| Scheduler | Explicit heap merged with the quote stream | `setTimeout` per deadline | `setTimeout` fires on wall time and would keep firing while replay is paused. It also cannot be fast-forwarded by a seek |
| Scheduler (alt) | Same | `requestAnimationFrame` | Ties deadlines to render cadence, dropping intermediate crossings (P5) |
| Entity identity | Separate `requestId`/`orderId`/`fillId`/`positionId` branded types | Reuse a single `dealId` | The pilot's own cleanup failure is this exact bug (P3) |
| Delay modelling | Fixed profiles (Training / pilot reference / Zero-delay) | `Normal(210 ms, 20 ms)` fitted distribution | Section 1 of the plan rejects it: one sample per order type cannot establish variance. Inventing a distribution is a correctness-of-claim failure, not a nice-to-have |
| Store | One session-scoped `useOrderSimulatorStore` | Per-chart state (today's `useTradeManager`) | Per-chart state is why duplicate charts double-count PnL today |

---

## What NOT to Use

| Anti-pattern | Reason |
|---|---|
| `setTimeout` / `setInterval` / `requestAnimationFrame` anywhere inside `src/lib/orderSimulator/**` | Mutates state on wall time. Breaks pause, breaks speed-independence, breaks seek determinism |
| `Date.now()`, `new Date()`, `performance.now()` inside the engine | Same. Engine must receive time; it must never ask for it |
| `Math.random()` inside the engine | Non-deterministic. Jitter, if ever added, is seeded and sampled once per command at submission time, outside the core |
| A broker SDK / `capital-com` REST client in `src/` | Acceptance criterion #7: the terminal contains no broker transport or credential dependency |
| Extending the existing instant-fill path in `useTradeManager.ts` | Its synchronous fill + counter-order netting + synthetic ±0.01 spread are the exact behaviours this milestone replaces |
| A real matching-engine library | Requires depth and partial fills, both explicitly out of scope |
| Float equality on tick increments | `0.05` is not representable in binary floating point; "valid tick multiple" checks must be integer-based |

---

## Version Compatibility

- No new packages → no new compatibility surface.
- Node in this sandbox is `v22.22.3`; `@opengsd/gsd-core@1.16.0` declares `engines.node >= 24` (warning only — GSD is planning tooling, never shipped in the app).
- Engine must not depend on Node APIs (no `fs`, no `process`) so the same module runs in the browser, in Vitest, and in the offline evidence-analysis script.

---

## Sources

- Deterministic engine design (event log as sole source of truth; "at comes from the process clock and only records when an event happened; matching never reads it"): https://github.com/alicegogogogogo/matchbook
- Virtual clock with heap + sequence tie-break, `run_until_idle`, "nothing in the code under test can sneak in real wall-clock behavior": https://www.thegreenreport.blog/articles/deterministic-simulation-testing-a-practical-guide-for-qa-engineers/deterministic-simulation-testing-a-practical-guide-for-qa-engineers.html
- Simulation clock vs wall clock separation and "make simulation time visible": https://github.com/golgimed/mimic/issues/27
- Single-threaded matching for determinism; integer ticks only, "no floating point value ever reaches the matching engine": https://www.techinterview.org/post/3233477258/matching-engine-price-time-priority-system-design/
- Determinism digests across identical inputs and wall-clock shifts: https://github.com/payswapdotorg/TradRL-2.0/pull/9
