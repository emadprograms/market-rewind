# Phase 48 Context — Regression Verification & Handover

**Goal:** Prove the milestone, and document exactly what is measured, assumed, and excluded.

**Requirements:** SIM-VERIFY-01, SIM-VERIFY-02

## Decisions

- **The matrix is one file, in the plan's order.** `tests/regression/behaviouralMatrix.test.ts` has a
  test per row of §10, each quoting the result the plan requires. Rows are journeys — an independent
  tape plus explicit commands through `ReplaySession` and the shared account — not assertions about
  internal branches.
- **Where a row had two readings, both are asserted and the reading is stated in the test.** §10.6 is
  the real case: "eligible briefly, then the price returns" can mean "a latched trigger survives the
  return" (asserted, and what the engine does) or "a crossing that happened before the order was live
  counts as a trigger" (asserted as the opposite, with the reason: the engine must not fill against a
  price that no longer exists). The second reading is the one this implementation rejects, explicitly.
- **Performance guards are guards, not benchmarks.** They assert no freeze, no dropped or duplicated
  quotes and fills, digest equality across batching, and generous wall-clock ceilings to catch
  accidental quadratic behaviour.
- **Unrunnable means disclosed.** The Playwright journey suite could not run here because the browser
  binary cannot be downloaded. That is recorded as an environment limitation, not as a pass.
- **Stale tests are marked, not silently deleted.** The four browser tests in `07-trading.spec.ts`
  that assert netting are `test.fixme` with a pointer to this document, because their replacement
  cannot be verified without running a browser.

## Constraints

- No broker access, no credentials, and no research CLI execution — the verification is entirely
  offline, and the evidence analyzer is run only in its offline modes.
- Raw research artifacts under `docs/research/capital-demo-order-data/` are never rewritten.
