---
phase: 39-standalone-tick-lake-reader-partition-pruning
status: passed
verified_at: 2026-10-06
must_haves:
  - id: LAKE-READ-01
    status: passed
    description: Standalone zero-import TickLakeReader with root discovery precedence and lake.json format verification.
  - id: LAKE-READ-02
    status: passed
    description: Canonical uppercase percent-encoding of symbols honoring the [A-Za-z0-9_-] safe set.
  - id: LAKE-READ-03
    status: passed
    description: Filesystem partition pruning by symbol and UTC event date, empty result without DuckDB execution.
  - id: LAKE-READ-04
    status: passed
    description: Structured exception taxonomy plus _maintenance/in_progress.json fail-fast guard.
---

# Phase 39 Verification: Standalone Tick Lake Reader & Partition Pruning

## Test Verification Matrix

| Suite | Passed | Total | Skipped | Duration | Status |
|---|---|---|---|---|---|
| `test_tick_lake_reader.py` (Phase 39 contract suite) | 72 | 72 | 1 | 0.83s | PASSED (100%) |
| `npm run backend:test` (whole backend suite) | 72 | 83 | 1 | 1.06s | PHASE 39 GREEN — 11 legacy failures owned by Phases 40–41 |

Red-phase evidence (test-first): collection failed with
`ModuleNotFoundError: No module named 'backend.streaming_service.tick_lake_reader'` before the
implementation existed. Green-phase evidence: 72/72 Phase 39 tests pass after implementation.

## Requirement Traceability

- **LAKE-READ-01**: PASSED — `TickLakeReader` discovers roots by documented precedence, rejects
  missing/non-directory roots with `LakeUnavailableError`, validates `lake.json` (`format`,
  `schema_version`, `compatible_versions`), and imports no Data Harvester code (source assertion test).
- **LAKE-READ-02**: PASSED — `BRK.B` → `BRK%2EB`, `EUR/USD` → `EUR%2FUSD`; unencoded decoy
  directory is ignored; lowercase input is uppercased before encoding; Unicode round-trips.
- **LAKE-READ-03**: PASSED — date-range pruning returns sorted explicit file lists; empty/no-match
  returns `[]` with a monkeypatched `duckdb.connect` asserting no execution; `_staging/` decoys,
  malformed date dirs, non-Parquet files, and other symbols' partitions are never returned.
- **LAKE-READ-04**: PASSED — the four contract exceptions exist under `LakeReaderError`;
  corrupt/missing/incompatible `lake.json` variants map to the correct exception; the maintenance
  guard blocks `ensure_ready()` until `in_progress.json` is removed.

## Adversarial & Integration Evidence

| Probe | Result |
|---|---|
| Persistent sandbox lake discovery (no args, no env) | `/home/user/data-harvester/data/tick_lake`, schema 1, symbols `AAPL, BRK.B, EUR/USD, JPM, NVDA` |
| Resolved file lists executed by DuckDB | 508 AAPL rows returned; `read_parquet(?, hive_partitioning=false)` accepts the pruned list |
| Hostile symbols (`../AAPL`, `..%2FAAPL`, `AAPL/../../etc`, NUL, full-width) | All encoded inside `ticks/`; zero files resolved; no traversal |
| Maintenance marker present | `LakeMaintenanceInProgressError` raised on real lake |
| Read-only invariant | File-set and mtime snapshot unchanged after resolve/list operations |
| Control-plane isolation | No resolved path contains `_staging`, `_control`, `_migration`, or `_maintenance` |

## Known Deviations

1. `arg_max(price)` (single-argument) is a `BinderException` on DuckDB 1.5.6; only the
   two-argument `arg_max(price, (timestamp, ingest_id))` form from contract §3.4 is valid. Phase 40
   will implement the working form and its tests assert determinism.
2. The real production lake is unreachable from this sandbox; integration tests run against the
   contract-faithful sandbox mini-lake and `skipif` when an operator-supplied `TICK_LAKE_ROOT`
   is absent.
