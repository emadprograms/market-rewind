import pytest
from backend.streaming_service.duckdb_client import DuckDBService


@pytest.fixture
def service():
    return DuckDBService()


def test_service_status(service):
    status = service.get_status()
    assert status["status"] == "ok"
    assert "streaming_db" in status
    assert "historical_db" in status
    assert status["streaming_db"]["exists"] is True


def test_service_get_symbols(service):
    symbols = service.get_symbols()
    assert isinstance(symbols, list)
    assert len(symbols) > 0
    top = symbols[0]
    assert "symbol" in top
    assert "tick_count" in top
    assert top["tick_count"] > 0
    assert "first_tick" in top
    assert "last_tick" in top


def test_service_symbol_summary(service):
    summary = service.get_symbol_summary("NVDA")
    assert summary is not None
    assert summary["symbol"] == "NVDA"
    assert summary["tick_count"] > 0
    assert summary["min_price"] <= summary["max_price"]
    assert "latest_quote" in summary
    assert summary["latest_quote"]["price"] > 0


def test_service_query_ticks(service):
    ticks = service.query_ticks("NVDA", limit=10, direction="asc")
    assert isinstance(ticks, list)
    assert len(ticks) == 10
    first = ticks[0]
    assert "time" in first
    assert "symbol" in first
    assert first["symbol"] == "NVDA"
    assert "price" in first
    assert "volume" in first


def test_service_dynamic_candles_subsecond(service):
    # Test 1s dynamic time_bucket candle query
    candles = service.query_candles("NVDA", timeframe="1s", limit=10)
    assert isinstance(candles, list)
    assert len(candles) > 0
    c = candles[0]
    assert "open" in c
    assert "high" in c
    assert "low" in c
    assert "close" in c
    assert "volume" in c
    assert "tick_count" in c
    assert c["high"] >= c["low"]


def test_service_dynamic_candles_minute(service):
    # Test 1m candle query
    candles = service.query_candles("NVDA", timeframe="1m", limit=5)
    assert isinstance(candles, list)
    assert len(candles) > 0
    c = candles[0]
    assert c["high"] >= c["low"]


def test_service_dynamic_candles_daily_rth_only(service):
    # Test 1d candle query strictly filters to RTH (REG session)
    daily_candles = service.query_candles("NVDA", timeframe="1d", limit=5)
    assert isinstance(daily_candles, list)
    assert len(daily_candles) > 0

    c = daily_candles[0]
    assert "open" in c
    assert "high" in c
    assert "low" in c
    assert "close" in c
    assert "volume" in c
    assert c["high"] >= c["low"]

    # Verify that default 1d query matches explicit session="REG"
    reg_candles = service.query_candles("NVDA", timeframe="1d", limit=5, session="REG")
    assert len(daily_candles) == len(reg_candles)
    assert daily_candles[0]["open"] == reg_candles[0]["open"]
    assert daily_candles[0]["close"] == reg_candles[0]["close"]
    assert daily_candles[0]["volume"] == reg_candles[0]["volume"]
