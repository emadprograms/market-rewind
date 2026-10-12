# Phase 43 Context — Pilot Evidence Audit & Collector Repair

**Goal:** Convert the pilot's raw bundles into trustworthy offline fixtures with provenance, and
make the collector fit for a later Stage 2 run — without executing it.

**Requirements:** SIM-EVIDENCE-01, SIM-EVIDENCE-02, SIM-EVIDENCE-03

## Decisions

- **No network, ever.** The analyzer is pure filesystem. The collector is repaired behind tests and
  never executed against Capital.com. Both facts are asserted by tests.
- **Identity labels use the distinguishing UUID segment.** Every deal id in these bundles is
  `00000000-69b0-XXXX-03b5-c3980055311e`, so a trailing-character suffix is identical for all of
  them and is worthless as a label. This cost one debugging cycle to discover.
- **Nothing is calibrated to the pilot.** The three POST envelopes are stored as reference samples
  with `sample_count: 1`. 209 / 52 / 2499 / 816.5 ms are recorded as explicitly not-latencies.
- **Raw artifacts are never modified.** The audit is derived; the original report and bundles stay
  byte-identical (the "stop is UNTRIGGERED_RESTING" contradiction is retained as evidence).

## Constraints

- `docs/research/capital-order-simulator-implementation-plan.md` §1 and §12 define the required
  corrections and collector repairs.
- The collector's CLI defaults to `--pilot`, which sends real trading mutations. It must not be run.
