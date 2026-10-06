# Phase 39 Research — Standalone Tick Lake Reader & Partition Pruning

**Phase:** 39-standalone-tick-lake-reader-partition-pruning
**Milestone:** v5.0 Partitioned Parquet Tick Lake Integration (Repo B Contract Compliance)
**Requirements:** LAKE-READ-01, LAKE-READ-02, LAKE-READ-03, LAKE-READ-04
**Researched:** 2026-10-06
**Authoritative source:** `docs/contracts/repo_b_tick_lake_contract.md` (v1.5.0, vendored from `data-harvester`)
**Confidence:** HIGH — contract is explicit; DuckDB behaviors probed empirically in-sandbox.

---

## 1. Problem Statement

`streaming.duckdb` was migrated into Data Harvester's Partitioned Parquet Tick Lake and deleted.
Market Rewind's backend still opens the retired disk database, so **11/11 backend pytest tests fail**
(verified red baseline: `11 failed in 0.38s`). This phase builds the standalone, zero-dependency
reader core that all later phases (40–42) build on.

## 2. Contract Facts That Constrain the Implementation

| # | Fact | Contract ref |
|---|------|--------------|
| 1 | Zero `data-harvester` imports; `duckdb >= 1.0.0` + stdlib only | §1.4 |
| 2 | Query root is `<lake_root>/ticks/` only — never `_staging/`, `_maintenance/`, `_migration/`, `_control/` | §2.1, §2.3 |
| 3 | Partition path: `ticks/symbol=<ENCODED_SYMBOL>/date=<YYYY-MM-DD>/<file>.parquet` | §2.1 |
| 4 | Safe set `[A-Za-z0-9_-]`; everything else percent-encoded **byte-by-byte, uppercase hex**; the period **is** encoded (`BRK.B` → `BRK%2EB`, `EUR/USD` → `EUR%2FUSD`) | §2.2, §4.1 |
| 5 | Date partition is the **UTC event date** (`CAST(timestamp AS DATE)`), not local exchange date | §2.2 |
| 6 | Unencoded symbol lookups return nothing **and no error** — the reader must encode | §2.2 |
| 7 | `lake.json`: `format="tick_lake"`, `schema_version=1`, `compatible_versions=[1]` | §7.1 |
| 8 | Exceptions: `LakeUnavailableError`, `LakeCorruptedMetadataError`, `LakeIncompatibleSchemaError`, `LakeMaintenanceInProgressError`; all derive from `LakeReaderError` | §7.1 |
| 9 | Fail-fast validation: missing/non-dir root → `LakeUnavailableError`; missing/unreadable/invalid `lake.json` → `LakeCorruptedMetadataError`; wrong `format` or incompatible `schema_version` → `LakeIncompatibleSchemaError` | §7.1 |
| 10 | Maintenance guard file `<lake_root>/_maintenance/in_progress.json` → queries fail fast with `LakeMaintenanceInProgressError` | §6.1, §7.1 |
| 11 | Legitimate empty results: valid lake, no matching partitions → `[]`, **not** an error | §7.1 |
| 12 | Range normalization: tz-aware datetimes → UTC; naive datetimes, `date`, ISO strings accepted; half-open `[start, end)` via `inclusive_end=False` (default `True`) | §7.1 |
| 13 | Snapshot semantics: resolve file list immediately before querying; never cache | §7.3 |
| 14 | Missing file in an explicit list raises `duckdb.IOException` — no silent partial reads | §7.3 |
| 15 | Read-only: readers must never create files inside `ticks/`, `_staging/`, `_control/` | §6.2 |

## 3. Empirical Probes (DuckDB 1.5.6 / PyArrow 25.0.1, Python 3.11.2)

Executed in-sandbox against a synthetic schema-v1 Parquet file (dictionary-encoded `symbol`):

| Probe | Result | Implication for Phase 39/40 |
|-------|--------|------------------------------|
| `read_parquet(?, hive_partitioning=false)` with a Python `list[str]` parameter | works; `symbol` reads back as `VARCHAR`, not dictionary | Confirms §4.1 pattern; no Hive inference collision |
| `arg_max(price)` single-argument form | **`BinderException: No function matches arg_max(DOUBLE)`** in DuckDB 1.5.6 | **Deviation from contract §4.1 snippet**: the two-argument form `arg_max(price, (timestamp, ingest_id))` is mandatory, not optional |
| `arg_min/arg_max` with `(timestamp, ingest_id)` tuple tie-break | deterministic; identical-timestamp rows resolved by `ingest_id`, open≠close preserved | §3.4 formulas are implementable verbatim |
| Missing file inside an explicit file list | `_duckdb.IOException: IO Error: No files found that match the pattern ...` | Confirms §7.3 retraction; Phase 40 must surface/retry |
| `sum(coalesce(volume, 1.0))` with a NULL volume row | coalesces to `1.0` | §3.4 volume semantics reproducible |
| Dictionary-encoded symbol in PyArrow (`dictionary<values=string, indices=int32>`) | round-trips through DuckDB as `VARCHAR` | Fixture writer must emit dictionary-encoded symbol to be faithful |

## 4. Design Decisions

1. **Exception root.** Plan says `LakeReaderError(Exception)`. The shipped Data Harvester reader
   chains `DataHarvesterError`/`StorageError`; we are forbidden from importing it, so the standalone
   root is `LakeReaderError(Exception)`. Phase 41 maps these to REST/WS status codes.
2. **Root discovery precedence** (first existing candidate wins; explicit/env values are *never*
   silently overridden by fallbacks — a misconfigured explicit path must surface as
   `LakeUnavailableError`):
   1. explicit `lake_root` argument
   2. `TICK_LAKE_ROOT` env var
   3. `DATA_DIR/tick_lake` (when `DATA_DIR` is set)
   4. `<repo>/data/tick_lake` (repo-local symlink/relative path — LAKE-READ-01 wording)
   5. `<repo>/../data-harvester/data/tick_lake` (historical default location)
   6. `/Volumes/Micron-E 0256 A/data-harvester/data/tick_lake` (external volume fallback)
3. **Eager validation.** `TickLakeReader(...)` calls `validate_lake()` by default (fail-fast, §7.1);
   `validate=False` is available for tests that deliberately construct invalid states.
4. **Maintenance is checked at execution time, not construction.** `is_maintenance_in_progress()`
   is a pure predicate; `ensure_ready()` (validation + maintenance) is the gate that Phase 40 query
   methods call. This matches §6.1/§7.1 ("queries fail fast").
5. **`resolve_files` is pure filesystem work.** It never executes DuckDB, never touches `_staging/`,
   never creates files, and returns `sorted()` paths for determinism. Empty results are `[]`.
6. **Date normalization** is centralized in `_to_utc_date()`: tz-aware → `astimezone(UTC).date()`;
   naive datetime/`date` → as-is; ISO string (`Z` supported) → parsed then normalized.
   `inclusive_end=False` switches the upper bound to strict `<`.
7. **No caching.** Nothing in the reader memoizes partition listings (§7.3.2).

## 5. Test Strategy (write tests first — red, then implement)

Hermetic tests over a deterministic synthetic mini-lake built by
`backend/streaming_service/tests/tick_lake_factory.py`, faithful to §2/§3.2:

- dictionary-encoded `symbol`, `timestamp('us')` naive UTC, `ingest_id` stable IDs;
- rows sorted by `(timestamp, ingest_id)`; duplicate timestamps with distinct `ingest_id`;
- NULL `volume` rows; `REG`/`PRE`/`POST` session tags;
- symbols requiring encoding: `AAPL`, `NVDA`, `BRK.B` → `BRK%2EB`, `EUR/USD` → `EUR%2FUSD`;
- multiple date partitions incl. out-of-range and malformed `date=` dirs (must be ignored);
- decoy `_staging/ticks/...` parquet files that pruning must never reach;
- corrupt / incompatible / maintenance-marked lake variants for exception tests.

**Integration tests** run against the persistent sandbox mini-lake at
`/home/user/data-harvester/data/tick_lake` — which is exactly candidate #5 of the discovery
precedence, so plain `TickLakeReader()` discovers it. Tests that need a *specific* real lake
honour `TICK_LAKE_ROOT` and `skipif` when absent (so they are green on this sandbox and on the
developer's Mac alike).

**Known environment deviation:** local verification uses a shim venv at
`/home/user/data-harvester/.venv` (outside this repo) so `npm run backend:test` resolves
`../data-harvester/.venv/bin/pytest` unmodified. Documented in `39-VERIFICATION.md`.

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Contract §4.1 snippet is not executable as written on DuckDB 1.5.6 | Implement two-arg `arg_max`; covered by Phase 40 tests |
| Real lake unreachable from sandbox | Deterministic fixture lake + discovery-precedence integration test; real-lake tests `skipif` |
| Fixtures drift from real physical types (dictionary `symbol`) | Factory emits the §3.2 Arrow types exactly; asserted in fixture self-test |
| `_staging/` leakage into a query | Pruning starts at `ticks/`; explicit decoy test |
| Silent stale-file partial reads | §7.3.3 behavior asserted in Phase 40 (retry surfaces `duckdb.IOException`) |

## 7. Deliverables

- `backend/streaming_service/tick_lake_reader.py` (new, ~250 lines)
- `backend/streaming_service/tests/tick_lake_factory.py` (new)
- `backend/streaming_service/tests/conftest.py` (new)
- `backend/streaming_service/tests/test_tick_lake_reader.py` (new)
- Persistent sandbox mini-lake at `/home/user/data-harvester/data/tick_lake` (uncommitted artifact)
