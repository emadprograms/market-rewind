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

---

# Re-Verification Round 2 (2026-10-06) — independent audit

Triggered by a request to re-check Phase 39 end-to-end. Method: fresh clone of the branch into a
different filesystem path, environment-matrix runs, mutation testing, and a contract re-read.

## Defects found and fixed

| # | Defect | Severity | Fix | Tests added |
|---|--------|----------|-----|-------------|
| 1 | `test_persistent_lake_is_discovered_without_arguments` asserted a sandbox-absolute path, so it failed in any checkout outside `/home/user/market-rewind` (proved by cloning to `/tmp`). The `persistent_lake` fixture also tried to create `/home/user/...`, which would error on a machine where `/home` is not writable (e.g. macOS SIP). | Test-infrastructure defect (false red on other machines) | Split into a hermetic session lake (`tmp_path_factory`) and an optional `sandbox_lake` fixture that skips on `OSError`; discovery test now skips unless the lake sits on a candidate path for the current checkout; sandbox root overridable via `MR_SANDBOX_LAKE_ROOT`. | `test_default_discovery_finds_lake_on_a_candidate_path`, `test_rich_lake_resolves_symbols`, `test_rich_lake_encoded_symbols_reachable` |
| 2 | `date.fromisoformat` also accepts `20261002` and ISO-week names (`2026-W40-1`); a non-canonical `date=` directory would have been silently folded into queries, violating the strict `date=<YYYY-MM-DD>` partition contract (§2.2). | Robustness defect (wrong data could be read) | Added `DATE_DIR_PATTERN` + `_parse_partition_date()`; `resolve_files` and `list_partition_dates` ignore non-canonical names. | `test_resolve_ignores_non_canonical_date_directory_names` |
| 3 | `isinstance(True, int)` is `True`, so `schema_version: true` (or `[true]` in `compatible_versions`) was accepted as schema version 1. | Robustness defect (malformed metadata accepted) | Added `_is_plain_int()`; malformed types now raise `LakeCorruptedMetadataError`; `LakeIncompatibleSchemaError` is reserved for well-typed unsupported versions. | `test_non_integer_schema_version_raises_corrupted_metadata` (6 params), `test_non_integer_compatible_versions_raises_corrupted_metadata` |

## Post-fix verification matrix

| Scenario | Result |
|---|---|
| In-repo, no env | 80 passed, 1 skipped |
| In-repo, `npm run backend:test` | 80 passed, 11 legacy failures (Phases 40–41 scope, unchanged), 1 skipped |
| Fresh clone at `/tmp` (different path), no env | 79 passed, 2 skipped (0 failures) |
| Fresh clone with valid `TICK_LAKE_ROOT` | 80 passed, 1 skipped |
| Fresh clone with invalid `TICK_LAKE_ROOT=/tmp/nope` | 79 passed, 2 skipped (graceful skip, no error) |
| `MR_SANDBOX_LAKE_ROOT` override to a missing path | 79 passed, 2 skipped (graceful skip) |
| Sandbox lake deleted before run | Fixture rebuilt 14 Parquet files; 79 passed, 2 skipped |

## Mutation testing (suite strength proof)

Six deliberate implementation mutations were injected into a throwaway clone; every one was killed:

| Mutation | Failing tests |
|---|---|
| `encode_symbol` becomes passthrough | 13 |
| `resolve_files` ignores the end-date bound | 3 |
| Maintenance guard always returns False | 4 |
| `validate_lake` accepts any `schema_version` | 2 |
| Pruning walks the lake root (staging leakage) | 22 |
| Strict date parsing relaxed to `date.fromisoformat` | 1 (newly added test) |

## Notes

- An intermediate "failure" observed during the audit (the canonical-date test) was traced to a
  **parallel mutation run rewriting the same clone** while verification executed — a tooling
  mistake in this session, not a code defect. Serial re-runs were clean.
- Contract re-check after fixes: §2.2/§2.3 pruning rules, §6.1 guard path, §7.1 exception mapping
  and `inclusive_end` semantics remain satisfied; no contract text is contradicted by the code.
