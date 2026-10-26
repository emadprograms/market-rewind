"""Regression: backend daily (1d) candles must enforce RTH by wall-clock.

Real-lake failure (human-verified, TSLA 2026-10-22): the data-harvester stores
every Capital.com tick with ``session='REG'`` regardless of actual session, so
the label-only ``WHERE session='REG'`` filter passes all 70,920 ticks from
04:00-20:00 ET and the 1d endpoint returns a 16-hour "daily" candle
(O366.93/L364.95/C373.20/V70920 instead of RTH O374.05/L373.53/C374.51/V56002).

The durable fix cannot trust labels: daily aggregation for America/New_York
session symbols must apply a 09:30 <= ET < 16:00 wall-clock predicate. UTC
instruments (forex/crypto) trade around the clock and skip the gate.

Written test-first (red): before the fix every equity test below fails because
the current endpoint aggregates the full 04:00-20:00 ET span.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

from tick_lake_factory import build_mini_lake, rows_v1, write_rows_as

from backend.streaming_service.tick_lake_reader import TickLakeReader

DAY = "2026-10-22"  # EDT (UTC-4): RTH is 13:30Z..20:00Z, half-open interval
WINTER_DAY = "2026-11-15"  # EST (UTC-5): RTH is 14:30Z..21:00Z


def _write(tmp_path: Path, symbol: str, day: str, entries: List[Dict[str, Any]]) -> Path:
    lake = build_mini_lake(tmp_path / f"lake-{symbol.replace('/', '_')}", symbols={})
    write_rows_as(lake, symbol, day, rows_v1(symbol, entries))
    return lake


def _half_hour_span(day: str, start_hms: str, end_hms: str, session: str = "REG") -> List[Dict[str, Any]]:
    """Ticks every 30 minutes across a UTC span, all carrying one session label."""
    start = datetime.fromisoformat(f"{day}T{start_hms}")
    end = datetime.fromisoformat(f"{day}T{end_hms}")
    entries: List[Dict[str, Any]] = []
    t = start
    i = 0
    while t <= end:
        entries.append(
            {
                "timestamp": t,
                "price": 100.0 + i,
                "volume": 10.0,
                "session": session,
                "ingest_id": f"t{i:03d}",
            }
        )
        t += timedelta(minutes=30)
        i += 1
    return entries


def test_all_reg_equity_lake_daily_candle_is_rth_wall_clock_only(tmp_path: Path) -> None:
    """The TSLA scenario: every tick mislabeled REG across 04:00-19:59 ET."""
    entries = _half_hour_span(DAY, "08:00:00", "23:30:00", session="REG")
    lake = _write(tmp_path, "TSLA", DAY, entries)
    reader = TickLakeReader(lake)

    candles = reader.query_candles("TSLA", timeframe="1d", start_time=DAY, end_time=f"{DAY} 23:59:59")
    assert len(candles) == 1
    daily = candles[0]

    # RTH ticks only: 13:30Z (09:30 ET) through 19:30Z (15:30 ET), 30-min grid.
    rth_entries = [e for e in entries if datetime.fromisoformat(f"{DAY}T13:30:00")
                   <= e["timestamp"] < datetime.fromisoformat(f"{DAY}T20:00:00")]
    assert len(rth_entries) == 13  # sanity: the gate has something to exclude
    prices = [e["price"] for e in rth_entries]
    assert daily["open"] == prices[0]
    assert daily["high"] == max(prices)
    assert daily["low"] == min(prices)
    assert daily["close"] == prices[-1]
    assert daily["volume"] == sum(e["volume"] for e in rth_entries)
    # The 04:00 ET premarket open must not be the daily open.
    assert daily["open"] != entries[0]["price"]
    assert daily["volume"] < sum(e["volume"] for e in entries)


def test_wall_clock_gate_respects_winter_dst_window(tmp_path: Path) -> None:
    """EST day: 14:29Z (09:29 ET) excluded, 14:30Z (09:30 ET) included."""
    entries = [
        {"timestamp": datetime.fromisoformat(f"{WINTER_DAY}T14:29:00"), "price": 10.0,
         "volume": 100.0, "session": "REG", "ingest_id": "a"},
        {"timestamp": datetime.fromisoformat(f"{WINTER_DAY}T14:30:00"), "price": 20.0,
         "volume": 5.0, "session": "REG", "ingest_id": "b"},
        {"timestamp": datetime.fromisoformat(f"{WINTER_DAY}T20:00:00"), "price": 30.0,
         "volume": 7.0, "session": "REG", "ingest_id": "c"},
    ]
    lake = _write(tmp_path, "TSLA", WINTER_DAY, entries)
    reader = TickLakeReader(lake)

    daily = reader.query_candles(
        "TSLA", timeframe="1d", start_time=WINTER_DAY, end_time=f"{WINTER_DAY} 23:59:59"
    )[0]
    assert daily["open"] == 20.0
    assert daily["close"] == 30.0
    assert daily["volume"] == 12.0


def test_utc_instrument_daily_candle_keeps_the_full_day(tmp_path: Path) -> None:
    """Forex/crypto symbols trade 24/7 — the equity wall-clock gate must not apply."""
    entries = _half_hour_span(DAY, "08:00:00", "23:30:00", session="REG")
    lake = _write(tmp_path, "EUR/USD", DAY, entries)
    reader = TickLakeReader(lake)

    daily = reader.query_candles(
        "EUR/USD", timeframe="1d", start_time=DAY, end_time=f"{DAY} 23:59:59"
    )[0]
    prices = [e["price"] for e in entries]
    assert daily["open"] == prices[0]
    assert daily["close"] == prices[-1]
    assert daily["volume"] == sum(e["volume"] for e in entries)


def test_truthful_labels_and_mislabeled_lake_produce_identical_daily_candles(
    tmp_path: Path,
) -> None:
    """Metamorphic check: the wall-clock gate makes label quality irrelevant."""
    span = _half_hour_span(DAY, "08:00:00", "23:30:00")

    truthful: List[Dict[str, Any]] = []
    for e in span:
        et_hour = e["timestamp"].hour - 4  # EDT offset for this date
        is_rth = (et_hour == 9 and e["timestamp"].minute >= 30) or 10 <= et_hour <= 15
        session = "REG" if is_rth else ("PRE" if et_hour < 9 or (et_hour == 9) else "POST")
        truthful.append({**e, "session": session})

    lake_truth = _write(tmp_path, "TSLA", DAY, truthful)
    mislabeled = [{**e, "session": "REG"} for e in span]
    lake_mis = _write(tmp_path, "TSLA2", DAY, mislabeled)

    a = TickLakeReader(lake_truth).query_candles(
        "TSLA", timeframe="1d", start_time=DAY, end_time=f"{DAY} 23:59:59"
    )[0]
    b = TickLakeReader(lake_mis).query_candles(
        "TSLA2", timeframe="1d", start_time=DAY, end_time=f"{DAY} 23:59:59"
    )[0]
    for key in ("open", "high", "low", "close", "volume"):
        assert a[key] == b[key]


def test_explicit_session_all_opt_out_returns_full_day(tmp_path: Path) -> None:
    """session='ALL' remains a true opt-out: no label filter and no time gate."""
    entries = _half_hour_span(DAY, "08:00:00", "23:30:00", session="REG")
    lake = _write(tmp_path, "TSLA", DAY, entries)
    reader = TickLakeReader(lake)

    daily = reader.query_candles(
        "TSLA", timeframe="1d", start_time=DAY, end_time=f"{DAY} 23:59:59", session="ALL"
    )[0]
    prices = [e["price"] for e in entries]
    assert daily["open"] == prices[0]
    assert daily["close"] == prices[-1]
    assert daily["volume"] == sum(e["volume"] for e in entries)


def test_crypto_ticker_daily_candle_keeps_the_full_day(tmp_path: Path) -> None:
    """Known crypto tickers classify as UTC even without a '/' or 'USD' substring."""
    entries = _half_hour_span(DAY, "08:00:00", "23:30:00", session="REG")
    lake = _write(tmp_path, "BTC", DAY, entries)
    reader = TickLakeReader(lake)

    daily = reader.query_candles(
        "BTC", timeframe="1d", start_time=DAY, end_time=f"{DAY} 23:59:59"
    )[0]
    assert daily["volume"] == sum(e["volume"] for e in entries)
