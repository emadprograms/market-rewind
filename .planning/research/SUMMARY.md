# Project Research Summary

**Project:** Market Rewind — Offline Order Simulator / Mock Capital.com Terminal
**Milestone:** v6.0
**Domain:** Deterministic order-execution simulation (retail CFD broker model) inside a tick-replay charting app
**Researched:** 2026-10-12
**Confidence:** HIGH

---

## Executive Summary

Market Rewind is adding an offline order terminal: the user places market, limit, and stop orders
against the replayed bid/ask tape, and **transmission and execution delays change the outcome** —
a market order fills at a different ask, a cancel loses a race against a trigger, a limit refuses to
fill worse than its boundary. The milestone is defined by
`docs/research/capital-order-simulator-implementation-plan.md`, whose Section 1 is a correction
sheet: it explicitly rejects the earlier narrative report's 209 ms / 2499 ms / 816.5 ms figures and
the `Normal(210 ms, 20 ms)` distribution as measurements.

The research converges on one dominant conclusion: **this milestone is won or lost on time and
identity discipline, not on features.** The engine must be pure TypeScript that *receives* replay
time and never reads a clock; identity must be split across request/order/fill/position; and the
interval processor must see *every crossed tick*, not the frame's final snapshot — which is the same
class of bug this repo has already fixed twice in its playback layer.

Three independent external sources confirm the architectural choices: the VirtualClock pattern
(heap of `(fireTime, seq)`, `now()` never advances on its own), the "live and replay share one code
path, event log as sole source of truth" pattern, and explicit multi-run determinism digests proving
wall-clock independence. The single highest-risk correctness item is **Pitfall 1 — stop/MIT trigger
inversion**, for which a production trading engine (`nautilus_trader`) filed a live bug report in
September 2026.

Stack impact is deliberately zero: **no new runtime dependencies.**

---

## Key Findings

### Recommended Stack

Zero new runtime dependencies. The engine lives in `src/lib/orderSimulator/` as pure TypeScript with
no React, no IO, no clock, no randomness. Scheduling is an inline `(fireTime, tieBreakSeq)` binary
heap; price arithmetic is scaled-integer (never float equality on tick multiples); one session-scoped
zustand store adapts the engine to React. Reject any dependency that reintroduces wall-clock
coupling. See [STACK.md](./STACK.md).

### Expected Features

Table stakes: BUY/SELL market, limit, and stop entries; cancel; amend; explicit close; attached
SL/TP; order/position lists; status lifecycle; long/short PnL; chart markers. Differentiators:
delay that genuinely changes execution, two-clock transparency (broker-processed vs client-visible),
provenance labels on every parameter, explainable lost races, and a zero-delay comparison profile.
Anti-features to refuse explicitly: partial fills, netting, trailing/guaranteed stops, stop-limit,
margin/swap/commissions, any broker transport, and any fitted latency distribution presented as
measured. See [FEATURES.md](./FEATURES.md).

### Architecture Approach

Five layers: existing replay layer (`usePlaybackStore` + `PlaybackManager` own the only clock) →
pure engine → session-scoped store adapter → account-wide selectors → UI/chart projection. Five
patterns carry the design: virtual-clock scheduler, two-clock authoritative/observed state split
with idempotent notices, interval processor merging quotes and deadlines chronologically,
checkpoint + command log for seek/branch, and provenance-carrying parameter snapshots. The engine
must be authoritative; React selectors, chart primitives, badges, and Strict Mode remounts must
never execute economic transitions. See [ARCHITECTURE.md](./ARCHITECTURE.md).

### Critical Pitfalls

1. **Stop/MIT trigger inversion** (highest risk — real engines ship this).
2. **Observation time mistaken for execution time** (the plan's own correction sheet).
3. **Request/order/position identity conflation** (caused the pilot's failed cleanup).
4. **Wall-clock leakage** into the engine.
5. **Frame-final-quote evaluation** losing intra-frame crossings (repo has hit this class twice).
6. **Non-idempotent notices / remounts** double-applying fills.
7. **Trigger-latch violation** (un-triggering a stop, or disabling an SL while a TP is only
   *eligible*).
8. **Identity by buffer index** across prepends/merges.
See [PITFALLS.md](./PITFALLS.md).

---

## Implications for Roadmap

### Phase 43: Pilot Evidence Audit & Offline Fixtures
Normalise the eight saved run bundles into derived fixtures with stable aliases; recompute response
times; keep unsupported metrics explicitly unavailable; link the submission/position/stop IDs, the
two failed cleanup attempts, and the later successful recovery. Rewrite the collector's known bugs
(affected-position IDs, non-2xx cleanup reconciliation, consumed working orders, unconditional
success message, missing timeouts, mis-aligned clock probe) **without executing it**.
**Delivers:** trustworthy fixtures + provenance labels, and the collector ready for a later Stage 2.
**Avoids:** P2, P3.

### Phase 44: Pure Deterministic Engine, Scheduler & Profiles
`src/lib/orderSimulator/**`: entity types, state transitions, deadline heap, chronological merge,
quote resolver, latency profiles with provenance, PnL. Independently testable with no React, HTTP,
storage, or timers. **Delivers:** the core property — same tape + commands + profile ⇒ same events.
**Avoids:** P1, P4, P7.

### Phase 45: Replay & Session Integration
Register one engine at session scope; feed every crossed tick with typed movement reasons; handle
gaps, exposure-driven symbol loading, buffer merges, forward/backward seek with command-log
branching, session resets, and stale async responses — without reviving the seek/render freeze.
**Delivers:** 1×/10×/batched equivalence and deterministic pause/step/seek/reset.
**Avoids:** P5, P8.

### Phase 46: Replace Chart-Local Trading & Portfolio Accounting
Route BUY/SELL/Close/drag through engine commands; select account entities by ID and symbol; use
existing marker primitives for multiple positions and working orders; count PnL once per account
entity regardless of chart duplication. **Delivers:** no double counting, symbol changes that cannot
relabel a position. **Avoids:** P6 and the integration gotchas.

### Phase 47: Ticket, Status Panels, Timeline & Settings
Market/Limit/Stop ticket with validation and ticket-side bid/ask; order and position activity with
explicit pending states; per-order timeline separating price waiting, economic execution, and client
observation, with provenance; editable delay profiles snapshotted per command; synthetic teaching
tapes for market movement, a missed limit, a stop gap, and a cancellation race. **Avoids:** the UX
pitfalls, especially hiding a fill when Cancel was pressed.

### Phase 48: Regression Verification & Implementation Handover
Run the behavioural matrix from plan §10, the existing dense replay/seek performance tests, the
frontend suite, and the build; document defaults, provenance, independent-position mode, pause/seek
behaviour, unknown broker timing, data requirements, and how Stage 2 can calibrate profiles.

### Phase Ordering Rationale

Evidence before engine (provenance must be right before any number is embedded) → engine before
integration (the pure core is the only part that can be tested exhaustively) → integration before
account replacement (the engine must be authoritative before charts stop owning trades) → UI last
before verification (the timeline is a *view* of engine truth, and building it early would tempt
logic into components).

### Research Flags

- **Deep-dive during planning:** nothing blocks. The plan document is unusually complete; the
  research's job was to independently confirm its two central mechanics (replay-time deadlines,
  every-crossed-tick evaluation) — both confirmed by external sources.
- **Known environment limitation:** the Playwright journey suite cannot run in this sandbox (no
  obtainable browser binary). The same limitation was disclosed as a verification override in v5.0;
  expect it again unless a browser is provisioned.
- **Explicitly deferred:** Stage 2 calibration (collector repair lands here; execution does not).

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | Zero-dependency conclusion follows directly from the determinism requirement |
| Features | HIGH | Scope is enumerated in plan §2 and §10 |
| Architecture | HIGH | Three independent external patterns agree with the plan's design |
| Pitfalls | HIGH (P1–P7) / MEDIUM (P8–P10) | P1 has a production bug report; P8–P10 are inferred from repo history |

### Gaps to Address

- **No measured execution latency exists.** All dispatch/acceptance/notification splits are labelled
  training assumptions. This is a *stated* limitation, not a research gap to close in this milestone.
- **Spread/tick size are instrument-specific.** BTCUSD's 0.05 tick and 50.00 spread must never be
  defaulted onto other symbols.
- **SELL-side and limit-fill behaviour was never observed** in the pilot (all three samples were BUY;
  the one limit never filled). Keep the reference profile BUY-only and training-valued elsewhere.

---

## Sources

### Primary (HIGH confidence)
- `docs/research/capital-order-simulator-implementation-plan.md` — scope, ownership, clock/replay,
  quote rules, latency profiles, behavioural test matrix, acceptance criteria
- `docs/research/capital-demo-order-observations.md` + `docs/research/capital-demo-order-data/**` —
  the pilot evidence the corrections are drawn from
- https://github.com/nautechsystems/nautilus_trader/issues/5079 — stop vs MIT trigger semantics
  inversion in a real engine

### Secondary (MEDIUM confidence)
- https://www.thegreenreport.blog/articles/deterministic-simulation-testing-a-practical-guide-for-qa-engineers/deterministic-simulation-testing-a-practical-guide-for-qa-engineers.html — VirtualClock, `run_until_idle`
- https://github.com/golgimed/mimic/issues/27 — simulation clock vs wall clock, determinism with seeds
- https://github.com/alicegogogogogo/matchbook — event log as sole truth, order state machine
- https://github.com/payswapdotorg/TradRL-2.0/pull/9 — determinism digests across runs and clock shifts
- https://dev.to/iwtxokhtd83/adding-ioc-fok-and-stop-orders-to-a-matching-engine-na1 — stop trigger mechanics
- https://www.futuhk.com/en/support/topic2_354 , https://www.webull.hk/en/help/faq/1695-Market-if-Touched-order — trigger latch
- https://www.techinterview.org/post/3233477258/matching-engine-price-time-priority-system-design/ — single-threaded determinism, integer ticks

### Tertiary (LOW confidence)
- https://www.venturasecurities.com/share-market-glossary/market-if-touched-mit-order/ ,
  https://support.tradovate.com/s/article/Types-of-Futures-Orders-Tradovate — MIT vs stop placement
  (multiple retail-broker glossaries agree; used only to confirm directionality)
- https://adhdecode.com/distributed-systems/testing-distributed-systems/deterministic-simulation/ —
  forcing races deterministically
