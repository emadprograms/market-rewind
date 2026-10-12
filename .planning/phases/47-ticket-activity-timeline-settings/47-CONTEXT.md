# Phase 47 Context — Ticket, Activity, Timeline & Settings

**Goal:** Make delay, pending state, and lost races inspectable in the terminal UI.

**Requirements:** SIM-UI-01..06

## Decisions

- **All copy and arithmetic live in `uiViewModels.ts`.** The components lay out values; they do not
  decide what a status means or when an order is "waiting for the ask". This is what makes the
  sentences on screen testable without rendering, and it keeps one definition of a trigger condition
  shared with the engine's own trigger matrix.
- **A position is never shown because a button was clicked.** Rows come from the engine's orders and
  positions. An order that has not filled has no position row, and the ticket says only that the
  instruction was sent — client acceptance is not execution.
- **A fill is never hidden because a cancel button was pressed.** A cancelled instruction and a
  filled one are two facts about one id, and a race is reported as a sentence that names which
  instruction won: "the stop triggered before the cancellation arrived, so it filled instead".
- **`Executing` is a real state, not decoration.** It is the status of a resting instruction that has
  passed its dispatch delay and is being evaluated against every quote — distinct from `Working`
  (accepted, still inside its delay) and from `Triggered` (condition met and latched).
- **Positions use their own two words.** `Open` / `Closed`, never `Filled` / `Cancelled`: reusing an
  order's vocabulary for a position would say "Filled" about something still exposed.
- **Three intervals, three names, never one number twice.** Execution delay runs from the moment the
  order could execute (its trigger, or its eligibility for a market order); market waiting runs from
  eligibility to the trigger; notification delay runs from the fill to the client learning about it.
  Measuring execution delay from eligibility would report the market waiting time again under another
  name — the tests assert the intervals are not equal to each other.
- **Evidence is not a setting.** An observed value is rendered read-only with its provenance and
  sample count; only training assumptions are editable. Evidence cards live in their own section.
- **Freezes are disclosed, not papered over.** The store exposes `frozen`/`frozenReason` as current
  state (separate from the append-only notice log), so the desk can say playback is stalled and then
  stop saying it once it is not.

## Constraints

- The desk performs no network calls at all; the test asserts `fetch` is never called.
- One polite live region for the whole desk, fed by transitions only: announcing price ticks would
  make it unusable.
