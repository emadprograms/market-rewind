# Phase 44 Context — Pure Order Engine

**Goal:** A deterministic, dependency-free simulation core. Correct trade semantics before any UI.

**Requirements:** SIM-ENGINE-01..06, SIM-QUOTE-01..06, SIM-LATENCY-01..05, SIM-ACCOUNT-01..05

## Decisions

- **Trigger rules are enumerated per (type, side) and never shared.** A buy stop fires when the ask
  reaches the level; a buy limit when the ask falls to it. Sharing the touch check between them is
  Pitfall P1 and is asserted in both directions (accepts wrong-side / rejects valid).
- **Stops enforce placement, limits do not.** A wrong-side stop would invert its meaning and is
  refused. A limit on the far side of the market is merely aggressive: it is accepted and fills
  immediately at the touch price.
- **Eligibility is not a state.** A resting order is `WORKING`; `armedAt` records that the dispatch
  delay elapsed. Modelling it as an `EXECUTING` state (the first attempt) both misreported resting
  orders and blocked cancel/amend.
- **One position per order; no netting.** Two buys produce two independent positions with their own
  entry prices, exits and PnL.
- **Latency is staged, never fitted.** `travelMs` → acceptance → acknowledgement envelope → dispatch,
  each parameter labelled `OBSERVED_SAMPLE` or `TRAINING_ASSUMPTION`. One envelope cannot be
  decomposed into one-way components, so the splits stay disclosed assumptions.
- **Identity types are branded.** A `PositionId` cannot be passed where an `OrderId` is expected —
  the compile-time counterpart of the pilot's failed cleanup.
- **No wall clock, anywhere.** The market tape drives `now`; a test greps the sources for
  `Date.now`, `new Date`, `performance.now`, `hrtime`, timers and `Math.random`.

## Constraints

- Zero new runtime dependencies.
- Instrument rules are never defaulted; an unknown symbol is refused.
