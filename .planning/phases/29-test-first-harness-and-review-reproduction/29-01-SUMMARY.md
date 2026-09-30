# Phase 29: Test-First Harness & Review Reproduction — Summary

**Phase:** 29 — Test-First Harness & Review Reproduction
**Status:** Completed (Red Phase Confirmed)
**Execution Mode:** Test-Driven Development (TDD)

---

## 1. Key Accomplishments

1. **Local Probe Ingestion**:
   - Ingested review probes from `.codex/visualizations/.../market-rewind-rereview-probes/` into `tests/codex/rereview/`:
     - `tests/codex/rereview/review.test.ts`
     - `tests/codex/rereview/data.test.ts`
   - Replaced local absolute paths with standard relative repository imports.

2. **Native Unit Test Suite (`tests/unit/rereviewProbes.test.ts`)**:
   - Implemented clean unit test replicas for all three review defects:
     - **PROBE 1 (Seek Snapshot Volume Drop):** FAILED with `expected 200 to be >= 1000`. Proves `syntheticBucketVolumesRef` wipe on seek snapshot hydration causes fallback volume to drop from 1,000 shares to 200.
     - **PROBE 2 (Switched Symbol 5m Leak):** FAILED with `expected 150 to be 101`. Proves candidate bar fallback to local 5m history assumes 60-second duration and reveals unclosed 5m high 150 at 09:21.
     - **PROBE 3 (Daily Forming Candle 09:30:01 Leak):** FAILED with `expected 150 to be 101`. Proves daily aggregation consumes entire unclosed 09:30 minute bar at 09:30:01.

3. **Playwright Replay Convergence Journey**:
   - Created `tests/regression/journey/12-replay-convergence.spec.ts` covering exact HH:MM:SS seeking and symbol switching stability.

---

## 2. Red Phase Verification Results

```
FAIL tests/unit/rereviewProbes.test.ts (3 failed | 0 passed)
  PROBE 1: expected 200 to be greater than or equal to 1000
  PROBE 2: expected 150 to be 101
  PROBE 3: expected 150 to be 101

FAIL tests/codex/rereview/review.test.ts (1 failed | 3 passed)
  rereview: seek snapshot retains completed minute volume when fallback resumes (failed)

FAIL tests/codex/rereview/data.test.ts (2 failed | 1 passed)
  rereview: different symbol fallback must not reveal unclosed five-minute bar (failed)
  rereview: daily forming bar must not expose future one-minute high (failed)
```

The Red phase is confirmed and documented. Implementation will proceed phase-by-phase.
