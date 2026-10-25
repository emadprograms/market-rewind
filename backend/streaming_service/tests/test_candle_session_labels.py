"""Regression: candle rows must carry a truthful per-bucket session label.

Root cause (see .planning/debug/daily-1d-rth-session-leak.md):
``TickLakeReader.query_candles`` grouped ticks into OHLCV buckets but never
selected the ``session`` column, while ``query_ticks`` did. The client therefore
received sessionless 1-minute candles and defaulted every row to ``REG``, which
let pre/post-market bars leak into the live 1D daily candle (LAKE-RESAMPLE-04
RTH isolation was enforced server-side only for the ``1d`` timeframe).

Written test-first (red): before the fix candle dicts have no ``session`` key.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from tick_lake_factory import build_mini_lake, rows_v1, write_rows_as

from backend.streaming_service.tick_lake_reader import TickLakeReader

DAY = "2026-10-02"


def _lake_with_sessions(tmp_path: Path) -> Path:
    lake = build_mini_lake(tmp_path / "lake", symbols={})
    rows = rows_v1(
        "SPY",
        [
            {"timestamp": datetime.fromisoformat(f"{DAY}T12:00:00"), "price": 10.0,
             "volume": 100.0, "session": "PRE", "ingest_id": "p1"},
            {"timestamp": datetime.fromisoformat(f"{DAY}T13:30:00"), "price": 100.0,
             "volume": 1.0, "session": "REG", "ingest_id": "r1"},
            {"timestamp": datetime.fromisoformat(f"{DAY}T13:31:00"), "price": 110.0,
             "volume": 2.0, "session": "REG", "ingest_id": "r2"},
            {"timestamp": datetime.fromisoformat(f"{DAY}T20:30:00"), "price": 5.0,
             "volume": 999.0, "session": "POST", "ingest_id": "q1"},
        ],
    )
    write_rows_as(lake, "SPY", DAY, rows)
    return lake


def test_one_minute_candles_carry_truthful_session(tmp_path: Path) -> None:
    reader = TickLakeReader(_lake_with_sessions(tmp_path))
    candles = reader.query_candles(
        "SPY", timeframe="1m", start_time=DAY, end_time=f"{DAY} 23:59:59"
    )

    assert len(candles) == 4
    by_time = {c["time"]: c for c in candles}
    assert by_time[f"{DAY}T12:00:00"]["session"] == "PRE"
    assert by_time[f"{DAY}T13:30:00"]["session"] == "REG"
    assert by_time[f"{DAY}T13:31:00"]["session"] == "REG"
    assert by_time[f"{DAY}T20:30:00"]["session"] == "POST"
    # OHLCV contract keys remain intact alongside the new label.
    for candle in candles:
        assert set(
            ["time", "symbol", "open", "high", "low", "close", "volume", "tick_count", "session"]
        ).issubset(candle.keys())


def test_mixed_session_bucket_reports_deterministic_composite_label(tmp_path: Path) -> None:
    """A 1-hour bucket spanning the 09:30 ET open contains PRE and REG ticks."""
    lake = build_mini_lake(tmp_path / "lake", symbols={})
    rows = rows_v1(
        "SPY",
        [
            {"timestamp": datetime.fromisoformat(f"{DAY}T13:00:00"), "price": 90.0,
             "volume": 7.0, "session": "PRE", "ingest_id": "a"},
            {"timestamp": datetime.fromisoformat(f"{DAY}T13:45:00"), "price": 95.0,
             "volume": 3.0, "session": "REG", "ingest_id": "b"},
        ],
    )
    write_rows_as(lake, "SPY", DAY, rows)

    reader = TickLakeReader(lake)
    candles = reader.query_candles(
        "SPY", timeframe="1h", start_time=DAY, end_time=f"{DAY} 23:59:59"
    )
    assert len(candles) == 1
    # Sorted, comma-joined distinct sessions — same composite convention the
    # frontend isRthBar parser already understands ("PRE, REG" contains REG).
    assert candles[0]["session"] == "PRE, REG"


def test_daily_candles_remain_reg_filtered_and_labeled(tmp_path: Path) -> None:
    reader = TickLakeReader(_lake_with_sessions(tmp_path))
    candles = reader.query_candles(
        "SPY", timeframe="1d", start_time=DAY, end_time=f"{DAY} 23:59:59"
    )
    assert len(candles) == 1
    daily = candles[0]
    assert daily["session"] == "REG"
    # RTH-only values: the two REG ticks (volumes 1 + 2), PRE/POST excluded.
    assert daily["volume"] == 3.0
    assert daily["open"] == 100.0
    assert daily["close"] == 110.0
