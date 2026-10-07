"""RED-GREEN budget tests — boot-path and transfer cost of the streaming service.

Covers three report findings that are only observable at the HTTP/service boundary:

  * C1 — ``/api/symbols`` must not run the full-lake aggregation on the boot path.
  * C2 — large responses must be compressed; tick payloads otherwise cross Wi-Fi raw.
  * M2 — the names-only reader path must be dramatically cheaper than full stats.

Oracle classification: **derived**. Assertions derive from an independent cost budget
(the boot path must not need a data scan; a 12 MB payload must not travel raw) rather
than from the current implementation's output. Each test names the mechanism it pins, so
a passing suite means the mechanism holds — not merely that output is unchanged.

Async convention: ``unittest.IsolatedAsyncioTestCase`` (stdlib), matching
``test_server.py``. This deliberately avoids ``pytest-asyncio``: the repo ships no
Python dependency manifest and the documented ``npm run backend:test`` command uses a
venv owned by a sibling repository, so a plugin-dependent suite fails on a clean
environment. Async tests here must run under a bare ``pytest`` install.
"""
from __future__ import annotations

import gzip
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import pytest
from aiohttp.test_utils import TestClient, TestServer

from tick_lake_factory import build_mini_lake

from backend.streaming_service.server import create_app
from backend.streaming_service.tick_lake_reader import TickLakeReader


def _explode_symbol_stats(self, symbol=None):  # noqa: ANN001 - mirrors the real signature
    raise AssertionError(
        "symbol_stats() (full-lake aggregation) must not run on the boot path; "
        "the startup inventory discards per-symbol stats."
    )


class _ServerTestCase(unittest.IsolatedAsyncioTestCase):
    """Hermetic lake + running server per test, with no pytest plugin requirements."""

    async def asyncSetUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.lake = build_mini_lake(Path(self._tmp.name) / "tick_lake")
        self.client = TestClient(TestServer(create_app(lake_root=str(self.lake))))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()
        self._tmp.cleanup()


# --------------------------------------------------------------------------- C1 -- #


class TestBootSymbolsPath(_ServerTestCase):
    async def test_boot_symbols_path_does_not_run_full_lake_aggregation(self) -> None:
        """The boot path must resolve symbol names without aggregating tick data.

        Oracle: make the full aggregation impossible (raise), then require the *boot path*
        request to still succeed. Any implementation that depends on scanning Parquet data
        fails; any implementation that resolves names from the lake layout passes — the
        test does not prescribe how.
        """
        with mock.patch.object(TickLakeReader, "symbol_stats", _explode_symbol_stats):
            for url in ("/api/symbols?names_only=1", "/api/streaming/symbols?names_only=1"):
                resp = await self.client.request("GET", url)
                assert resp.status == 200, f"{url}: {await resp.text()}"
                payload = await resp.json()
                assert isinstance(payload, list) and payload, f"{url} must return a non-empty list"

    async def test_default_symbols_response_still_carries_stats(self) -> None:
        """Backward compatibility: omitting ``names_only`` keeps the aggregate contract."""
        resp = await self.client.request("GET", "/api/symbols")
        assert resp.status == 200
        payload = await resp.json()

        assert payload, "default symbols response must not be empty"
        assert {"symbol", "tick_count", "first_tick", "last_tick"} <= set(payload[0])

    async def test_boot_symbols_path_returns_every_lake_symbol(self) -> None:
        """Correctness guard: the fast path must not drop or invent symbols."""
        expected = TickLakeReader(self.lake).list_symbols()

        resp = await self.client.request("GET", "/api/symbols?names_only=1")
        assert resp.status == 200
        payload = await resp.json()

        def _name(item):  # handles both ["SPY"] and [{"symbol": "SPY"}]
            return item if isinstance(item, str) else item.get("symbol")

        got = sorted(n for n in (_name(i) for i in payload) if n)
        assert got == sorted(expected), f"expected {sorted(expected)}, got {got}"
        # Percent-encoded partition names must survive decoding.
        assert any("." in s or "/" in s for s in got), "encoded symbols (e.g. BRK.B) must round-trip"


# --------------------------------------------------------------------------- C2 -- #


class TestResponseCompression(_ServerTestCase):
    async def test_large_response_is_compressed(self) -> None:
        """A large JSON payload must be gzip-encoded when the client offers it.

        Oracle: compare the bytes actually *on the wire* against the identity form. Note
        ``auto_decompress=False`` — aiohttp's client transparently decompresses otherwise,
        which would make a correct fix look like a failure by hiding the saving.
        """
        url = "/api/ticks?symbol=AAPL&limit=50000"

        zipped = await self.client.request(
            "GET", url,
            headers={"Accept-Encoding": "gzip"},
            auto_decompress=False,
        )
        assert zipped.status == 200, await zipped.text()
        encoding = zipped.headers.get("Content-Encoding", "")
        wire_bytes = await zipped.read()
        content_length = zipped.headers.get("Content-Length")
        accept_encoding_vary = zipped.headers.get("Vary", "")
        cors = zipped.headers.get("Access-Control-Allow-Origin")

        identity = await self.client.request("GET", url, headers={"Accept-Encoding": "identity"})
        identity_bytes = await identity.read()

        if len(identity_bytes) < 256:
            self.skipTest("lake too small for compression thresholds to apply")

        assert "gzip" in encoding.lower(), (
            f"large response was not compressed (Content-Encoding={encoding!r}, "
            f"{len(wire_bytes)} bytes sent). Tick payloads must be gzip-encoded."
        )
        assert len(wire_bytes) < len(identity_bytes), (
            f"compressed body ({len(wire_bytes)}B) not smaller than identity "
            f"({len(identity_bytes)}B)"
        )
        # The decompressed body must still be the same JSON document.
        assert json.loads(gzip.decompress(wire_bytes).decode("utf-8")) == json.loads(
            identity_bytes.decode("utf-8")
        )
        if content_length is not None:
            assert int(content_length) == len(wire_bytes), (
                "Content-Length must describe the sent bytes"
            )
        assert "accept-encoding" in accept_encoding_vary.lower(), (
            "a response that varies by Accept-Encoding must advertise it in Vary"
        )
        # Regression guard: compression wraps CORS, so CORS headers must survive.
        assert cors == "*", f"CORS header lost when compressing (got {cors!r})"

    async def test_small_response_is_not_compressed(self) -> None:
        """Below the threshold, gzip cost exceeds the saving, so bodies stay identity."""
        resp = await self.client.request(
            "GET", "/api/status",
            headers={"Accept-Encoding": "gzip"},
            auto_decompress=False,
        )
        assert resp.status == 200
        body = await resp.read()

        if len(body) >= 1024:
            self.skipTest("status payload exceeds the compression threshold in this fixture")
        assert not resp.headers.get("Content-Encoding"), "small payloads should not be compressed"


# -------------------------------------------------------------------------- M2 -- #


def test_names_only_resolution_is_cheaper_than_aggregation(mini_lake: Path) -> None:
    """Enumerating symbols must not scale with tick volume; aggregation does.

    Oracle: a complexity-class assertion. ``list_symbols`` enumerates directories, so it
    must stay orders of magnitude below a full column scan on the same lake. Synchronous,
    so it stays a plain pytest function using the shared ``mini_lake`` fixture.
    """
    reader = TickLakeReader(mini_lake)

    def _best(fn, reps: int = 3) -> float:
        best = float("inf")
        for _ in range(reps):
            t0 = time.perf_counter()
            fn()
            best = min(best, time.perf_counter() - t0)
        return best

    names = reader.list_symbols()
    assert names, "fixture lake must contain symbols"

    t_names = _best(reader.list_symbols)
    t_stats = _best(reader.symbol_stats)

    # Directory enumeration does no Parquet I/O; require a large margin so the test is
    # stable regardless of storage speed.
    assert t_names < t_stats / 10, (
        f"names-only resolution ({t_names * 1000:.3f}ms) is not substantially cheaper than "
        f"full aggregation ({t_stats * 1000:.3f}ms); the boot path is still paying for a scan"
    )


if __name__ == "__main__":  # pragma: no cover - convenience for direct execution
    unittest.main()
