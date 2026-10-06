"""Phase 41 contract tests — Reverse-chronological Order Flow Tape.

Requirement: LAKE-API-02 (exposed through `/api/ticks?direction=desc` by Phase 41's server work).
Contract: `docs/contracts/repo_b_tick_lake_contract.md` v1.5.0 §4.2 (+ §3 dual schema, §6.1 guard).

Written test-first (red) before `TickLakeReader.query_tape` existed.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import pytest

from tick_lake_factory import (
    build_mini_lake,
    mark_maintenance,
    rows_v1,
    rows_v2,
    write_rows_as,
)

from backend.streaming_service.tick_lake_reader import (
    LakeMaintenanceInProgressError,
    TickLakeReader,
)

DAY = "2026-10-02"
DAY2 = "2026-10-05"


def ts(hms: str, day: str = DAY) -> datetime:
    return datetime.fromisoformat(f"{day}T{hms}")


def fresh_lake(tmp_path: Path) -> Path:
    return build_mini_lake(tmp_path / "lake", symbols={})


def tape_rows(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return rows_v1("AAPL", entries)


def test_tape_is_reverse_chronological(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([
            {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "w1_1"},
            {"timestamp": ts("13:30:05"), "price": 101.0, "volume": 2.0, "ingest_id": "w1_2"},
            {"timestamp": ts("13:30:10"), "price": 102.0, "volume": 3.0, "ingest_id": "w1_3"},
        ]),
        filename="tape_000001.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=10)
    assert [t["price"] for t in tape] == [102.0, 101.0, 100.0]
    assert [t["timestamp"] for t in tape] == sorted((t["timestamp"] for t in tape), reverse=True)


def test_tape_tie_break_uses_ingest_id_descending(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    same = ts("13:30:00")
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([
            {"timestamp": same, "price": 100.0, "volume": 1.0, "ingest_id": "w1_aa_0001"},
            {"timestamp": same, "price": 999.0, "volume": 1.0, "ingest_id": "w1_zz_0002"},
        ]),
        filename="tape_tie_000001.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=10)
    assert [t["price"] for t in tape] == [999.0, 100.0]  # ingest_id ..._zz_ sorts last → first out


def test_tape_computes_spread_from_bid_ask(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([
            {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "s1",
             "bid": 99.95, "ask": 100.05},
            {"timestamp": ts("13:30:01"), "price": 100.1, "volume": 1.0, "ingest_id": "s2",
             "bid": 99.9, "ask": 100.2},
        ]),
        filename="tape_spread_000001.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=10)
    assert [t["spread"] for t in tape] == [0.3, 0.1]
    assert all(isinstance(t["spread"], float) for t in tape)


def test_tape_spread_is_null_when_a_quote_side_is_missing(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "n1"},
    ])
    rows[0]["bid"] = None
    rows[0]["ask"] = 100.05
    write_rows_as(lake, "AAPL", DAY, rows, filename="tape_null_000001.parquet")
    tape = TickLakeReader(lake).query_tape("AAPL", limit=10)
    assert tape[0]["spread"] is None
    assert tape[0]["bid"] is None


def test_tape_supports_schema_v2_quotes(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        rows_v2("AAPL", [
            {"timestamp": ts("13:30:00"), "bid_price": 100.0, "ask_price": 100.5, "ingest_id": "v2_1"},
            {"timestamp": ts("13:30:01"), "bid_price": 100.2, "ask_price": 100.6, "ingest_id": "v2_2"},
        ]),
        schema="v2",
        filename="tape_v2_000001.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=10)
    assert [t["price"] for t in tape] == [100.2, 100.0]     # bid_price is the v2 quote
    assert [t["bid"] for t in tape] == [100.2, 100.0]
    assert [t["ask"] for t in tape] == [100.6, 100.5]
    assert [t["spread"] for t in tape] == [0.4, 0.5]


def test_tape_merges_mixed_schema_partitions(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        rows_v1("AAPL", [{"timestamp": ts("13:30:00"), "price": 100.0, "volume": 2.0, "ingest_id": "mix_v1",
                          "bid": 99.9, "ask": 100.1}]),
        filename="tape_mixed_v1_000001.parquet",
    )
    write_rows_as(
        lake, "AAPL", DAY,
        rows_v2("AAPL", [{"timestamp": ts("13:30:01"), "bid_price": 101.0, "ask_price": 101.4, "ingest_id": "mix_v2"}]),
        schema="v2",
        filename="tape_mixed_v2_000002.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=10)
    assert [t["price"] for t in tape] == [101.0, 100.0]
    assert [t["spread"] for t in tape] == [0.4, 0.2]


def test_tape_respects_limit(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([
            {"timestamp": ts(f"13:30:0{i}"), "price": 100.0 + i, "volume": 1.0, "ingest_id": f"l{i}"}
            for i in range(6)
        ]),
        filename="tape_limit_000001.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=3)
    assert len(tape) == 3
    assert [t["price"] for t in tape] == [105.0, 104.0, 103.0]


def test_tape_spills_into_older_partitions_to_satisfy_limit(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY, tape_rows([
            {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "old_1"},
        ]), filename="tape_old_000001.parquet",
    )
    write_rows_as(
        lake, "AAPL", DAY2, tape_rows([
            {"timestamp": ts("13:30:00", DAY2), "price": 200.0, "volume": 1.0, "ingest_id": "new_1"},
        ]), filename="tape_new_000001.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=2)
    assert [t["price"] for t in tape] == [200.0, 100.0]


def test_tape_coalesces_null_volume(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([{"timestamp": ts("13:30:00"), "price": 100.0, "volume": None, "ingest_id": "nv1"}]),
        filename="tape_nullvol_000001.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=1)
    assert tape[0]["volume"] == 1.0


def test_tape_returns_contract_keys(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([{"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "k1"}]),
        filename="tape_keys_000001.parquet",
    )
    entry = TickLakeReader(lake).query_tape("AAPL", limit=1)[0]
    assert set(entry) == {"timestamp", "symbol", "price", "volume", "bid", "ask", "spread", "source", "session"}
    assert entry["symbol"] == "AAPL"
    assert entry["timestamp"].startswith(DAY)


def test_tape_isolates_symbol_and_ignores_foreign_rows(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        rows_v1("NVDA", [{"timestamp": ts("13:30:00"), "price": 999.0, "volume": 9.0, "ingest_id": "foreign"}]),
        filename="tape_foreign_000001.parquet",
    )
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([{"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "own"}]),
        filename="tape_own_000002.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=10)
    assert [t["price"] for t in tape] == [100.0]


def test_tape_respects_start_and_end_bounds(tmp_path: Path) -> None:
    """Re-verification defect A: the tape ignored `start_time`/`end_time`."""
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([
            {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "b1"},
            {"timestamp": ts("13:31:00"), "price": 101.0, "volume": 1.0, "ingest_id": "b2"},
            {"timestamp": ts("13:32:00"), "price": 102.0, "volume": 1.0, "ingest_id": "b3"},
        ]),
        filename="tape_bounds_000001.parquet",
    )
    reader = TickLakeReader(lake)
    bounded = reader.query_tape("AAPL", limit=10, start_time=f"{DAY}T13:30:30", end_time=f"{DAY}T13:31:30")
    assert [t["price"] for t in bounded] == [101.0]

    upper = reader.query_tape("AAPL", limit=10, end_time=f"{DAY}T13:31:00")
    assert [t["price"] for t in upper] == [101.0, 100.0]  # explicit end is inclusive

    lower = reader.query_tape("AAPL", limit=10, start_time=f"{DAY}T13:31:00")
    assert [t["price"] for t in lower] == [102.0, 101.0]


def test_tape_date_only_end_bound_is_inclusive(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY, tape_rows([
            {"timestamp": ts("00:00:01"), "price": 100.0, "volume": 1.0, "ingest_id": "d1"},
            {"timestamp": ts("23:59:59"), "price": 101.0, "volume": 1.0, "ingest_id": "d2"},
        ]), filename="tape_dayend_000001.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=10, end_time=DAY)
    assert [t["price"] for t in tape] == [101.0, 100.0]


def test_tape_bounds_span_partitions_and_still_spill(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(lake, "AAPL", DAY, tape_rows([
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "sp_old"},
    ]), filename="tape_sp_old_000001.parquet")
    write_rows_as(lake, "AAPL", DAY2, tape_rows([
        {"timestamp": ts("13:30:00", DAY2), "price": 200.0, "volume": 1.0, "ingest_id": "sp_new"},
    ]), filename="tape_sp_new_000001.parquet")

    tape = TickLakeReader(lake).query_tape("AAPL", limit=2, start_time=DAY, end_time=DAY2)
    assert [t["price"] for t in tape] == [200.0, 100.0]

    only_old = TickLakeReader(lake).query_tape("AAPL", limit=5, end_time=DAY)
    assert [t["price"] for t in only_old] == [100.0]


def test_tape_excludes_rows_beyond_a_date_only_end_bound(tmp_path: Path) -> None:
    """The exclusive `< next midnight` predicate must bound rows inside an included partition.

    Guards the date-only end semantics against rows whose event timestamp falls after the
    folder's date (late-arriving/mis-partitioned data).
    """
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY, tape_rows([
            {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "in_day"},
            {"timestamp": ts("00:00:30", DAY2), "price": 999.0, "volume": 1.0, "ingest_id": "after_day"},
        ]), filename="tape_late_000001.parquet",
    )
    tape = TickLakeReader(lake).query_tape("AAPL", limit=10, end_time=DAY)
    assert [t["price"] for t in tape] == [100.0]

    unbounded = TickLakeReader(lake).query_tape("AAPL", limit=10)
    assert [t["price"] for t in unbounded] == [999.0, 100.0]


def test_tape_prunes_partitions_outside_the_time_bounds(tmp_path: Path, monkeypatch) -> None:
    """Bounded tapes must resolve only the partitions inside the range (pruning)."""
    lake = fresh_lake(tmp_path)
    write_rows_as(lake, "AAPL", DAY, tape_rows([
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "p_old"},
    ]), filename="tape_p_old_000001.parquet")
    write_rows_as(lake, "AAPL", DAY2, tape_rows([
        {"timestamp": ts("13:30:00", DAY2), "price": 200.0, "volume": 1.0, "ingest_id": "p_new"},
    ]), filename="tape_p_new_000001.parquet")

    reader = TickLakeReader(lake)
    resolved_days: List[str] = []
    original = reader.resolve_files

    def spy(symbol, start=None, end=None, **kwargs):
        resolved_days.append(str(start))
        return original(symbol, start, end, **kwargs)

    monkeypatch.setattr(reader, "resolve_files", spy)
    tape = reader.query_tape("AAPL", limit=5, start_time=DAY2, end_time=DAY2)
    assert [t["price"] for t in tape] == [200.0]
    assert resolved_days == [DAY2], f"only the in-range partition may be resolved, got {resolved_days}"


def test_unknown_symbol_returns_empty(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    assert TickLakeReader(lake).query_tape("ZZZZ", limit=5) == []


def test_tape_limit_zero_returns_empty(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([{"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "z1"}]),
        filename="tape_zero_000001.parquet",
    )
    assert TickLakeReader(lake).query_tape("AAPL", limit=0) == []


def test_tape_blocked_by_maintenance_guard(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(
        lake, "AAPL", DAY,
        tape_rows([{"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "m1"}]),
        filename="tape_maint_000001.parquet",
    )
    mark_maintenance(lake)
    with pytest.raises(LakeMaintenanceInProgressError):
        TickLakeReader(lake).query_tape("AAPL", limit=5)


def test_tape_against_rich_lake(session_lake: Path) -> None:
    reader = TickLakeReader(session_lake)
    tape = reader.query_tape("NVDA", limit=25)
    assert len(tape) == 25
    timestamps = [t["timestamp"] for t in tape]
    assert timestamps == sorted(timestamps, reverse=True)
    assert all(t["symbol"] == "NVDA" for t in tape)
