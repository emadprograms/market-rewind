---
phase: 39-standalone-tick-lake-reader-partition-pruning
plan: 01
status: completed
executed_at: 2026-10-06
requirements:
  - LAKE-READ-01
  - LAKE-READ-02
  - LAKE-READ-03
  - LAKE-READ-04
---

# Summary 39-01: Standalone Tick Lake Reader & Partition Pruning

## Execution Results

1. **Standalone reader core** — `backend/streaming_service/tick_lake_reader.py` (new).
   Zero library imports from the Data Harvester repository (stdlib only for this phase);
   verified by a source-level assertion test.

2. **Root discovery precedence** (explicit argument → `TICK_LAKE_ROOT` → `DATA_DIR/tick_lake`
   → `<repo>/data/tick_lake` → `<repo>/../data-harvester/data/tick_lake` → mounted external
   volume). Explicit/env values are authoritative — a bad explicit path raises
   `LakeUnavailableError` instead of silently falling back to a valid candidate.

3. **Fail-fast validation (`validate_lake`)** — `lake.json` must exist, parse, be an object,
   declare `format="tick_lake"`, and carry a `schema_version` present in `compatible_versions`;
   otherwise `LakeCorruptedMetadataError` / `LakeIncompatibleSchemaError`.

4. **Canonical symbol encoding** — `encode_symbol`/`decode_symbol` implement the
   `[A-Za-z0-9_-]` safe set with byte-by-byte uppercase percent-encoding
   (`BRK.B` → `BRK%2EB`, `EUR/USD` → `EUR%2FUSD`); hostile inputs (`../`, NUL, full-width
   Unicode) cannot escape `ticks/`.

5. **Filesystem partition pruning (`resolve_files`)** — resolves explicit Parquet file lists
   under `ticks/symbol=<ENC>/date=<YYYY-MM-DD>/` only, honours `inclusive_end=False`
   half-open ranges, normalizes `date` / naive & tz-aware `datetime` / ISO strings to the
   UTC event date, ignores malformed `date=` directories and non-Parquet files, returns
   `[]` for unknown symbols/empty partitions, and never executes DuckDB.

6. **Maintenance guard** — `is_maintenance_in_progress()` plus `ensure_ready()` which fails
   fast with `LakeMaintenanceInProgressError` while `_maintenance/in_progress.json` exists.

7. **Deterministic test infrastructure** — `tick_lake_factory.py` + `conftest.py` build
   contract-faithful lakes (dictionary-encoded `symbol`, `timestamp('us')`, sorted
   `(timestamp, ingest_id)`, duplicate timestamps, NULL volumes, `PRE`/`REG`/`POST`,
   encoded-symbol partitions, `_staging/` decoys). Sandbox-resident lake at
   `/home/user/data-harvester/data/tick_lake` (5 symbols, 9 partitions, 2,461 ticks).

## Requirement → Change → Files → Tests Map

| Requirement | Change made | Files edited | Tests created |
|---|---|---|---|
| LAKE-READ-01 (zero-import reader core + root discovery + `lake.json` format check) | Added `TickLakeReader` with discovery precedence, `validate_lake()`, `metadata`/`schema_version`; stdlib-only | `backend/streaming_service/tick_lake_reader.py` (new); `backend/streaming_service/tests/conftest.py` (new) | `test_explicit_root_argument_is_used`, `test_env_var_used_when_no_argument`, `test_explicit_root_wins_over_env`, `test_missing_root_raises_lake_unavailable`, `test_root_pointing_at_file_raises_lake_unavailable`, `test_bad_explicit_root_does_not_silently_fall_back`, `test_validate_false_defers_errors_until_validate_lake`, `test_reader_imports_no_data_harvester_modules`, `test_valid_lake_exposes_metadata_and_schema_version`, `test_persistent_lake_is_discovered_without_arguments` |
| LAKE-READ-02 (canonical symbol path encoding) | Added `encode_symbol`/`decode_symbol` + encoded `symbol_partition_dir`; uppercase before encoding | `backend/streaming_service/tick_lake_reader.py` (new); `backend/streaming_service/tests/tick_lake_factory.py` (new) | `test_encode_symbol_contract_examples`, `test_encode_symbol_matches_fixture_encoder`, `test_encode_symbol_lowercase_stays_lowercase_but_period_encodes`, `test_encode_symbol_non_ascii_uses_uppercase_hex_bytes`, `test_encode_symbol_percent_is_itself_encoded`, `test_decode_symbol_roundtrip`, `test_decode_symbol_accepts_lowercase_hex`, `test_decode_symbol_rejects_malformed_percent_sequence`, `test_resolve_encodes_dotted_symbol_partition`, `test_resolve_encodes_slashed_symbol_partition`, `test_resolve_ignores_unencoded_decoy_partition`, `test_resolve_uppercases_lowercase_symbol_input` |
| LAKE-READ-03 (filesystem partition pruning) | Added `resolve_files` (ticks-only, date-filtered, sorted, no DuckDB), `list_symbols`, `list_partition_dates`, `_to_utc_date` normalization | `backend/streaming_service/tick_lake_reader.py` (new); `backend/streaming_service/tests/tick_lake_factory.py` (new) | `test_resolve_single_date_returns_partition_files`, `test_resolve_date_range_includes_both_ends`, `test_resolve_out_of_range_dates_excluded`, `test_resolve_inclusive_end_false_excludes_end_date`, `test_resolve_nonexistent_symbol_returns_empty_without_error`, `test_resolve_empty_symbol_partition_dir_returns_empty`, `test_resolve_ignores_malformed_date_directories`, `test_resolve_ignores_non_date_subdirectories`, `test_resolve_ignores_non_parquet_files`, `test_resolve_is_sorted_and_deterministic`, `test_resolve_multiple_files_same_day_all_returned`, `test_resolve_never_reads_staging_tree`, `test_resolve_never_reads_other_symbol_partitions`, `test_resolve_does_not_execute_duckdb`, `test_resolve_is_read_only`, `test_resolve_accepts_mixed_datetime_inputs`, `test_resolve_tz_aware_inputs_normalize_to_utc_date`, `test_resolve_start_after_end_returns_empty`, `test_resolve_unbounded_range_returns_all_partitions`, `test_list_symbols_decodes_partition_names`, `test_list_partition_dates_is_sorted`, `test_persistent_lake_resolves_real_symbols`, `test_persistent_lake_encoded_symbols_reachable`, `test_operator_lake_if_configured` |
| LAKE-READ-04 (structured error taxonomy + maintenance guard) | Added `LakeReaderError` hierarchy, `maintenance_guard_path`, `is_maintenance_in_progress`, `ensure_ready`; metadata exception mapping | `backend/streaming_service/tick_lake_reader.py` (new) | `test_exception_hierarchy_matches_contract`, `test_missing_lake_json_raises_corrupted_metadata`, `test_invalid_json_lake_raises_corrupted_metadata`, `test_lake_json_directory_raises_corrupted_metadata`, `test_wrong_format_raises_incompatible_schema`, `test_incompatible_schema_version_raises_incompatible_schema`, `test_compatible_versions_admit_newer_schema`, `test_missing_schema_version_raises_corrupted_metadata`, `test_lake_json_not_an_object_raises_corrupted_metadata`, `test_maintenance_absent_is_not_in_progress_and_ready`, `test_maintenance_present_blocks_queries`, `test_maintenance_removal_restores_readiness`, `test_maintenance_guard_under_env_discovered_lake` |

## Verification Loop Record

- **Red:** suite collected against a missing module → `ModuleNotFoundError: No module named 'backend.streaming_service.tick_lake_reader'` (expected, test-first).
- **Green (attempt 1):** `71 passed, 1 failed` — the failure was a **test-expectation defect**
  (`%2EB` vs the correct `%2Eb`), not an implementation defect; corrected the assertion.
- **Green (final):** `72 passed, 1 skipped` (skip = operator `TICK_LAKE_ROOT` lake absent).
- **Adversarial pass:** path-traversal/NUL/full-width symbol inputs stay inside `ticks/`;
  unicode round-trips; resolved files are DuckDB-queryable (508 AAPL rows); maintenance guard
  blocks a real lake; no `_staging`/`_control`/`_migration` paths ever resolved.
- **Regression context:** repo-wide backend suite now `72 passed, 11 failed` — the 11 failures
  are the legacy `streaming.duckdb` service/API tests owned by Phases 40–41 (red baseline
  before this phase: 11 failed / 0 passed).

## Notes / Deviations

- `docs/contracts/repo_b_tick_lake_contract.md` (v1.5.0) is **vendored into the repo** because
  Phases 39–42 reference it and it does not exist in this repository; canonical source remains
  `data-harvester`. Update only by re-vendoring.
- Contract §4.1's snippet is not executable verbatim on DuckDB 1.5.6 (`arg_max(price)` with one
  argument is a binder error — reproduced in-sandbox). The two-argument
  `arg_max(price, (timestamp, ingest_id))` form is mandatory and is used from Phase 40 onward.
- Local verification uses a shim venv at `/home/user/data-harvester/.venv` (outside this repo)
  so `npm run backend:test` resolves `../data-harvester/.venv/bin/pytest` unmodified.

## Re-Verification Round 2 (post-audit hardening)

Three defects were found by an independent audit (fresh-clone reproduction, environment matrix,
mutation testing) and fixed test-first:

1. **Test portability:** discovery test and sandbox-lake fixture were pinned to an absolute sandbox
   path, failing in clones and on machines without a writable `/home/user`. Fixed with a hermetic
   `session_lake` (session-scoped tmp) plus an optional `sandbox_lake` fixture that skips on
   `OSError`; `MR_SANDBOX_LAKE_ROOT` allows operator override.
2. **Non-canonical date partitions:** `date=20261002` / `date=2026-W40-1` were accepted because
   `date.fromisoformat` is lenient; now restricted to the canonical `YYYY-MM-DD` form.
3. **Bool-as-int metadata:** `schema_version: true` was accepted (Python `bool ⊂ int`); malformed
   types now raise `LakeCorruptedMetadataError`, with `LakeIncompatibleSchemaError` reserved for
   well-typed unsupported versions.

New tests: `test_resolve_ignores_non_canonical_date_directory_names`,
`test_non_integer_schema_version_raises_corrupted_metadata` (6 params),
`test_non_integer_compatible_versions_raises_corrupted_metadata`,
`test_default_discovery_finds_lake_on_a_candidate_path`,
`test_rich_lake_resolves_symbols`, `test_rich_lake_encoded_symbols_reachable`.

Final state: **80 passed, 1 skipped** in-repo; clean in fresh clones across the environment matrix;
six of six injected mutations killed.
