"""Phase 39 contract tests — Standalone Tick Lake Reader & Partition Pruning.

Requirements: LAKE-READ-01, LAKE-READ-02, LAKE-READ-03, LAKE-READ-04
Contract: `docs/contracts/repo_b_tick_lake_contract.md` v1.5.0 (§2, §6, §7.1, §7.3)

Written test-first (red) before `backend/streaming_service/tick_lake_reader.py`.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import List

import duckdb
import pytest

from backend.streaming_service.tick_lake_reader import default_lake_root_candidates

from tick_lake_factory import (
    SANDBOX_LAKE_ROOT,
    add_staging_decoy,
    build_mini_lake,
    corrupt_lake_json,
    encode_symbol as fixture_encode_symbol,
    generate_ticks,
    mark_maintenance,
    partition_dir,
    write_lake_json,
    write_partition,
    write_partition_raw,
)

from backend.streaming_service.tick_lake_reader import (
    LakeCorruptedMetadataError,
    LakeIncompatibleSchemaError,
    LakeMaintenanceInProgressError,
    LakeReaderError,
    LakeUnavailableError,
    TickLakeReader,
    decode_symbol,
    encode_symbol,
)

# --------------------------------------------------------------------------- #
# LAKE-READ-02 — canonical symbol path encoding
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "display,expected",
    [
        ("AAPL", "AAPL"),
        ("NVDA", "NVDA"),
        ("BRK.B", "BRK%2EB"),
        ("EUR/USD", "EUR%2FUSD"),
        ("BTC/USD", "BTC%2FUSD"),
        ("ES-F", "ES-F"),           # hyphen is safe
        ("A_B", "A_B"),             # underscore is safe
    ],
)
def test_encode_symbol_contract_examples(display: str, expected: str) -> None:
    assert encode_symbol(display) == expected


def test_encode_symbol_matches_fixture_encoder() -> None:
    for symbol in ("AAPL", "BRK.B", "EUR/USD", "BTC/USD", "café", "A_B-1", "sp ace"):
        assert encode_symbol(symbol) == fixture_encode_symbol(symbol)


def test_encode_symbol_lowercase_stays_lowercase_but_period_encodes() -> None:
    # Encoding itself is byte-faithful; callers uppercase for path resolution (§2.2).
    # Note: the trailing "b" is a safe letter, not a hex digit — only the escape is uppercased.
    assert encode_symbol("brk.b") == "brk%2Eb"


def test_encode_symbol_non_ascii_uses_uppercase_hex_bytes() -> None:
    assert encode_symbol("café") == "caf%C3%A9"


def test_encode_symbol_percent_is_itself_encoded() -> None:
    assert encode_symbol("A%B") == "A%25B"


@pytest.mark.parametrize("symbol", ["AAPL", "BRK.B", "EUR/USD", "BTC/USD", "café", "A_B-1"])
def test_decode_symbol_roundtrip(symbol: str) -> None:
    assert decode_symbol(encode_symbol(symbol)) == symbol


def test_decode_symbol_accepts_lowercase_hex() -> None:
    assert decode_symbol("BRK%2eb") == "BRK.b"


def test_decode_symbol_rejects_malformed_percent_sequence() -> None:
    with pytest.raises(ValueError):
        decode_symbol("BRK%2")


# --------------------------------------------------------------------------- #
# LAKE-READ-01 — zero-import reader core & root discovery precedence
# --------------------------------------------------------------------------- #

def test_explicit_root_argument_is_used(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    assert reader.lake_root == mini_lake.resolve()
    assert reader.ticks_dir == mini_lake.resolve() / "ticks"


def test_env_var_used_when_no_argument(mini_lake: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TICK_LAKE_ROOT", str(mini_lake))
    reader = TickLakeReader()
    assert reader.lake_root == mini_lake.resolve()


def test_explicit_root_wins_over_env(mini_lake: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    other = build_mini_lake(tmp_path / "other_lake")
    monkeypatch.setenv("TICK_LAKE_ROOT", str(other))
    reader = TickLakeReader(mini_lake)
    assert reader.lake_root == mini_lake.resolve()


def test_missing_root_raises_lake_unavailable(tmp_path: Path) -> None:
    with pytest.raises(LakeUnavailableError):
        TickLakeReader(tmp_path / "does_not_exist")


def test_root_pointing_at_file_raises_lake_unavailable(tmp_path: Path) -> None:
    target = tmp_path / "not_a_dir"
    target.write_text("nope", encoding="utf-8")
    with pytest.raises(LakeUnavailableError):
        TickLakeReader(target)


def test_bad_explicit_root_does_not_silently_fall_back(
    mini_lake: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A misconfigured explicit path must surface, never be shadowed by a valid fallback."""
    monkeypatch.setenv("TICK_LAKE_ROOT", str(mini_lake))
    with pytest.raises(LakeUnavailableError):
        TickLakeReader(tmp_path / "bad_explicit_root")


def test_validate_false_defers_errors_until_validate_lake(tmp_path: Path) -> None:
    reader = TickLakeReader(tmp_path / "missing", validate=False)
    assert reader.lake_root == (tmp_path / "missing").resolve()
    with pytest.raises(LakeUnavailableError):
        reader.validate_lake()


def test_reader_imports_no_data_harvester_modules() -> None:
    import backend.streaming_service.tick_lake_reader as mod

    source = Path(mod.__file__).read_text(encoding="utf-8")
    assert "data_harvester" not in source
    assert "from src." not in source
    assert "import src." not in source


# --------------------------------------------------------------------------- #
# LAKE-READ-04 — structured error taxonomy (lake.json validation)
# --------------------------------------------------------------------------- #

def test_exception_hierarchy_matches_contract() -> None:
    for exc in (
        LakeUnavailableError,
        LakeCorruptedMetadataError,
        LakeIncompatibleSchemaError,
        LakeMaintenanceInProgressError,
    ):
        assert issubclass(exc, LakeReaderError)
    assert issubclass(LakeReaderError, Exception)


def test_valid_lake_exposes_metadata_and_schema_version(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    assert reader.metadata["format"] == "tick_lake"
    assert reader.metadata["schema_version"] == 1
    assert reader.schema_version == 1


def test_missing_lake_json_raises_corrupted_metadata(tmp_path: Path) -> None:
    root = build_mini_lake(tmp_path / "lake")
    (root / "lake.json").unlink()
    with pytest.raises(LakeCorruptedMetadataError):
        TickLakeReader(root)


def test_invalid_json_lake_raises_corrupted_metadata(tmp_path: Path) -> None:
    root = build_mini_lake(tmp_path / "lake")
    corrupt_lake_json(root)
    with pytest.raises(LakeCorruptedMetadataError):
        TickLakeReader(root)


def test_lake_json_directory_raises_corrupted_metadata(tmp_path: Path) -> None:
    root = build_mini_lake(tmp_path / "lake")
    (root / "lake.json").unlink()
    (root / "lake.json").mkdir()
    with pytest.raises(LakeCorruptedMetadataError):
        TickLakeReader(root)


def test_wrong_format_raises_incompatible_schema(tmp_path: Path) -> None:
    root = build_mini_lake(tmp_path / "lake")
    write_lake_json(root, fmt="parquet_lake")
    with pytest.raises(LakeIncompatibleSchemaError):
        TickLakeReader(root)


def test_incompatible_schema_version_raises_incompatible_schema(tmp_path: Path) -> None:
    root = build_mini_lake(tmp_path / "lake")
    write_lake_json(root, schema_version=2, compatible_versions=[1])
    with pytest.raises(LakeIncompatibleSchemaError):
        TickLakeReader(root)


def test_compatible_versions_admit_newer_schema(tmp_path: Path) -> None:
    root = build_mini_lake(tmp_path / "lake")
    write_lake_json(root, schema_version=2, compatible_versions=[1, 2])
    reader = TickLakeReader(root)
    assert reader.schema_version == 2


def test_missing_schema_version_raises_corrupted_metadata(tmp_path: Path) -> None:
    root = build_mini_lake(tmp_path / "lake")
    (root / "lake.json").write_text(json.dumps({"format": "tick_lake"}), encoding="utf-8")
    with pytest.raises(LakeCorruptedMetadataError):
        TickLakeReader(root)


def test_lake_json_not_an_object_raises_corrupted_metadata(tmp_path: Path) -> None:
    root = build_mini_lake(tmp_path / "lake")
    (root / "lake.json").write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(LakeCorruptedMetadataError):
        TickLakeReader(root)


# --------------------------------------------------------------------------- #
# LAKE-READ-04 — maintenance guard (§6.1, §7.1)
# --------------------------------------------------------------------------- #

def test_maintenance_absent_is_not_in_progress_and_ready(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    assert reader.is_maintenance_in_progress() is False
    reader.ensure_ready()  # must not raise


def test_maintenance_present_blocks_queries(mini_lake: Path) -> None:
    mark_maintenance(mini_lake)
    reader = TickLakeReader(mini_lake)
    assert reader.is_maintenance_in_progress() is True
    with pytest.raises(LakeMaintenanceInProgressError):
        reader.ensure_ready()


def test_maintenance_removal_restores_readiness(mini_lake: Path) -> None:
    guard = mark_maintenance(mini_lake)
    reader = TickLakeReader(mini_lake)
    with pytest.raises(LakeMaintenanceInProgressError):
        reader.ensure_ready()
    guard.unlink()
    assert reader.is_maintenance_in_progress() is False
    reader.ensure_ready()


def test_maintenance_guard_under_env_discovered_lake(mini_lake: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    mark_maintenance(mini_lake)
    monkeypatch.setenv("TICK_LAKE_ROOT", str(mini_lake))
    with pytest.raises(LakeMaintenanceInProgressError):
        TickLakeReader().ensure_ready()


# --------------------------------------------------------------------------- #
# LAKE-READ-03 — filesystem partition pruning
# --------------------------------------------------------------------------- #

def _names(files: List[str]) -> List[str]:
    return [Path(f).name for f in files]


def _parents(files: List[str]) -> List[str]:
    return [Path(f).parent.name for f in files]


def test_resolve_single_date_returns_partition_files(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("NVDA", date(2026, 10, 2), date(2026, 10, 2))
    assert files, "expected NVDA partition files"
    assert all(parent == "date=2026-10-02" for parent in _parents(files))
    assert all(Path(f).suffix == ".parquet" for f in files)


def test_resolve_date_range_includes_both_ends(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("AAPL", date(2026, 10, 2), date(2026, 10, 3))
    assert {parent for parent in _parents(files)} == {"date=2026-10-02", "date=2026-10-03"}


def test_resolve_out_of_range_dates_excluded(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("AAPL", date(2026, 10, 3), date(2026, 10, 3))
    assert {parent for parent in _parents(files)} == {"date=2026-10-03"}


def test_resolve_inclusive_end_false_excludes_end_date(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("AAPL", date(2026, 10, 2), date(2026, 10, 3), inclusive_end=False)
    assert {parent for parent in _parents(files)} == {"date=2026-10-02"}


def test_resolve_nonexistent_symbol_returns_empty_without_error(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    assert reader.resolve_files("ZZZZ", date(2026, 10, 1), date(2026, 10, 31)) == []


def test_resolve_empty_symbol_partition_dir_returns_empty(mini_lake: Path) -> None:
    (mini_lake / "ticks" / "symbol=EMPTY").mkdir(parents=True, exist_ok=True)
    reader = TickLakeReader(mini_lake)
    assert reader.resolve_files("EMPTY", date(2026, 10, 1), date(2026, 10, 31)) == []


def test_resolve_ignores_malformed_date_directories(mini_lake: Path) -> None:
    target = mini_lake / "ticks" / "symbol=NVDA" / "date=not-a-date"
    target.mkdir(parents=True, exist_ok=True)
    write_partition(mini_lake, "NVDA", "2026-10-02", generate_ticks("NVDA", "2026-10-02", 1.0, count=3))
    bogus = target / "batch_writer_1_999999.parquet"
    bogus.write_bytes(b"not parquet")
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("NVDA", date(2026, 1, 1), date(2027, 1, 1))
    assert bogus not in [Path(f) for f in files]


def test_resolve_ignores_non_date_subdirectories(mini_lake: Path) -> None:
    (mini_lake / "ticks" / "symbol=AAPL" / "notes").mkdir(parents=True, exist_ok=True)
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("AAPL", date(2026, 1, 1), date(2027, 1, 1))
    assert all(parent.startswith("date=") for parent in _parents(files))


def test_resolve_ignores_non_parquet_files(mini_lake: Path) -> None:
    stray = partition_dir(mini_lake, "NVDA", "2026-10-02") / "manifest.json"
    stray.write_text("{}", encoding="utf-8")
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("NVDA", date(2026, 10, 2), date(2026, 10, 2))
    assert "manifest.json" not in _names(files)


def test_resolve_is_sorted_and_deterministic(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    first = reader.resolve_files("AAPL", date(2026, 10, 2), date(2026, 10, 3))
    second = reader.resolve_files("AAPL", date(2026, 10, 2), date(2026, 10, 3))
    assert first == second == sorted(first)
    assert len(first) >= 3  # batch + migrated chunk on day 1, batch on day 2


def test_resolve_multiple_files_same_day_all_returned(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("AAPL", date(2026, 10, 2), date(2026, 10, 2))
    assert {"batch_writer_1_000001.parquet", "chunk_000001.parquet"} <= set(_names(files))


def test_resolve_encodes_dotted_symbol_partition(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("BRK.B", date(2026, 10, 2), date(2026, 10, 2))
    assert files
    assert _parents(files)[0] == "date=2026-10-02"
    assert "symbol=BRK%2EB" in files[0]


def test_resolve_encodes_slashed_symbol_partition(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("EUR/USD", date(2026, 10, 2), date(2026, 10, 2))
    assert files
    assert "symbol=EUR%2FUSD" in files[0]


def test_resolve_ignores_unencoded_decoy_partition(tmp_path: Path) -> None:
    """Contract §2.2: the directory is BRK%2EB; symbol=BRK.B must never be read."""
    root = build_mini_lake(tmp_path / "lake")
    decoy = write_partition_raw(
        root,
        "symbol=BRK.B",  # unencoded on purpose — contract §2.2 violation by a bad writer
        "2026-10-02",
        generate_ticks("BRK.B", "2026-10-02", 1.0, count=3),
        "decoy.parquet",
    )

    reader = TickLakeReader(root)
    files = [Path(f) for f in reader.resolve_files("BRK.B", date(2026, 10, 2), date(2026, 10, 2))]
    assert files, "encoded partition must still resolve"
    assert decoy not in files
    assert all(p.name != "decoy.parquet" for p in files)


def test_resolve_uppercases_lowercase_symbol_input(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    upper = reader.resolve_files("BRK.B", date(2026, 10, 2), date(2026, 10, 2))
    lower = reader.resolve_files("brk.b", date(2026, 10, 2), date(2026, 10, 2))
    assert lower == upper and upper


def test_resolve_never_reads_staging_tree(mini_lake: Path) -> None:
    decoy = add_staging_decoy(mini_lake, symbol="AAPL", day="2026-10-02")
    reader = TickLakeReader(mini_lake)
    files = [Path(f) for f in reader.resolve_files("AAPL", date(2026, 10, 2), date(2026, 10, 2))]
    assert decoy not in files
    assert not any("_staging" in str(f) for f in files)


def test_resolve_never_reads_other_symbol_partitions(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("NVDA", date(2026, 10, 2), date(2026, 10, 2))
    assert files
    assert all("symbol=NVDA" in f for f in files)


def test_resolve_does_not_execute_duckdb(mini_lake: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*args, **kwargs):  # pragma: no cover - only fires on regression
        raise AssertionError("resolve_files must not execute DuckDB")

    monkeypatch.setattr(duckdb, "connect", _boom)
    reader = TickLakeReader(mini_lake)
    assert reader.resolve_files("AAPL", date(2026, 10, 2), date(2026, 10, 3))


def test_resolve_is_read_only(mini_lake: Path) -> None:
    def snapshot() -> dict:
        return {
            str(p): (p.stat().st_size, p.stat().st_mtime_ns)
            for p in sorted(mini_lake.rglob("*"))
            if p.is_file()
        }

    before = snapshot()
    reader = TickLakeReader(mini_lake)
    reader.resolve_files("AAPL", date(2026, 10, 2), date(2026, 10, 3))
    reader.resolve_files("BRK.B", date(2026, 10, 2), date(2026, 10, 2))
    reader.list_symbols()
    assert snapshot() == before


@pytest.mark.parametrize(
    "start,end",
    [
        (date(2026, 10, 2), date(2026, 10, 2)),
        (datetime(2026, 10, 2, 0, 0, 0), datetime(2026, 10, 2, 23, 59, 59)),
        ("2026-10-02", "2026-10-02"),
        (datetime(2026, 10, 2, 5, 0, tzinfo=timezone.utc), datetime(2026, 10, 2, 21, 0, tzinfo=timezone.utc)),
    ],
)
def test_resolve_accepts_mixed_datetime_inputs(mini_lake: Path, start, end) -> None:
    reader = TickLakeReader(mini_lake)
    assert reader.resolve_files("NVDA", start, end)


def test_resolve_tz_aware_inputs_normalize_to_utc_date(mini_lake: Path) -> None:
    """2026-10-03T00:30+02:00 is 2026-10-02T22:30Z → belongs to the 10-02 partition."""
    reader = TickLakeReader(mini_lake)
    start = datetime(2026, 10, 3, 0, 30, tzinfo=timezone(timedelta(hours=2)))
    end = datetime(2026, 10, 3, 1, 30, tzinfo=timezone(timedelta(hours=2)))
    files = reader.resolve_files("AAPL", start, end)
    assert files
    assert {parent for parent in _parents(files)} == {"date=2026-10-02"}


def test_resolve_start_after_end_returns_empty(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    assert reader.resolve_files("AAPL", date(2026, 10, 5), date(2026, 10, 1)) == []


def test_resolve_unbounded_range_returns_all_partitions(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    files = reader.resolve_files("AAPL")
    assert {parent for parent in _parents(files)} == {"date=2026-10-02", "date=2026-10-03"}


def test_list_symbols_decodes_partition_names(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    assert reader.list_symbols() == ["AAPL", "BRK.B", "EUR/USD", "JPM", "NVDA"]


def test_list_partition_dates_is_sorted(mini_lake: Path) -> None:
    reader = TickLakeReader(mini_lake)
    assert reader.list_partition_dates("AAPL") == [date(2026, 10, 2), date(2026, 10, 3)]
    assert reader.list_partition_dates("ZZZZ") == []


def test_resolve_ignores_non_canonical_date_directory_names(mini_lake: Path) -> None:
    """`datetime.date.fromisoformat` also accepts `20261002` and ISO-week names such as
    `2026-W40-1`; the contract (§2.2) allows only `date=<YYYY-MM-DD>`. Non-canonical
    directories must be ignored, not silently folded into a query."""
    import shutil

    source = mini_lake / "ticks" / "symbol=NVDA" / "date=2026-10-02" / "batch_writer_1_000001.parquet"
    for name in ("date=20261002", "date=2026-W40-1"):
        target = mini_lake / "ticks" / "symbol=NVDA" / name
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy(source, target / "smuggled.parquet")

    reader = TickLakeReader(mini_lake)
    files = [Path(f) for f in reader.resolve_files("NVDA")]
    assert files
    assert all(p.parent.name == "date=2026-10-02" for p in files)
    assert all(p.name != "smuggled.parquet" for p in files)
    assert reader.list_partition_dates("NVDA") == [date(2026, 10, 2)]


@pytest.mark.parametrize("bad_version", [True, False, "1", 1.5, None, [1]])
def test_non_integer_schema_version_raises_corrupted_metadata(tmp_path: Path, bad_version) -> None:
    root = build_mini_lake(tmp_path / "lake")
    (root / "lake.json").write_text(
        json.dumps({"format": "tick_lake", "schema_version": bad_version, "compatible_versions": [1]}),
        encoding="utf-8",
    )
    with pytest.raises(LakeCorruptedMetadataError):
        TickLakeReader(root)


def test_non_integer_compatible_versions_raises_corrupted_metadata(tmp_path: Path) -> None:
    root = build_mini_lake(tmp_path / "lake")
    (root / "lake.json").write_text(
        json.dumps({"format": "tick_lake", "schema_version": 1, "compatible_versions": [True]}),
        encoding="utf-8",
    )
    with pytest.raises(LakeCorruptedMetadataError):
        TickLakeReader(root)


# --------------------------------------------------------------------------- #
# Integration — sandbox-resident and operator-provided lakes
# --------------------------------------------------------------------------- #

def test_default_discovery_finds_lake_on_a_candidate_path(sandbox_lake: Path) -> None:
    """No-argument discovery must resolve a lake that sits on a candidate path.

    Skipped when this checkout's candidate list does not include the lake
    (e.g. the repo is cloned outside the sandbox layout).
    """
    candidates = {candidate.resolve() for candidate in default_lake_root_candidates()}
    if sandbox_lake.resolve() not in candidates:
        pytest.skip("lake is not on this checkout's discovery candidate paths")
    reader = TickLakeReader()  # no argument, no env → discovery precedence
    assert reader.lake_root == sandbox_lake.resolve()
    assert reader.schema_version == 1


def test_rich_lake_resolves_symbols(session_lake: Path) -> None:
    reader = TickLakeReader(session_lake)
    files = reader.resolve_files("AAPL", date(2026, 10, 2), date(2026, 10, 2))
    assert files and all("symbol=AAPL" in f for f in files)
    assert set(reader.list_symbols()) == {"AAPL", "BRK.B", "EUR/USD", "JPM", "NVDA"}


def test_rich_lake_encoded_symbols_reachable(session_lake: Path) -> None:
    reader = TickLakeReader(session_lake)
    assert reader.resolve_files("BRK.B", date(2026, 10, 2), date(2026, 10, 2))
    assert reader.resolve_files("EUR/USD", date(2026, 10, 2), date(2026, 10, 5))


def test_operator_lake_if_configured(external_lake: Path) -> None:
    reader = TickLakeReader(external_lake)
    assert reader.schema_version == 1
    assert isinstance(reader.list_symbols(), list)
