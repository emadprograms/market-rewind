# Feature Research

**Domain:** Offline order-execution simulator / order terminal (retail CFD broker model)
**Researched:** 2026-10-12
**Confidence:** HIGH
**Scope:** NEW capabilities — Milestone v6.0

---

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why expected | Complexity | Notes |
|---|---|---|---|
| Market / Limit / Stop entries, BUY and SELL | The three order types the pilot observed | MED | Validation doubles: at submit (feedback) and at broker arrival (travel-time revalidation) |
| Pending-order cancel | Every platform has it | MED | Must support a *lost race*: the order can fill while the cancel travels |
| Pending-order amend | Every platform has it | MED-HIGH | Versioned; a stale amend must never overwrite a later terminal state |
| Explicit position close | Users must exit | MED | Close by **position ID**, not submission ID (see PITFALLS P3) |
| Attached stop loss / take profit | Standard risk control | HIGH | Shared closing group; must not double-close one position size |
| Order list + position list | Users must see state | MED | Sending/Working orders stay visible alongside later positions |
| Per-order lifecycle status | "Why did this fill / not fill" | MED | `Sending → Working → Triggered → Executing → Filled / Cancelled / Rejected(reason)` |
| Long/short PnL | Users must see money | MED | Long valued at bid, short at ask. Retain baseline spread cost so "price unchanged" can still show a loss |
| Chart markers for working orders, positions, fills | Charting is the app's core | MED | Repo already has `ChartMarker`/badge primitives + `TradePlugin.ts` |
| Bid/ask + spread visible on the ticket | Users must price the trade | LOW | Never synthesise a spread when bid/ask is missing |

### Differentiators (Competitive Advantage)

1. **Delay changes execution, not just the animation.** The headline property of this milestone.
   A market order filled 300 ms later fills at a different ask; a cancel sent 200 ms before a
   trigger lands in time, one sent 200 ms after does not. Verified by test, not by copy.
2. **Two-clock transparency.** The timeline distinguishes *broker-processed time* from
   *client-visible time*, so the user sees that a fill can happen before the UI learns it.
3. **Provenance on every parameter.** Each latency/price parameter carries
   `OBSERVED_SAMPLE` | `DOCUMENTED_RULE` | `TRAINING_ASSUMPTION`. This is what makes the simulator
   honest about how little the pilot actually measured.
4. **Explainable lost races.** "The stop triggered before the cancellation arrived." Most retail
   simulators silently drop or silently fill; naming the race is the teaching value
   (the FoundationDB-style pattern: *force* the race so it is reproducible, not flaky).
5. **Zero-delay comparison profile.** Same tape, same commands, delays off — isolates exactly what
   latency costs.

### Anti-Features (Commonly Requested, Often Problematic)

| Anti-feature | Why it looks attractive | Why it is harmful *here* |
|---|---|---|
| Partial fills | "More realistic" | The recorded tape has no size/depth, so a partial-fill model would be invented, not simulated. It would also break the "limit never fills worse than its boundary" guarantee that makes the engine testable |
| Netting (opposite entry closes/holds the existing position) | Simpler mental model | Its rules were never specified or tested; the plan deliberately chooses independent positions + explicit closes. Adding netting silently changes PnL semantics |
| Trailing stops, guaranteed stops, stop-limit | Natural next order types | Each is a separate trigger-semantics surface, and trailing stops are where the real engine bug in the sources lived (PITFALLS P1) |
| Margin calls, swap/funding, commissions | "Real terminal feel" | Needs an account model (leverage, calendar, currency) that does not exist and is not observable from the pilot |
| Fitted latency distribution (`Normal(210,20)`) | Feels more "real" than a constant | Three BUY samples, one per order type, on a weekend demo account, cannot establish variance. Presenting it as measured is a false-evidence claim (acceptance criterion #6) |
| Any live broker transport | "It's the real thing" | Out of scope and a safety hazard: the existing collector CLI defaults to `--pilot`, which sends real trading mutations |
| Replicating Capital.com's UI | Familiarity | The plan explicitly reuses this app's compact controls instead; a replica would balloon scope for zero learning value |

---

## Feature Dependencies

```
Evidence audit (offline)
      └─> Pure engine (types, scheduler, quotes, profiles)
                ├─> Replay/session integration (interval processor, seek/branch, reset)
                │        └─> Shared account selectors
                │                 ├─> Ticket + activity panel + timeline + settings (UI)
                │                 └─> Chart markers / badges (multi-chart safe)
                └─> Behavioural + race + replay tests
                          └─> Regression suite + browser verification
```

### Dependency Notes

- **The audit gates nothing but provenance.** Engine development must not wait on Stage 2
  measurement; the plan states the audit is evidence-normalisation, not calibration.
- **UI depends on the engine being authoritative.** If the panel reads engine state directly, the
  ticket cannot accidentally show a position for a merely-clicked button.
- **Chart projection depends on ID-based binding.** Multiple charts showing one symbol must
  project the same account entities without multiplying them.
- **SL/TP depend on fills existing.** Protective orders activate only after their entry fills.

---

## MVP Definition

### Launch With (v1)

Everything in "Table Stakes" plus differentiators 1–5. Per the milestone scope decision, all six
plan tasks are in scope: audit → engine → integration → account replacement → UI → verification.

### Add After Validation (v1.x)

- Seeded variable-delay mode (sampled once per command, clearly labelled a training scenario).
- Netting mode — only once its rules are written down and tested.
- Approximate-data training mode for symbols without recorded bid/ask (separately selectable,
  never a silent fallback).

### Future Consideration (v2+)

- Guaranteed stops / trailing stops (needs its own trigger-semantics research).
- Partial fills (needs a depth model — i.e. real data that does not exist yet).
- Stage 2 calibration: replace parameter provenance with genuinely constrained measurements.

---

## Feature Prioritization Matrix

| Feature | User value | Impl. cost | Priority |
|---|---|---|---|
| Pure deterministic engine | (enables everything) | HIGH | P0 |
| Market/Limit/Stop entries | HIGH | MED | P0 |
| Delay-changes-outcome | HIGH | (falls out of engine) | P0 |
| Explicit close + SL/TP | HIGH | HIGH | P0 |
| Cancel/amend races | HIGH | MED | P0 |
| Timeline w/ dual clock | HIGH | MED | P0 |
| Latency profiles + provenance | MED-HIGH | LOW | P0 |
| Chart markers | MED | LOW (primitives exist) | P1 |
| Seeded jitter | LOW | LOW | P2 |
| Netting | MED | HIGH | P3 |

---

## Sources

- Order-type families and their resting/trigger behaviour (stop dormant → activates into market or limit; stop orders stored separately from the book and not matchable until triggered): https://dev.to/iwtxokhtd83/adding-ioc-fok-and-stop-orders-to-a-matching-engine-na1
- MIT vs stop placement rules (buy MIT below market, buy stop above; sell MIT above, sell stop below; "the opposite of a stop order"): https://www.venturasecurities.com/share-market-glossary/market-if-touched-mit-order/ , https://support.tradovate.com/s/article/Types-of-Futures-Orders-Tradovate
- Trigger latch — "After the MIT order is triggered, whether it is filled or not, the trigger conditions will not be effective again": https://www.futuhk.com/en/support/topic2_354 , https://www.webull.hk/en/help/faq/1695-Market-if-Touched-order
- Order-status state machine (pending → open → filled/cancelled/rejected) and idempotent duplicate commands: https://github.com/alicegogogogogo/matchbook
- Repo-internal: `docs/research/capital-order-simulator-implementation-plan.md` §2 (scope), §6 (quote/execution rules), §8 (UI/learning), §10 (required behaviours)
