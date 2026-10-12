# Phase 45 Context — Replay & Session Integration

**Goal:** Connect the engine to the existing replay clock so market time and instruction time advance
together, without changing the replay machinery that already passed its own performance suites.

**Requirements:** SIM-REPLAY-01..07

## Decisions

- **The tape is the clock.** `advanceTo` feeds every quote the playhead crossed; the engine's `now`
  follows the tape. Frame size is therefore not an input to any economic outcome.
- **Chronological merge is a three-step beat per quote**: drain deadlines strictly earlier, deliver
  the quote, then drain deadlines due at that instant. This is why the engine grew `runUntilBefore`.
- **Delivery is tracked separately from the playhead.** `lastDeliveredMs` answers "what has the
  engine seen"; `cursorMs` answers "where is the playhead". Conflating them swallowed the quote at
  t=0 and, later, let a late tape push the clock backwards.
- **Late history is skipped, never replayed as live.** A tape page arriving after the playhead passed
  it is filtered per quote and announced once.
- **A rewind is a branch.** Backward seek rebuilds from the truncated command log, so abandoned
  submissions cannot reappear when playback resumes.
- **A reset fabricates nothing.** Positions are dropped; no closing fill, no realised PnL.
- **Exposure freezes the playhead.** An exposed symbol with no tape stops advancement rather than
  letting an order fill against a missing price.
- **The React hook is thin and subscribes outside React state**, so 25x playback does not force a
  re-render per frame; it reads the playhead's whole buffer, never just `currentTick`.

## Constraints

- The existing `usePlaybackStore` is not modified.
- No new runtime dependencies.
