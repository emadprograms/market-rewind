"""Phase 41 contract tests — HTTP REST + WebSocket endpoints on the tick lake.

Requirement: LAKE-API-03 (endpoint alignment, maintenance 503s, streaming playback).

Replaces the legacy suite (4/4 failing) with the same endpoint intent against the
Partitioned Parquet Tick Lake, plus the new tape/503 behavior from this phase.
"""
from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta
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


class TestReplaySessionLifecycle(unittest.IsolatedAsyncioTestCase):
    """Internal lifecycle guarantees the wire protocol cannot expose.

    Pausing flips ``is_playing`` (observable as frames) *and* must cancel the
    sleeping playback task. The frame-level test cannot see the difference, so
    the task is inspected directly: otherwise every pause leaks a task that
    stays parked in its inter-tick sleep.
    """

    class _FakeWs:
        def __init__(self) -> None:
            self.frames = []

        async def send_str(self, payload: str) -> None:
            self.frames.append(json.loads(payload))

    class _StubDb:
        """Five ticks five seconds apart → the loop sleeps ~3s between them."""

        def query_ticks(self, *, symbol, start_time, limit, direction):  # noqa: ARG002
            base = datetime.fromisoformat("2026-10-02T13:30:00")
            return [
                {
                    "time": (base + timedelta(seconds=5 * i)).isoformat(),
                    "symbol": symbol,
                    "price": 100.0 + i,
                    "volume": 1.0,
                    "session": "REG",
                    "source": "CAPITAL",
                    "ingest_id": f"stub_{i}",
                }
                for i in range(5)
            ]

    async def test_pause_cancels_the_play_task(self) -> None:
        import asyncio

        from backend.streaming_service.server import ReplaySession

        session = ReplaySession(self._FakeWs(), self._StubDb())
        await session.load_ticks("NVDA", None, 5)

        await session.set_playing(True)
        task = session.play_task
        assert task is not None
        await asyncio.sleep(0)          # let the loop start and begin its sleep
        assert not task.done(), "playback should still be running"

        await session.set_playing(False)
        for _ in range(100):            # cancellation settles within a few ticks
            await asyncio.sleep(0.01)
            if task.done():
                break
        # play_loop swallows CancelledError by design, so the observable guarantee
        # is that the task is finished — not that asyncio reports it as cancelled.
        assert task.done(), "pause leaked a live playback task"

    async def test_play_then_completion_marks_not_playing(self) -> None:
        import asyncio

        from backend.streaming_service.server import ReplaySession

        session = ReplaySession(self._FakeWs(), self._StubDb())
        await session.load_ticks("NVDA", None, 3)
        session.speed = 100000  # no per-tick sleep
        await session.set_playing(True)
        task = session.play_task
        for _ in range(200):
            await asyncio.sleep(0.01)
            if task.done():
                break
        assert task.done()
        assert session.is_playing is False
        assert session.current_index == len(session.ticks_buffer) - 1  # last tick


class TestCorruptLakeSurface(unittest.IsolatedAsyncioTestCase):
    """A corrupt lake.json must surface as a 503 with the metadata payload.

    The reader raises a structured error; the HTTP layer must translate it rather
    than 500 or silently returning empty data (contract §6.1).
    """

    async def asyncSetUp(self) -> None:
        import tempfile

        from tick_lake_factory import corrupt_lake_json

        self._tmp = tempfile.TemporaryDirectory()
        self.lake = Path(self._tmp.name) / "lake"
        corrupt_lake_json(self.lake)
        self.client = TestClient(TestServer(create_app(lake_root=str(self.lake))))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()
        self._tmp.cleanup()

    async def test_every_data_endpoint_fails_fast_with_503(self) -> None:
        """A corrupt lake must never look healthy.

        `ensure_ready()` fails fast, so even /api/status answers 503 (not 200 with an
        empty payload) and every endpoint carries the same retry-hint payload shape.
        """
        for url in ("/api/status", "/api/symbols", "/api/ticks?symbol=AAPL", "/api/candles?symbol=AAPL"):
            resp = await self.client.request("GET", url)
            assert resp.status == 503, url
            payload = await resp.json()
            assert "error" in payload, url
            assert payload.get("retry_after") in {5, 10, 30}, url
            assert resp.headers["Content-Type"].startswith("application/json")

    async def test_metadata_payload_names_the_condition(self) -> None:
        resp = await self.client.request("GET", "/api/symbols")
        payload = await resp.json()
        assert "metadata" in payload["error"].lower()


class TestReplayTransport(unittest.IsolatedAsyncioTestCase):
    """The WebSocket replay transport the frontend drives (LAKE-API-03).

    The app's play/pause/seek/speed controls are the reason the lake is streamed
    over WebSocket at all, so every action is exercised against real lake ticks:

    * ``play`` streams tick frames in index order and reports completion
    * ``pause`` stops an in-flight playback (nothing arrives afterwards)
    * ``seek`` jumps the cursor to the requested timestamp
    * ``set_speed`` clamps and is reported back in the status frame
    * ``step`` moves backwards as well as forwards
    * malformed actions surface an ``error`` frame instead of killing the socket
    """

    #: Paced tape (5s between ticks) so the transport's real-time pacing is
    #: observable: at the 0.1× clamp floor the play loop sleeps 30s per tick,
    #: which makes "pause really stops playback" deterministic instead of a race
    #: against a sub-second tape that streams with zero delay.
    TICK_COUNT = 60
    TICK_SPACING = timedelta(seconds=5)

    async def asyncSetUp(self) -> None:
        import tempfile

        from tick_lake_factory import rows_v1, write_rows_as

        self._tmp = tempfile.TemporaryDirectory()
        self.lake = build_mini_lake(Path(self._tmp.name) / "lake", symbols={})
        base = datetime.fromisoformat("2026-10-02T13:30:00")
        entries = [
            {
                "timestamp": base + i * self.TICK_SPACING,
                "price": round(100.0 + (i % 7) * 0.25, 4),
                "volume": 1.0 + (i % 5),
                "session": "REG",
                "ingest_id": f"paced_{i:04d}",
            }
            for i in range(self.TICK_COUNT)
        ]
        write_rows_as(self.lake, "NVDA", "2026-10-02", rows_v1("NVDA", entries), filename="paced_000001.parquet")
        self.client = TestClient(TestServer(create_app(lake_root=str(self.lake))))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()
        self._tmp.cleanup()

    async def _load(self, ws, *, symbol: str = "NVDA", limit: int = 200) -> dict:
        await ws.send_json({"action": "load", "symbol": symbol, "limit": limit})
        status = await ws.receive_json()
        assert status["type"] == "status"
        assert status["totalBuffered"] > 0
        return status

    async def _receive_until(self, ws, predicate, *, label: str, timeout: float = 5.0):
        """Read frames until `predicate(frame)` holds.

        Frames are dispatched by type (like the frontend does), never by position:
        ``play``/``step`` legitimately interleave ``tick`` and ``status`` frames.
        """
        import asyncio

        seen = []
        async with asyncio.timeout(timeout):
            while True:
                frame = await ws.receive_json()
                seen.append(frame)
                if predicate(frame):
                    return frame, seen

    async def test_play_streams_ticks_in_order_then_reports_completion(self) -> None:
        ws = await self.client.ws_connect("/ws/replay")
        try:
            await self._load(ws, limit=12)
            await ws.send_json({"action": "set_speed", "speed": 100000})  # → no per-tick sleep
            await self._receive_until(ws, lambda f: f["type"] == "status" and f["speed"] == 100000, label="speed")

            await ws.send_json({"action": "play"})
            final, seen = await self._receive_until(
                ws, lambda f: f["type"] == "status" and f["playing"] is False, label="completion"
            )

            playing_status = next(f for f in seen if f["type"] == "status" and f["playing"] is True)
            assert playing_status["totalBuffered"] == 12

            ticks = [f for f in seen if f["type"] == "tick"]
            assert [t["index"] for t in ticks] == list(range(1, 12))
            times = [t["tick"]["time"] for t in ticks]
            assert times == sorted(times)  # strictly forward in market time
            assert [t["tick"]["symbol"] for t in ticks] == ["NVDA"] * 11
            assert final["currentIndex"] == 11
        finally:
            await ws.close()

    async def test_pause_stops_playback(self) -> None:
        import asyncio

        ws = await self.client.ws_connect("/ws/replay")
        try:
            await self._load(ws, limit=20)
            # 0.1× is the clamp floor: the loop then sleeps ~30s between ticks on
            # this lake, so anything arriving after pause is a real regression.
            await ws.send_json({"action": "set_speed", "speed": 0.1})
            await self._receive_until(ws, lambda f: f["type"] == "status" and f["speed"] == 0.1, label="speed")

            await ws.send_json({"action": "play"})
            started, _ = await self._receive_until(
                ws, lambda f: f["type"] == "status" and f["playing"] is True, label="started"
            )
            assert started["speed"] == 0.1
            first_tick, _ = await self._receive_until(ws, lambda f: f["type"] == "tick", label="first tick")
            assert first_tick["index"] == 1  # one tick, then a 30s sleep

            await ws.send_json({"action": "pause"})
            paused, _ = await self._receive_until(
                ws, lambda f: f["type"] == "status" and f["playing"] is False, label="paused"
            )
            assert paused["currentIndex"] == 1  # 30s sleep per tick → exactly one

            # Nothing may arrive after the paused status frame.
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.receive_json(), timeout=1.0)
        finally:
            await ws.close()

    async def test_seek_moves_the_cursor_to_the_requested_time(self) -> None:
        ws = await self.client.ws_connect("/ws/replay")
        try:
            await self._load(ws, limit=200)

            resp = await self.client.request("GET", "/api/ticks?symbol=NVDA&limit=200")
            ticks = await resp.json()
            target = ticks[30]["time"]

            await ws.send_json({"action": "seek", "timestamp": target})
            frame, seen = await self._receive_until(ws, lambda f: f["type"] == "tick", label="seek tick")
            assert frame["seek"] is True
            assert frame["index"] == 30
            assert frame["tick"]["time"] == target

            status, _ = await self._receive_until(ws, lambda f: f["type"] == "status", label="seek status")
            assert status["currentIndex"] == 30
            assert status["currentTime"] == target
        finally:
            await ws.close()

    async def test_set_speed_clamps_and_is_reported(self) -> None:
        ws = await self.client.ws_connect("/ws/replay")
        try:
            await self._load(ws, limit=10)

            await ws.send_json({"action": "set_speed", "speed": -5})
            assert (await ws.receive_json())["speed"] == 0.1  # clamped floor

            await ws.send_json({"action": "set_speed", "speed": 2.5})
            assert (await ws.receive_json())["speed"] == 2.5
        finally:
            await ws.close()

    async def test_step_backward_after_forward(self) -> None:
        ws = await self.client.ws_connect("/ws/replay")
        try:
            await self._load(ws, limit=50)

            await ws.send_json({"action": "step"})
            forward, _ = await self._receive_until(ws, lambda f: f["type"] == "tick", label="forward")
            assert forward["index"] == 1
            # step always follows the tick with a status frame (the frontend relies
            # on it to resync the scrubber).
            synced, _ = await self._receive_until(ws, lambda f: f["type"] == "status", label="status")
            assert synced["currentIndex"] == 1

            await ws.send_json({"action": "step", "direction": "backward"})
            backward, _ = await self._receive_until(ws, lambda f: f["type"] == "tick", label="backward")
            assert backward["index"] == 0
            assert backward["backward"] is True

            resynced, _ = await self._receive_until(ws, lambda f: f["type"] == "status", label="status")
            assert resynced["currentIndex"] == 0
        finally:
            await ws.close()

    async def test_malformed_action_yields_error_frame_and_keeps_socket_alive(self) -> None:
        ws = await self.client.ws_connect("/ws/replay")
        try:
            await self._load(ws, limit=10)

            await ws.send_json({"action": "set_speed", "speed": "not-a-number"})
            error = await ws.receive_json()
            assert error["type"] == "error"
            assert "could not convert" in error["message"]

            # The socket must survive: the next valid action still works.
            await ws.send_json({"action": "step"})
            assert (await ws.receive_json())["type"] == "tick"
        finally:
            await ws.close()

    async def test_actions_before_load_are_noops_and_session_stays_usable(self) -> None:
        """seek/step on an empty buffer answer nothing (and must not crash).

        The reader is fail-fast: with no tape buffered there is nothing to seek or
        step to, so the server stays silent and the next load must work normally.
        """
        import asyncio

        ws = await self.client.ws_connect("/ws/replay")
        try:
            await ws.send_json({"action": "seek", "timestamp": "2026-10-02T13:31:00"})
            await ws.send_json({"action": "step"})
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.receive_json(), timeout=0.3)

            status = await self._load(ws, limit=10)  # session still healthy
            assert status["totalBuffered"] == 10
        finally:
            await ws.close()

    async def test_options_preflight_returns_cors_headers(self) -> None:
        resp = await self.client.request("OPTIONS", "/api/status")
        assert resp.status == 204
        assert resp.headers["Access-Control-Allow-Origin"] == "*"
        assert "GET" in resp.headers["Access-Control-Allow-Methods"]

    async def test_non_integer_candle_limit_is_rejected(self) -> None:
        resp = await self.client.request("GET", "/api/candles?symbol=NVDA&limit=abc")
        assert resp.status == 400
        assert "integer" in (await resp.json())["error"]

    async def test_negative_offset_and_candle_limit_are_rejected(self) -> None:
        resp = await self.client.request("GET", "/api/ticks?symbol=NVDA&offset=-1")
        assert resp.status == 400

        resp = await self.client.request("GET", "/api/candles?symbol=NVDA&limit=-5")
        assert resp.status == 400


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
