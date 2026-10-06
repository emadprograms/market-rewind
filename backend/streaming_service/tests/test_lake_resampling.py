"""Phase 40 contract tests — Deterministic OHLCV Aggregation & Dual Schema Ingestion.

Requirements: LAKE-RESAMPLE-01, LAKE-RESAMPLE-02, LAKE-RESAMPLE-03, LAKE-RESAMPLE-04
Contract: `docs/contracts/repo_b_tick_lake_contract.md` v1.5.0 (§2.3, §3, §3.4, §4.1, §6.1, §7.3)

Written test-first (red) before the resampling layer was added to
`backend/streaming_service/tick_lake_reader.py`.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import duckdb
import pytest

from tick_lake_factory import (
    build_mini_lake,
    mark_maintenance,
    rows_v1,
    rows_v2,
    write_lake_json,
    write_partition,
    write_rows_as,
)

from backend.streaming_service.tick_lake_reader import (
    LakeIncompatibleSchemaError,
    LakeMaintenanceInProgressError,
    TickLakeReader,
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

DAY = "2026-10-02"


def ts(hms: str) -> datetime:
    return datetime.fromisoformat(f"{DAY}T{hms}")


def fresh_lake(tmp_path: Path) -> Path:
    """Empty lake (valid lake.json, no partitions) for precise-value tests.

    Keeps exact-value assertions free of the mini lake's generated random ticks.
    """
    return build_mini_lake(tmp_path / "lake", symbols={})


def reader_for(root: Path, **kwargs) -> TickLakeReader:
    return TickLakeReader(root, **kwargs)


def expected_candle(rows: List[Dict[str, Any]]) -> Dict[str, float]:
    """Independent Python implementation of contract §3.4 formulas."""
    ordered = sorted(rows, key=lambda r: (r["timestamp"], r["ingest_id"]))
    prices = [r["price"] for r in rows]
    return {
        "open": ordered[0]["price"],
        "close": ordered[-1]["price"],
        "high": max(prices),
        "low": min(prices),
        "volume": sum(r["volume"] if r["volume"] is not None else 1.0 for r in rows),
        "tick_count": len(rows),
    }


class ConnectSpy:
    """Records duckdb.connect arguments and per-connection SQL statements.

    Keeps a private reference to the real connector so installing the spy via
    ``monkeypatch.setattr(duckdb, "connect", spy)`` cannot recurse into itself.
    """

    def __init__(self) -> None:
        self._real_connect = duckdb.connect
        self.calls: List[Dict[str, Any]] = []

    def __call__(self, database: str = ":memory:", *args, **kwargs):
        real = self._real_connect(database, *args, **kwargs)
        record: Dict[str, Any] = {"database": database, "sql": [], "closed": False}
        self.calls.append(record)

        class Connection:
            def execute(self, sql, params=None):
                record["sql"].append(sql)
                if params is None:
                    return real.execute(sql)
                return real.execute(sql, params)

            def close(self):
                record["closed"] = True
                real.close()

            def __getattr__(self, item):
                return getattr(real, item)

        return Connection()


# --------------------------------------------------------------------------- #
# LAKE-RESAMPLE-01 — isolated in-memory DuckDB runner
# --------------------------------------------------------------------------- #

def test_query_uses_memory_connection_with_required_settings(tmp_path: Path, monkeypatch) -> None:
    lake = build_mini_lake(tmp_path / "lake")
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 2.0, "ingest_id": "w1_1_0001"},
        {"timestamp": ts("13:30:05"), "price": 101.0, "volume": 3.0, "ingest_id": "w1_1_0002"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="spy_000001.parquet")

    spy = ConnectSpy()
    monkeypatch.setattr(duckdb, "connect", spy)
    candles = reader_for(lake).query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    assert candles

    assert spy.calls, "expected at least one DuckDB connection"
    for call in spy.calls:
        assert call["database"] == ":memory:"
        sql = "\n".join(call["sql"])
        assert "SET TimeZone = 'UTC'" in sql
        assert "SET threads = 4" in sql
        assert "SET max_memory = '2GB'" in sql
        assert call["closed"] is True


def test_each_query_opens_and_closes_its_own_connection(tmp_path: Path, monkeypatch) -> None:
    lake = build_mini_lake(tmp_path / "lake")
    spy = ConnectSpy()
    monkeypatch.setattr(duckdb, "connect", spy)
    reader = reader_for(lake)
    reader.query_candles("AAPL", start_time="2026-10-02", end_time="2026-10-03")
    first = len(spy.calls)
    reader.query_candles("NVDA", start_time="2026-10-02", end_time="2026-10-03")
    assert len(spy.calls) > first
    assert first >= 1
    assert spy.calls[-1]["closed"] is True


def test_hive_partitioning_disabled_in_every_query(tmp_path: Path, monkeypatch) -> None:
    lake = build_mini_lake(tmp_path / "lake")
    spy = ConnectSpy()
    monkeypatch.setattr(duckdb, "connect", spy)
    reader_for(lake).query_candles("AAPL", start_time="2026-10-02", end_time="2026-10-03")
    executed = "\n".join(" ".join(call["sql"]) for call in spy.calls)
    assert "hive_partitioning=false" in executed


def test_empty_partition_returns_empty_without_duckdb(tmp_path: Path, monkeypatch) -> None:
    lake = build_mini_lake(tmp_path / "lake")

    def _boom(*args, **kwargs):  # pragma: no cover - fires only on regression
        raise AssertionError("no DuckDB connection may be opened for an empty result")

    monkeypatch.setattr(duckdb, "connect", _boom)
    reader = reader_for(lake)
    assert reader.query_candles("ZZZZ", start_time="2026-10-02", end_time="2026-10-03") == []
    assert reader.query_candles("AAPL", start_time="2030-01-01", end_time="2030-01-02") == []
    assert reader.query_ticks("AAPL", start_time="2030-01-01", end_time="2030-01-02") == []


def test_reader_is_read_only_during_queries(tmp_path: Path) -> None:
    lake = build_mini_lake(tmp_path / "lake")

    def snapshot() -> Dict[str, Any]:
        return {
            str(p): (p.stat().st_size, p.stat().st_mtime_ns)
            for p in sorted(lake.rglob("*"))
            if p.is_file()
        }

    before = snapshot()
    reader = reader_for(lake)
    reader.query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    reader.query_ticks("AAPL", start_time="2026-10-02", end_time="2026-10-03", limit=5)
    assert snapshot() == before


# --------------------------------------------------------------------------- #
# LAKE-RESAMPLE-02 — deterministic OHLCV aggregation
# --------------------------------------------------------------------------- #

def test_one_minute_candle_matches_reference_formula(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 2.0, "ingest_id": "w1_100_0001"},
        {"timestamp": ts("13:30:20"), "price": 103.5, "volume": None, "ingest_id": "w1_120_0002"},
        {"timestamp": ts("13:30:59"), "price": 99.5, "volume": 1.5, "ingest_id": "w1_159_0003"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="ref_000001.parquet")

    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03"
    )
    target = [c for c in candles if c["time"].startswith(f"{DAY}T13:30")]
    assert len(target) == 1
    candle = target[0]
    expected = expected_candle(rows)
    assert candle["open"] == expected["open"] == 100.0
    assert candle["close"] == expected["close"] == 99.5
    assert candle["high"] == expected["high"] == 103.5
    assert candle["low"] == expected["low"] == 99.5
    assert candle["volume"] == expected["volume"] == 4.5   # 2.0 + 1.0 (null→1.0) + 1.5
    assert candle["tick_count"] == expected["tick_count"] == 3


def test_candles_split_across_bucket_boundaries(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "b1"},
        {"timestamp": ts("13:30:30"), "price": 101.0, "volume": 1.0, "ingest_id": "b2"},
        {"timestamp": ts("13:31:05"), "price": 102.0, "volume": 1.0, "ingest_id": "b3"},
        {"timestamp": ts("13:31:59"), "price": 90.0, "volume": 1.0, "ingest_id": "b4"},
        {"timestamp": ts("13:32:00"), "price": 95.0, "volume": 1.0, "ingest_id": "b5"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="split_000001.parquet")

    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03"
    )
    by_time = {c["time"]: c for c in candles if c["time"].startswith(f"{DAY}T13:3")}
    assert by_time[f"{DAY}T13:30:00"]["tick_count"] == 2
    assert by_time[f"{DAY}T13:30:00"]["open"] == 100.0
    assert by_time[f"{DAY}T13:30:00"]["close"] == 101.0
    assert by_time[f"{DAY}T13:31:00"]["tick_count"] == 2
    assert by_time[f"{DAY}T13:31:00"]["high"] == 102.0
    assert by_time[f"{DAY}T13:31:00"]["close"] == 90.0
    assert by_time[f"{DAY}T13:32:00"]["tick_count"] == 1


@pytest.mark.parametrize(
    "timeframe,seconds,group_a,group_b",
    [
        ("1s", 1, 1, 1),
        ("5s", 5, 5, 1),
        ("15s", 15, 6, 0),
        ("30s", 30, 6, 0),
    ],
)
def test_subsecond_timeframes(tmp_path: Path, timeframe: str, seconds: int, group_a: int, group_b: int) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00") + timedelta(seconds=i), "price": 100.0 + i, "volume": 1.0, "ingest_id": f"s{i:04d}"}
        for i in range(6)
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="sub_000001.parquet")

    candles = reader_for(lake).query_candles(
        "AAPL", timeframe=timeframe, start_time="2026-10-02", end_time="2026-10-03"
    )
    counts = [c["tick_count"] for c in candles]
    assert sum(counts) == 6
    assert counts[0] == group_a
    if group_b:
        assert counts[1] == group_b


@pytest.mark.parametrize(
    "timeframe,t1,t2,t3",
    [
        ("5m", "13:30:00", "13:32:00", "13:34:00"),
        ("15m", "13:30:00", "13:38:00", "13:44:00"),
        ("30m", "13:30:00", "13:38:00", "13:44:00"),
        ("1h", "13:30:00", "13:45:00", "13:59:00"),
        ("4h", "13:30:00", "13:45:00", "13:59:00"),
    ],
)
def test_larger_timeframes_aggregate_one_bucket(tmp_path: Path, timeframe: str, t1: str, t2: str, t3: str) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts(t1), "price": 100.0, "volume": 1.0, "ingest_id": "L1"},
        {"timestamp": ts(t2), "price": 105.0, "volume": 2.0, "ingest_id": "L2"},
        {"timestamp": ts(t3), "price": 95.0, "volume": 3.0, "ingest_id": "L3"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="large_000001.parquet")

    candles = reader_for(lake).query_candles(
        "AAPL", timeframe=timeframe, start_time="2026-10-02", end_time="2026-10-03"
    )
    assert len(candles) == 1
    assert (candles[0]["open"], candles[0]["close"], candles[0]["high"], candles[0]["low"]) == (100.0, 95.0, 105.0, 95.0)
    assert candles[0]["volume"] == 6.0


def test_tie_break_uses_ingest_id_not_row_order(tmp_path: Path) -> None:
    """Two ticks share a microsecond timestamp; ingest_id decides open/close (§3.4)."""
    lake = fresh_lake(tmp_path)
    same_moment = ts("13:30:00")
    rows = rows_v1("AAPL", [
        {"timestamp": same_moment, "price": 999.0, "volume": 1.0, "ingest_id": "w1_zz_0002"},
        {"timestamp": same_moment, "price": 100.0, "volume": 1.0, "ingest_id": "w1_aa_0001"},
    ])  # deliberately NOT sorted by ingest_id
    write_rows_as(lake, "AAPL", DAY, rows, filename="tie_000001.parquet")

    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03"
    )
    candle = [c for c in candles if c["time"].startswith(f"{DAY}T13:30")][0]
    assert candle["open"] == 100.0    # ingest_id ..._aa_0001 sorts first
    assert candle["close"] == 999.0   # ingest_id ..._zz_0002 sorts last
    assert candle["high"] == 999.0
    assert candle["low"] == 100.0
    assert candle["tick_count"] == 2


def test_reversed_file_list_produces_identical_candles(tmp_path: Path, monkeypatch) -> None:
    lake = fresh_lake(tmp_path)
    morning = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "m1"},
        {"timestamp": ts("13:30:30"), "price": 101.0, "volume": 1.0, "ingest_id": "m2"},
    ])
    afternoon = rows_v1("AAPL", [
        {"timestamp": ts("13:31:00"), "price": 102.0, "volume": 1.0, "ingest_id": "a1"},
        {"timestamp": ts("13:31:30"), "price": 99.0, "volume": 1.0, "ingest_id": "a2"},
    ])
    write_rows_as(lake, "AAPL", DAY, morning, filename="batch_000002.parquet")
    write_rows_as(lake, "AAPL", DAY, afternoon, filename="batch_000001.parquet")

    reader = reader_for(lake)
    original = reader.resolve_files
    forward = reader.query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")

    monkeypatch.setattr(TickLakeReader, "resolve_files", lambda self, *a, **k: list(reversed(original("AAPL", "2026-10-02", "2026-10-03"))))
    reversed_run = reader_for(lake).query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    monkeypatch.undo()

    assert forward == reversed_run


def test_repeated_queries_are_byte_identical(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "rep_1"},
        {"timestamp": ts("13:31:00"), "price": 101.0, "volume": 2.0, "ingest_id": "rep_2"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="repeat_000001.parquet")
    reader = reader_for(lake)
    first = reader.query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    second = reader.query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    assert first == second and first


def test_candles_only_include_requested_symbol(tmp_path: Path) -> None:
    lake = build_mini_lake(tmp_path / "lake")
    candles = reader_for(lake).query_candles("AAPL", start_time="2026-10-02", end_time="2026-10-03")
    assert candles and all(c["symbol"] == "AAPL" for c in candles if "symbol" in c)


def test_rows_for_another_symbol_inside_the_partition_are_excluded(tmp_path: Path) -> None:
    """A mis-partitioned foreign row must not leak into another symbol's candles."""
    lake = fresh_lake(tmp_path)
    foreign = rows_v1("NVDA", [
        {"timestamp": ts("13:30:00"), "price": 999.0, "volume": 9.0, "ingest_id": "foreign_1"},
    ])
    write_rows_as(lake, "AAPL", DAY, foreign, filename="foreign_000001.parquet")
    own = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "own_1"},
    ])
    write_rows_as(lake, "AAPL", DAY, own, filename="own_000002.parquet")

    candles = reader_for(lake).query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    assert len(candles) == 1
    assert candles[0]["open"] == 100.0 and candles[0]["high"] == 100.0
    assert candles[0]["tick_count"] == 1


def test_start_end_time_bounds_are_respected(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "t1"},
        {"timestamp": ts("13:35:00"), "price": 101.0, "volume": 1.0, "ingest_id": "t2"},
        {"timestamp": ts("13:40:00"), "price": 102.0, "volume": 1.0, "ingest_id": "t3"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="bounds_000001.parquet")

    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m",
        start_time=f"{DAY}T13:34:00", end_time=f"{DAY}T13:36:00",
    )
    times = [c["time"] for c in candles]
    assert times == [f"{DAY}T13:35:00"]


def test_date_only_end_time_is_inclusive_of_the_whole_day(tmp_path: Path) -> None:
    """`end_time='2026-10-02'` is a date range end, not midnight (documented behavior)."""
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("00:00:01"), "price": 100.0, "volume": 1.0, "ingest_id": "mid_1"},
        {"timestamp": ts("23:59:59"), "price": 101.0, "volume": 1.0, "ingest_id": "mid_2"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="midnight_000001.parquet")
    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-02"
    )
    assert sum(c["tick_count"] for c in candles) == 2


def test_explicit_end_timestamp_keeps_inclusive_leq_semantics(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "leq_1"},
        {"timestamp": ts("13:31:00"), "price": 101.0, "volume": 1.0, "ingest_id": "leq_2"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="leq_000001.parquet")
    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m", start_time=f"{DAY}T13:00:00", end_time=f"{DAY}T13:30:00"
    )
    assert [c["open"] for c in candles] == [100.0]


def test_ticks_exclude_rows_beyond_a_date_only_end_bound(tmp_path: Path) -> None:
    """Shared end-bound predicate: rows timestamped after a date-only end are excluded."""
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "in_day"},
        {"timestamp": datetime.fromisoformat("2026-10-05T00:00:30"), "price": 999.0, "volume": 1.0,
         "ingest_id": "after_day"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="late_ticks_000001.parquet")

    bounded = reader_for(lake).query_ticks("AAPL", limit=10, end_time=DAY)
    assert [t["price"] for t in bounded] == [100.0]

    unbounded = reader_for(lake).query_ticks("AAPL", limit=10)
    assert [t["price"] for t in unbounded] == [100.0, 999.0]


def test_candles_exclude_rows_beyond_a_date_only_end_bound(tmp_path: Path) -> None:
    """Shared end-bound predicate (candles variant): late rows in an included partition drop."""
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "c_in_day"},
        {"timestamp": datetime.fromisoformat("2026-10-05T00:00:30"), "price": 999.0, "volume": 1.0,
         "ingest_id": "c_after_day"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="late_candles_000001.parquet")

    bounded = reader_for(lake).query_candles("AAPL", timeframe="1m", limit=50, end_time=DAY)
    assert [c["high"] for c in bounded] == [100.0]

    unbounded = reader_for(lake).query_candles("AAPL", timeframe="1m", limit=50)
    assert max(c["high"] for c in unbounded) == 999.0


def test_desc_direction_returns_latest_n_in_ascending_order(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts(f"13:3{i}:00"), "price": 100.0 + i, "volume": 1.0, "ingest_id": f"d{i}"}
        for i in range(5)
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="desc_000001.parquet")

    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03",
        limit=2, direction="desc",
    )
    assert [c["time"] for c in candles] == [f"{DAY}T13:33:00", f"{DAY}T13:34:00"]
    assert [c["open"] for c in candles] == [103.0, 104.0]


def test_end_time_without_direction_returns_latest_window(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts(f"13:3{i}:00"), "price": 100.0 + i, "volume": 1.0, "ingest_id": f"e{i}"}
        for i in range(5)
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="window_000001.parquet")

    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m", end_time=f"{DAY}T13:33:00", limit=2,
    )
    assert [c["open"] for c in candles] == [102.0, 103.0]


def test_limit_is_clamped_and_never_negative(tmp_path: Path) -> None:
    lake = build_mini_lake(tmp_path / "lake")
    reader = reader_for(lake)
    assert len(reader.query_candles("AAPL", start_time="2026-10-02", end_time="2026-10-03", limit=1)) <= 1
    assert reader.query_candles("AAPL", start_time="2026-10-02", end_time="2026-10-03", limit=0) == []


def test_unknown_timeframe_defaults_to_one_minute(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "u1"},
        {"timestamp": ts("13:30:30"), "price": 101.0, "volume": 1.0, "ingest_id": "u2"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="unknown_000001.parquet")
    candles = reader_for(lake).query_candles("AAPL", timeframe="7m", start_time="2026-10-02", end_time="2026-10-03")
    assert len(candles) == 1 and candles[0]["tick_count"] == 2


def test_timeframe_normalization_case_insensitive(tmp_path: Path) -> None:
    lake = build_mini_lake(tmp_path / "lake")
    reader = reader_for(lake)
    assert reader.query_candles("AAPL", timeframe="1M", start_time="2026-10-02", end_time="2026-10-03") == \
           reader.query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")


# --------------------------------------------------------------------------- #
# LAKE-RESAMPLE-03 — dual schema ingestion
# --------------------------------------------------------------------------- #

V2_ENTRIES = [
    {"timestamp": ts("13:30:00"), "bid_price": 100.0, "ask_price": 100.2, "ingest_id": "v2_1"},
    {"timestamp": ts("13:31:00"), "bid_price": 101.0, "ask_price": 101.2, "ingest_id": "v2_2"},
]


def test_schema_v2_only_files_resample_from_bid_price(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v2("AAPL", V2_ENTRIES)
    write_rows_as(lake, "AAPL", DAY, rows, schema="v2", filename="v2_only_000001.parquet")

    candles = reader_for(lake).query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    assert [(c["time"], c["open"], c["close"]) for c in candles] == [
        (f"{DAY}T13:30:00", 100.0, 100.0),
        (f"{DAY}T13:31:00", 101.0, 101.0),
    ]
    assert all(c["volume"] == 1.0 for c in candles)  # v2 has no volume column → per-tick 1.0


def test_schema_v1_and_v2_produce_identical_candles_for_identical_prices(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    v1_rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "v1_1"},
        {"timestamp": ts("13:31:00"), "price": 101.0, "volume": 1.0, "ingest_id": "v1_2"},
    ])
    v2_rows = rows_v2("NVDA", [
        {"timestamp": ts("13:30:00"), "bid_price": 100.0, "ask_price": 100.2, "ingest_id": "v2_1"},
        {"timestamp": ts("13:31:00"), "bid_price": 101.0, "ask_price": 101.2, "ingest_id": "v2_2"},
    ])
    write_rows_as(lake, "AAPL", DAY, v1_rows, filename="v1_000001.parquet")
    write_rows_as(lake, "NVDA", DAY, v2_rows, schema="v2", filename="v2_000001.parquet")

    reader = reader_for(lake)
    v1 = reader.query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    v2 = reader.query_candles("NVDA", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    assert [(c["time"], c["open"], c["high"], c["low"], c["close"]) for c in v1] == \
           [(c["time"], c["open"], c["high"], c["low"], c["close"]) for c in v2]


def test_mixed_schema_partitions_in_one_query_are_coalesced(tmp_path: Path) -> None:
    """Mid-rewrite reality: one date partition holds a v1 file and a v2 file."""
    lake = fresh_lake(tmp_path)
    v1_rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 2.0, "ingest_id": "mix_1"},
    ])
    v2_rows = rows_v2("AAPL", [
        {"timestamp": ts("13:31:00"), "bid_price": 101.0, "ask_price": 101.2, "ingest_id": "mix_2"},
    ])
    write_rows_as(lake, "AAPL", DAY, v1_rows, filename="mixed_v1_000001.parquet")
    write_rows_as(lake, "AAPL", DAY, v2_rows, schema="v2", filename="mixed_v2_000002.parquet")

    candles = reader_for(lake).query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    assert [(c["time"], c["open"], c["close"]) for c in candles] == [
        (f"{DAY}T13:30:00", 100.0, 100.0),
        (f"{DAY}T13:31:00", 101.0, 101.0),
    ]
    assert candles[0]["volume"] == 2.0      # v1 volume preserved
    assert candles[1]["volume"] == 1.0      # v2 row contributes 1.0


def test_mixed_schema_uses_union_by_name_only_when_heterogeneous(tmp_path: Path, monkeypatch) -> None:
    lake = fresh_lake(tmp_path)
    v1_rows = rows_v1("AAPL", [{"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "h1"}])
    v2_rows = rows_v2("AAPL", [{"timestamp": ts("13:31:00"), "bid_price": 101.0, "ask_price": 101.2, "ingest_id": "h2"}])
    write_rows_as(lake, "AAPL", DAY, v1_rows, filename="h_v1_000001.parquet")
    write_rows_as(lake, "NVDA", DAY, v2_rows, schema="v2", filename="h_v2_000001.parquet")

    spy = ConnectSpy()
    monkeypatch.setattr(duckdb, "connect", spy)
    reader = reader_for(lake)
    reader.query_candles("AAPL", start_time="2026-10-02", end_time="2026-10-03")   # homogeneous v1
    plain_sql = " ".join(spy.calls[-1]["sql"])
    assert "union_by_name" not in plain_sql

    write_rows_as(lake, "AAPL", DAY, v2_rows, schema="v2", filename="mixed_000002.parquet")
    reader.query_candles("AAPL", start_time="2026-10-02", end_time="2026-10-03")   # now heterogeneous
    mixed_sql = " ".join(spy.calls[-1]["sql"])
    assert "union_by_name=true" in mixed_sql


def test_file_without_ingest_id_raises_incompatible_schema(tmp_path: Path) -> None:
    """ingest_id is the deterministic tie-break key (§3.4); a file lacking it is unusable."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    lake = fresh_lake(tmp_path)
    target = lake / "ticks" / "symbol=AAPL" / f"date={DAY}"
    target.mkdir(parents=True, exist_ok=True)
    table = pa.table({
        "timestamp": pa.array([ts("13:30:00")], type=pa.timestamp("us")),
        "symbol": pa.array(["AAPL"]).dictionary_encode(),
        "price": pa.array([100.0], type=pa.float64()),
        "volume": pa.array([1.0], type=pa.float64()),
        "bid": pa.array([99.9], type=pa.float64()),
        "ask": pa.array([100.1], type=pa.float64()),
        "source": pa.array(["CAPITAL"], type=pa.string()),
        "session": pa.array(["REG"], type=pa.string()),
    })
    pq.write_table(table, target / "no_ingest_000001.parquet")

    with pytest.raises(LakeIncompatibleSchemaError):
        reader_for(lake).query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")


# --------------------------------------------------------------------------- #
# LAKE-RESAMPLE-04 — daily RTH session isolation
# --------------------------------------------------------------------------- #

def _session_rows() -> List[Dict[str, Any]]:
    return rows_v1("AAPL", [
        {"timestamp": ts("12:00:00"), "price": 90.0, "volume": 10.0, "session": "PRE", "ingest_id": "p1"},
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "session": "REG", "ingest_id": "r1"},
        {"timestamp": ts("15:00:00"), "price": 110.0, "volume": 2.0, "session": "REG", "ingest_id": "r2"},
        {"timestamp": ts("21:00:00"), "price": 80.0, "volume": 100.0, "session": "POST", "ingest_id": "q1"},
    ])


def test_daily_candles_exclude_pre_and_post_sessions(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(lake, "AAPL", DAY, _session_rows(), filename="sessions_000001.parquet")

    candles = reader_for(lake).query_candles("AAPL", timeframe="1d", start_time="2026-10-02", end_time="2026-10-02")
    assert len(candles) == 1
    candle = candles[0]
    assert candle["open"] == 100.0
    assert candle["close"] == 110.0
    assert candle["high"] == 110.0
    assert candle["low"] == 100.0
    assert candle["volume"] == 3.0          # PRE 10.0 and POST 100.0 excluded
    assert candle["tick_count"] == 2


def test_daily_rth_filter_is_default_even_without_session_argument(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(lake, "AAPL", DAY, _session_rows(), filename="sessions_default_000001.parquet")
    implicit = reader_for(lake).query_candles("AAPL", timeframe="1d", start_time="2026-10-02", end_time="2026-10-02")
    explicit = reader_for(lake).query_candles("AAPL", timeframe="1d", session="REG", start_time="2026-10-02", end_time="2026-10-02")
    assert implicit == explicit


def test_daily_empty_session_string_still_enforces_rth(tmp_path: Path) -> None:
    """session='' (unspecified) must not silently disable the daily RTH policy."""
    lake = fresh_lake(tmp_path)
    write_rows_as(lake, "AAPL", DAY, _session_rows(), filename="sessions_empty_000001.parquet")
    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1d", session="", start_time="2026-10-02", end_time="2026-10-02"
    )
    assert len(candles) == 1 and candles[0]["tick_count"] == 2


def test_daily_session_override_all_includes_every_session(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(lake, "AAPL", DAY, _session_rows(), filename="sessions_all_000001.parquet")
    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1d", session="ALL", start_time="2026-10-02", end_time="2026-10-02"
    )
    assert len(candles) == 1
    assert candles[0]["tick_count"] == 4
    assert candles[0]["low"] == 80.0 and candles[0]["high"] == 110.0


def test_subsecond_timeframes_are_not_rth_filtered(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(lake, "AAPL", DAY, _session_rows(), filename="sessions_sub_000001.parquet")
    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03"
    )
    assert sum(c["tick_count"] for c in candles) == 4


def test_explicit_pre_session_filter(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    write_rows_as(lake, "AAPL", DAY, _session_rows(), filename="sessions_pre_000001.parquet")
    candles = reader_for(lake).query_candles(
        "AAPL", timeframe="1m", session="PRE", start_time="2026-10-02", end_time="2026-10-03"
    )
    assert sum(c["tick_count"] for c in candles) == 1
    assert candles[0]["open"] == 90.0


# --------------------------------------------------------------------------- #
# Robustness — maintenance, retry-on-IOException, ticks API
# --------------------------------------------------------------------------- #

def test_maintenance_guard_blocks_queries(tmp_path: Path) -> None:
    lake = build_mini_lake(tmp_path / "lake")
    mark_maintenance(lake)
    reader = reader_for(lake)
    with pytest.raises(LakeMaintenanceInProgressError):
        reader.query_candles("AAPL", start_time="2026-10-02", end_time="2026-10-03")
    with pytest.raises(LakeMaintenanceInProgressError):
        reader.query_ticks("AAPL", start_time="2026-10-02", end_time="2026-10-03")


def test_stale_resolved_file_triggers_one_reresolve_and_retry(tmp_path: Path, monkeypatch) -> None:
    """Contract §7.3.3: a file removed between resolve and query raises duckdb.IOException;
    the reader must re-resolve and retry."""
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "retry_1"},
        {"timestamp": ts("13:31:00"), "price": 101.0, "volume": 1.0, "ingest_id": "retry_2"},
    ])
    doomed = write_rows_as(lake, "AAPL", DAY, rows, filename="doomed_000001.parquet")
    keep = rows_v1("AAPL", [
        {"timestamp": ts("13:32:00"), "price": 102.0, "volume": 1.0, "ingest_id": "keep_1"},
    ])
    write_rows_as(lake, "AAPL", DAY, keep, filename="keeper_000002.parquet")

    reader = reader_for(lake)
    original_resolve = reader.resolve_files
    state = {"deleted": False}

    def resolve_then_delete(*args, **kwargs):
        files = original_resolve(*args, **kwargs)
        if not state["deleted"] and str(doomed) in files:
            Path(doomed).unlink()
            state["deleted"] = True
        return files

    monkeypatch.setattr(reader, "resolve_files", resolve_then_delete)
    candles = reader.query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    assert state["deleted"] is True
    assert candles, "retry must produce candles from the remaining partition file"
    assert all(c["open"] == 102.0 for c in candles)


def test_persistent_io_error_propagates(tmp_path: Path, monkeypatch) -> None:
    """If the retry still cannot read the partitions, the IOException surfaces."""
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 1.0, "ingest_id": "dead_1"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="dead_000001.parquet")
    reader = reader_for(lake)
    original_resolve = reader.resolve_files
    state: Dict[str, Any] = {"count": 0, "stale": None}

    def resolve_then_always_return_stale(*args, **kwargs):
        state["count"] += 1
        if state["stale"] is None:
            files = original_resolve(*args, **kwargs)
            state["stale"] = files
            for f in files:
                Path(f).unlink(missing_ok=True)
        return state["stale"]  # retry sees the same (now missing) file list

    monkeypatch.setattr(reader, "resolve_files", resolve_then_always_return_stale)
    with pytest.raises(Exception) as excinfo:
        reader.query_candles("AAPL", timeframe="1m", start_time="2026-10-02", end_time="2026-10-03")
    assert state["count"] == 2, "exactly one retry is attempted"
    assert "IO Error" in str(excinfo.value) or type(excinfo.value).__name__ == "IOException"


def test_query_ticks_returns_legacy_shape(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts("13:30:00"), "price": 100.0, "volume": 2.0, "ingest_id": "k1"},
        {"timestamp": ts("13:30:05"), "price": 101.0, "volume": None, "ingest_id": "k2"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="ticks_000001.parquet")

    ticks = reader_for(lake).query_ticks("AAPL", start_time="2026-10-02", end_time="2026-10-03", limit=10)
    assert len(ticks) == 2
    first = ticks[0]
    for key in ("time", "symbol", "price", "volume", "bid", "ask", "source", "session"):
        assert key in first
    assert first["symbol"] == "AAPL"
    assert first["price"] == 100.0
    assert first["volume"] == 2.0
    assert ticks[1]["volume"] == 1.0  # null volume coalesced


def test_query_ticks_direction_and_offset(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    rows = rows_v1("AAPL", [
        {"timestamp": ts(f"13:30:0{i}"), "price": 100.0 + i, "volume": 1.0, "ingest_id": f"o{i}"}
        for i in range(4)
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="offsets_000001.parquet")

    reader = reader_for(lake)
    ascending = reader.query_ticks("AAPL", start_time="2026-10-02", end_time="2026-10-03", limit=2)
    assert [t["price"] for t in ascending] == [100.0, 101.0]
    descending = reader.query_ticks("AAPL", start_time="2026-10-02", end_time="2026-10-03", limit=2, direction="desc")
    assert [t["price"] for t in descending] == [103.0, 102.0]
    offset = reader.query_ticks("AAPL", start_time="2026-10-02", end_time="2026-10-03", limit=2, offset=2)
    assert [t["price"] for t in offset] == [102.0, 103.0]


def test_query_ticks_tie_break_is_deterministic(tmp_path: Path) -> None:
    lake = fresh_lake(tmp_path)
    same = ts("13:30:00")
    rows = rows_v1("AAPL", [
        {"timestamp": same, "price": 999.0, "volume": 1.0, "ingest_id": "w1_zz_0002"},
        {"timestamp": same, "price": 100.0, "volume": 1.0, "ingest_id": "w1_aa_0001"},
    ])
    write_rows_as(lake, "AAPL", DAY, rows, filename="tie_ticks_000001.parquet")
    ticks = reader_for(lake).query_ticks("AAPL", start_time="2026-10-02", end_time="2026-10-03", limit=10)
    assert [t["price"] for t in ticks] == [100.0, 999.0]


# --------------------------------------------------------------------------- #
# Integration — sandbox-resident lake
# --------------------------------------------------------------------------- #

def test_rich_lake_candles_and_ticks(session_lake: Path) -> None:
    reader = TickLakeReader(session_lake)
    candles = reader.query_candles("NVDA", timeframe="1m")
    assert candles and all(c["high"] >= c["low"] for c in candles)
    assert all(c["volume"] >= 0 for c in candles)
    ticks = reader.query_ticks("NVDA", limit=20)
    assert len(ticks) == 20


def test_rich_lake_daily_rth_subset_of_all_sessions(session_lake: Path) -> None:
    reader = TickLakeReader(session_lake)
    rth = reader.query_candles("NVDA", timeframe="1d")
    every = reader.query_candles("NVDA", timeframe="1d", session="ALL")
    assert rth and every
    assert sum(c["tick_count"] for c in rth) <= sum(c["tick_count"] for c in every)
