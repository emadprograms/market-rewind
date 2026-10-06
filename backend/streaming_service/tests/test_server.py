"""Phase 41 contract tests — HTTP REST + WebSocket endpoints on the tick lake.

Requirement: LAKE-API-03 (endpoint alignment, maintenance 503s, streaming playback).

Replaces the legacy suite (4/4 failing) with the same endpoint intent against the
Partitioned Parquet Tick Lake, plus the new tape/503 behavior from this phase.
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer

from tick_lake_factory import SANDBOX_LAKE_ROOT, build_mini_lake, mark_maintenance

from backend.streaming_service.server import create_app

LAKE: Path | None = None


def setup_module(module) -> None:  # pytest xunit-style hook
    """Ensure the sandbox-resident lake exists before the async test cases run."""
    global LAKE
    try:
        LAKE = SANDBOX_LAKE_ROOT
        if not (LAKE / "lake.json").exists():
            from tick_lake_factory import build_persistent_lake

            build_persistent_lake(LAKE)
    except OSError:  # pragma: no cover - read-only /home
        LAKE = None


class _ServerTest(unittest.IsolatedAsyncioTestCase):
    """Base class providing a running server bound to a specific lake root."""

    lake_root: Path | None = None

    async def asyncSetUp(self) -> None:
        if self.lake_root is None:
            self.skipTest("sandbox lake unavailable")
        self.client = TestClient(TestServer(create_app(lake_root=str(self.lake_root))))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        client = getattr(self, "client", None)
        if client is not None:
            await client.close()


class TestStreamingServer(_ServerTest):
    lake_root = None  # set in asyncSetUp via module-level LAKE

    async def asyncSetUp(self) -> None:
        self.lake_root = LAKE
        await super().asyncSetUp()

    # -- status / symbols ---------------------------------------------------- #

    async def test_get_status_endpoint(self) -> None:
        resp = await self.client.request("GET", "/api/status")
        assert resp.status == 200
        data = await resp.json()
        assert data["status"] == "ok"
        assert "streaming_db" in data
        assert data["streaming_db"]["exists"] is True
        assert "historical_db" not in data
        assert data["tick_lake"]["schema_version"] == 1

    async def test_get_symbols_endpoint(self) -> None:
        resp = await self.client.request("GET", "/api/symbols")
        assert resp.status == 200
        data = await resp.json()
        assert isinstance(data, list) and len(data) > 0
        assert {"symbol", "tick_count", "first_tick", "last_tick"} <= set(data[0])

    async def test_get_symbol_summary_endpoint(self) -> None:
        resp = await self.client.request("GET", "/api/symbols/NVDA")
        assert resp.status == 200
        data = await resp.json()
        assert data["symbol"] == "NVDA"
        assert data["latest_quote"]["price"] > 0

    async def test_get_symbol_summary_unknown_returns_404(self) -> None:
        resp = await self.client.request("GET", "/api/symbols/ZZZZ")
        assert resp.status == 404
        data = await resp.json()
        assert "error" in data

    async def test_encoded_symbol_endpoint(self) -> None:
        resp = await self.client.request("GET", "/api/symbols/BRK.B")
        assert resp.status == 200
        assert (await resp.json())["symbol"] == "BRK.B"

    # -- ticks / tape -------------------------------------------------------- #

    async def test_get_ticks_endpoint(self) -> None:
        resp = await self.client.request("GET", "/api/ticks?symbol=NVDA&limit=5")
        assert resp.status == 200
        data = await resp.json()
        assert isinstance(data, list)
        assert len(data) == 5
        assert data[0]["symbol"] == "NVDA"

    async def test_get_ticks_desc_returns_tape_with_spread(self) -> None:
        resp = await self.client.request("GET", "/api/ticks?symbol=NVDA&limit=5&direction=desc")
        assert resp.status == 200
        data = await resp.json()
        assert isinstance(data, list) and len(data) == 5
        times = [row["timestamp"] for row in data]
        assert times == sorted(times, reverse=True)
        assert all("spread" in row for row in data)

    async def test_get_ticks_desc_respects_time_bounds(self) -> None:
        """Re-verification defect A at the HTTP layer: bounds must narrow a desc tape."""
        full = await (await self.client.request("GET", "/api/ticks?symbol=NVDA&limit=200&direction=desc")).json()
        assert full
        newest = full[0]["timestamp"]
        bounded = await (
            await self.client.request(
                "GET",
                f"/api/ticks?symbol=NVDA&limit=200&direction=desc&start_time={newest}&end_time={newest}",
            )
        ).json()
        assert bounded, "a bound at the newest tick must still return that tick"
        assert all(row["timestamp"] == newest for row in bounded)
        assert len(bounded) < len(full)

    async def test_streaming_candles_alias_endpoint(self) -> None:
        """The React client's primary endpoint is /api/streaming/candles."""
        resp = await self.client.request(
            "GET", "/api/streaming/candles?symbol=NVDA&tf=1m&limit=3&start=2026-10-02&end=2026-10-03&session=REG"
        )
        assert resp.status == 200
        data = await resp.json()
        assert isinstance(data, list) and len(data) == 3
        assert {"time", "open", "high", "low", "close", "volume"} <= set(data[0])

    async def test_encoded_slash_symbol_endpoint(self) -> None:
        """`EUR/USD` is reachable via its percent-encoded form (what the client sends)."""
        resp = await self.client.request("GET", "/api/symbols/EUR%2FUSD")
        assert resp.status == 200
        assert (await resp.json())["symbol"] == "EUR/USD"

    async def test_get_ticks_missing_symbol_returns_400(self) -> None:
        resp = await self.client.request("GET", "/api/ticks")
        assert resp.status == 400

    async def test_get_ticks_bad_limit_returns_400(self) -> None:
        resp = await self.client.request("GET", "/api/ticks?symbol=NVDA&limit=abc")
        assert resp.status == 400

    # -- candles ------------------------------------------------------------- #

    async def test_get_candles_endpoint(self) -> None:
        resp = await self.client.request("GET", "/api/candles?symbol=NVDA&timeframe=1s&limit=5")
        assert resp.status == 200
        data = await resp.json()
        assert isinstance(data, list) and len(data) > 0
        assert "open" in data[0] and "close" in data[0]

    async def test_get_candles_daily_matches_reg_session(self) -> None:
        implicit = await (await self.client.request("GET", "/api/candles?symbol=NVDA&timeframe=1d")).json()
        explicit = await (
            await self.client.request("GET", "/api/candles?symbol=NVDA&timeframe=1d&session=REG")
        ).json()
        assert implicit and explicit
        assert [c["volume"] for c in implicit] == [c["volume"] for c in explicit]

    async def test_get_candles_missing_symbol_returns_400(self) -> None:
        resp = await self.client.request("GET", "/api/candles")
        assert resp.status == 400

    async def test_unknown_symbol_candles_returns_empty_list(self) -> None:
        resp = await self.client.request("GET", "/api/candles?symbol=ZZZZ&timeframe=1m")
        assert resp.status == 200
        assert await resp.json() == []

    # -- websocket ----------------------------------------------------------- #

    async def test_websocket_load_and_step(self) -> None:
        ws = await self.client.ws_connect("/ws/replay")
        try:
            await ws.send_json({"action": "load", "symbol": "NVDA", "limit": 100})
            status = await ws.receive_json()
            assert status["type"] == "status"
            assert status["symbol"] == "NVDA"
            assert status["totalBuffered"] > 0

            await ws.send_json({"action": "step"})
            message = await ws.receive_json()
            assert message["type"] in {"tick", "status"}
            assert message["type"] == "tick"
            assert message["tick"]["symbol"] == "NVDA"
        finally:
            await ws.close()

    async def test_websocket_playback_alias(self) -> None:
        ws = await self.client.ws_connect("/ws/playback")
        try:
            await ws.send_json({"action": "load", "symbol": "AAPL", "limit": 50})
            status = await ws.receive_json()
            assert status["type"] == "status" and status["totalBuffered"] > 0
        finally:
            await ws.close()


class TestMaintenanceAndFailureModes(unittest.IsolatedAsyncioTestCase):
    """503 handling for maintenance and unavailable lakes."""

    async def asyncSetUp(self) -> None:
        import tempfile

        self._tmp = tempfile.TemporaryDirectory()
        self.lake = build_mini_lake(Path(self._tmp.name) / "lake")

    async def asyncTearDown(self) -> None:
        self._tmp.cleanup()

    async def test_maintenance_returns_503_with_retry_after(self) -> None:
        mark_maintenance(self.lake)
        client = TestClient(TestServer(create_app(lake_root=str(self.lake))))
        await client.start_server()
        try:
            for url in ("/api/status", "/api/symbols", "/api/ticks?symbol=AAPL&limit=5",
                        "/api/candles?symbol=AAPL&timeframe=1m"):
                resp = await client.request("GET", url)
                assert resp.status == 503, url
                data = await resp.json()
                assert data["error"] == "Lake maintenance in progress"
                assert data["retry_after"] == 5
        finally:
            await client.close()

    async def test_unavailable_lake_returns_503(self) -> None:
        client = TestClient(TestServer(create_app(lake_root=str(self.lake / "missing"))))
        await client.start_server()
        try:
            resp = await client.request("GET", "/api/symbols")
            assert resp.status == 503
            data = await resp.json()
            assert data["error"] == "Tick lake unavailable"
        finally:
            await client.close()
