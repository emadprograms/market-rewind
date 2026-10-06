"""Phase 41 contract tests — `DuckDBService` tick-lake adapter.

Requirement: LAKE-API-01 (route all queries through `TickLakeReader`, retire
`streaming.duckdb` attachment, preserve method signatures and response shapes).

These tests replace the legacy `streaming.duckdb` suite (which failed 7/7 after the
database was deleted) with the same intent against the Partitioned Parquet Tick Lake.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from tick_lake_factory import build_mini_lake, mark_maintenance, rows_v1, write_rows_as

from backend.streaming_service.duckdb_client import DuckDBService
from backend.streaming_service.tests.tick_lake_factory import SANDBOX_LAKE_ROOT


@pytest.fixture
def service(mini_lake: Path) -> DuckDBService:
    return DuckDBService(lake_root=mini_lake)


# --------------------------------------------------------------------------- #
# Construction / discovery
# --------------------------------------------------------------------------- #

def test_service_accepts_explicit_lake_root(mini_lake: Path) -> None:
    svc = DuckDBService(lake_root=mini_lake)
    assert svc.reader.lake_root == mini_lake.resolve()
    assert svc.lake_root == mini_lake.resolve()


def test_service_discovers_lake_from_env(mini_lake: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TICK_LAKE_ROOT", str(mini_lake))
    svc = DuckDBService()
    assert svc.reader.lake_root == mini_lake.resolve()


def test_legacy_streaming_path_kwarg_is_accepted_and_ignored(mini_lake: Path) -> None:
    """`create_app(streaming_db=...)` callers must keep working."""
    svc = DuckDBService(streaming_path="/nonexistent/streaming.duckdb", lake_root=mini_lake)
    assert svc.reader.lake_root == mini_lake.resolve()
    assert svc.get_status()["status"] == "ok"


def _module_code_only(path: Path) -> str:
    """Module source with all docstrings and comments removed (behavior-bearing code only)."""
    import ast

    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstring_holders = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
    for node in ast.walk(tree):
        if isinstance(node, docstring_holders) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                node.body = node.body[1:] or [ast.Pass()]
    return ast.unparse(tree)


def test_service_never_attaches_a_disk_database() -> None:
    """The adapter must be lake-only: no disk file handle, no ATTACH, no read-only flag."""
    import re

    import backend.streaming_service.duckdb_client as mod

    code = _module_code_only(Path(mod.__file__))
    assert "attach" not in code.lower()
    assert "read_only" not in code
    assert "streaming_db_path" not in code.lower()
    assert not hasattr(mod, "STREAMING_DB_PATH")
    # duckdb.connect must never be called with a filesystem path in this module
    assert re.search(r"duckdb\.connect\(\s*[^:\s)]", code) is None


# --------------------------------------------------------------------------- #
# get_status
# --------------------------------------------------------------------------- #

def test_service_status_shape(service: DuckDBService) -> None:
    status = service.get_status()
    assert status["status"] == "ok"
    assert "streaming_db" in status
    assert "historical_db" not in status
    assert status["streaming_db"]["exists"] is True
    assert status["streaming_db"]["tick_count"] is not None
    assert status["streaming_db"]["tick_count"] > 0

    lake = status["tick_lake"]
    assert lake["exists"] is True
    assert lake["format"] == "tick_lake"
    assert lake["schema_version"] == 1
    assert lake["maintenance_in_progress"] is False
    assert lake["symbol_count"] == 5
    assert lake["file_count"] > 0
    assert lake["partition_count"] > 0
    assert lake["tick_count"] == status["streaming_db"]["tick_count"]


def test_service_status_reports_maintenance(mini_lake: Path) -> None:
    mark_maintenance(mini_lake)
    status = DuckDBService(lake_root=mini_lake).get_status()
    assert status["status"] == "ok"
    assert status["tick_lake"]["maintenance_in_progress"] is True


def test_service_status_when_lake_missing(tmp_path: Path) -> None:
    status = DuckDBService(lake_root=tmp_path / "absent").get_status()
    assert status["status"] == "unavailable"
    assert status["streaming_db"]["exists"] is False
    assert status["streaming_db"]["tick_count"] == 0
    assert status["tick_lake"]["exists"] is False
    assert "error" in status


def test_service_status_when_metadata_corrupt(tmp_path: Path) -> None:
    from tick_lake_factory import build_mini_lake, corrupt_lake_json

    lake = build_mini_lake(tmp_path / "lake")
    corrupt_lake_json(lake)
    status = DuckDBService(lake_root=lake).get_status()
    assert status["status"] == "degraded"
    assert status["tick_lake"]["exists"] is True
    assert "error" in status


# --------------------------------------------------------------------------- #
# get_symbols
# --------------------------------------------------------------------------- #

def test_service_get_symbols(service: DuckDBService) -> None:
    symbols = service.get_symbols()
    assert isinstance(symbols, list)
    assert len(symbols) == 5
    top = symbols[0]
    for key in ("symbol", "tick_count", "first_tick", "last_tick"):
        assert key in top
    assert top["tick_count"] > 0
    assert isinstance(top["first_tick"], str) and isinstance(top["last_tick"], str)
    assert top["first_tick"] <= top["last_tick"]


def test_service_get_symbols_decodes_encoded_partitions(service: DuckDBService) -> None:
    listing = {row["symbol"] for row in service.get_symbols()}
    assert {"AAPL", "BRK.B", "EUR/USD", "JPM", "NVDA"} <= listing


def test_service_get_symbols_sorted_by_tick_count_desc(service: DuckDBService) -> None:
    counts = [row["tick_count"] for row in service.get_symbols()]
    assert counts == sorted(counts, reverse=True)


def test_service_get_symbols_on_empty_lake_returns_empty(tmp_path: Path) -> None:
    lake = build_mini_lake(tmp_path / "empty", symbols={})
    assert DuckDBService(lake_root=lake).get_symbols() == []


# --------------------------------------------------------------------------- #
# get_symbol_summary
# --------------------------------------------------------------------------- #

def test_service_symbol_summary(service: DuckDBService) -> None:
    summary = service.get_symbol_summary("NVDA")
    assert summary is not None
    assert summary["symbol"] == "NVDA"
    assert summary["tick_count"] > 0
    assert summary["min_price"] <= summary["max_price"]
    assert "latest_quote" in summary
    quote = summary["latest_quote"]
    assert quote["price"] > 0
    assert quote["timestamp"] is not None


def test_service_symbol_summary_is_case_insensitive(service: DuckDBService) -> None:
    assert service.get_symbol_summary("nvda") == service.get_symbol_summary("NVDA")


def test_service_symbol_summary_latest_quote_matches_tape_head(service: DuckDBService) -> None:
    summary = service.get_symbol_summary("NVDA")
    head = service.query_tape("NVDA", limit=1)[0]
    assert summary["latest_quote"]["timestamp"] == head["timestamp"]
    assert summary["latest_quote"]["price"] == head["price"]
    assert summary["latest_quote"]["bid"] == head["bid"]
    assert summary["latest_quote"]["ask"] == head["ask"]
    assert summary["latest_quote"]["volume"] == head["volume"]


def test_service_symbol_summary_unknown_returns_none(service: DuckDBService) -> None:
    assert service.get_symbol_summary("ZZZZ") is None


def test_symbol_summary_ignores_foreign_rows_inside_the_partition(tmp_path: Path) -> None:
    """A mis-partitioned row must not leak into another symbol's stats/summary.

    Complements `test_rows_for_another_symbol_inside_the_partition_are_excluded` (candles)
    and `test_tape_isolates_symbol_and_ignores_foreign_rows` (tape) for the stats path.
    """
    lake = build_mini_lake(tmp_path / "lake", symbols={})
    write_rows_as(
        lake, "AAPL", "2026-10-02",
        rows_v1("NVDA", [{"timestamp": datetime.fromisoformat("2026-10-02T13:30:00"),
                          "price": 999.0, "volume": 9.0, "ingest_id": "foreign_1"}]),
        filename="foreign_000001.parquet",
    )
    write_rows_as(
        lake, "AAPL", "2026-10-02",
        rows_v1("AAPL", [{"timestamp": datetime.fromisoformat("2026-10-02T13:30:00"),
                          "price": 100.0, "volume": 1.0, "ingest_id": "own_1"}]),
        filename="own_000002.parquet",
    )
    svc = DuckDBService(lake_root=lake)

    summary = svc.get_symbol_summary("AAPL")
    assert summary is not None
    assert summary["symbol"] == "AAPL"
    assert summary["tick_count"] == 1
    assert summary["max_price"] == 100.0
    assert summary["latest_quote"]["price"] == 100.0

    # With only foreign rows present, the requested symbol must still report nothing.
    lake2 = build_mini_lake(tmp_path / "lake2", symbols={})
    write_rows_as(
        lake2, "AAPL", "2026-10-02",
        rows_v1("NVDA", [{"timestamp": datetime.fromisoformat("2026-10-02T13:30:00"),
                          "price": 999.0, "volume": 9.0, "ingest_id": "foreign_1"}]),
        filename="foreign_000001.parquet",
    )
    assert DuckDBService(lake_root=lake2).get_symbol_summary("AAPL") is None


def test_service_symbol_summary_encoded_symbol(service: DuckDBService) -> None:
    summary = service.get_symbol_summary("BRK.B")
    assert summary is not None and summary["symbol"] == "BRK.B" and summary["tick_count"] > 0


# --------------------------------------------------------------------------- #
# query_ticks / query_candles delegation
# --------------------------------------------------------------------------- #

def test_service_query_ticks(service: DuckDBService) -> None:
    ticks = service.query_ticks("NVDA", limit=10, direction="asc")
    assert isinstance(ticks, list)
    assert len(ticks) == 10
    first = ticks[0]
    for key in ("time", "symbol", "price", "volume", "bid", "ask", "source", "session"):
        assert key in first
    assert first["symbol"] == "NVDA"
    assert [t["time"] for t in ticks] == sorted(t["time"] for t in ticks)


def test_service_query_ticks_desc(service: DuckDBService) -> None:
    ticks = service.query_ticks("NVDA", limit=5, direction="desc")
    assert [t["time"] for t in ticks] == sorted((t["time"] for t in ticks), reverse=True)


def test_service_query_tape_has_spread(service: DuckDBService) -> None:
    tape = service.query_tape("NVDA", limit=5)
    assert len(tape) == 5
    assert all("spread" in row for row in tape)
    assert all(row["spread"] is not None for row in tape)  # fixture always writes bid/ask


def test_service_dynamic_candles_subsecond(service: DuckDBService) -> None:
    candles = service.query_candles("NVDA", timeframe="1s", limit=10)
    assert isinstance(candles, list) and len(candles) > 0
    candle = candles[0]
    for key in ("time", "open", "high", "low", "close", "volume", "tick_count"):
        assert key in candle
    assert candle["high"] >= candle["low"]


def test_service_dynamic_candles_minute(service: DuckDBService) -> None:
    candles = service.query_candles("NVDA", timeframe="1m", limit=5)
    assert isinstance(candles, list) and len(candles) > 0
    assert candles[0]["high"] >= candles[0]["low"]


def test_service_dynamic_candles_daily_rth_only(service: DuckDBService) -> None:
    daily = service.query_candles("NVDA", timeframe="1d", limit=5)
    assert isinstance(daily, list) and len(daily) > 0
    candle = daily[0]
    assert candle["high"] >= candle["low"]

    reg = service.query_candles("NVDA", timeframe="1d", limit=5, session="REG")
    assert daily[0]["open"] == reg[0]["open"]
    assert daily[0]["close"] == reg[0]["close"]
    assert daily[0]["volume"] == reg[0]["volume"]


def test_service_candles_unknown_symbol_returns_empty(service: DuckDBService) -> None:
    assert service.query_candles("ZZZZ", timeframe="1m") == []
    assert service.query_ticks("ZZZZ", limit=5) == []


# --------------------------------------------------------------------------- #
# Sandbox-resident lake (integration)
# --------------------------------------------------------------------------- #

def test_service_against_sandbox_lake(session_lake: Path) -> None:
    svc = DuckDBService(lake_root=session_lake)
    status = svc.get_status()
    assert status["status"] == "ok"
    assert status["tick_lake"]["symbol_count"] == 5
    assert svc.query_candles("AAPL", timeframe="1m", limit=3)
    assert svc.query_tape("AAPL", limit=3)
