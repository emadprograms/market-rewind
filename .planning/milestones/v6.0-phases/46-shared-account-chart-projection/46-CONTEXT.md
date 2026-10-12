# Phase 46 Context — Shared Account & Chart Projection

**Goal:** Make the engine the single source of economic truth, so duplicated charts cannot multiply
trades or PnL.

**Requirements:** SIM-ACCOUNT-01..05

## Decisions

- **One account, N views.** A single `useAccountStore` owns the `ReplaySession`. Charts subscribe.
  Nothing economic is per-chart, so two charts on one symbol are two projections of one position.
- **Projections are pure reads.** `accountProjection.ts` is free of side effects and owns no state.
  The tests freeze the account state and project it, which guarantees a projection cannot write.
- **PnL is counted per account entity, keyed by `positionId`.** Not per chart, not per symbol. The
  old design pushed `{r,u}` up keyed by chart id and summed it, so a second chart doubled the total
  and an unmount deleted a contribution. `usePortfolio.handlePnLUpdate` is now inert by design.
- **Markers are bound by identity.** Keys are `position:<id>` / `order:<id>` / `fill:<id>`, sorted by
  `(time, key)` rather than by arrival, so a remount rebuilds the identical picture.
- **`useTradeManager` became a view.** It keeps UI state (size, drag target) and issues commands;
  it no longer holds an `ActiveTrade` or computes PnL. `placeOrder` routes to `openPosition`.
- **The one-claim invariant is stated honestly.** Both protective members are sized for the whole
  position, so their sizes SUM to two position sizes; that is not a defect. What must hold is that no
  member over-claims, at most one has latched, and once reserved no other member can act.

## Constraints

- Netting is removed from the realistic path (SIM-ACCOUNT-03) and default attachments are OFF.
- Closes target a POSITION id; the pilot's 404 cleanup is the standing reminder of why.
