import pytest
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from backend.streaming_service.server import create_app


class TestStreamingServer(AioHTTPTestCase):
    async def get_application(self):
        return create_app()

    @unittest_run_loop
    async def test_get_status_endpoint(self):
        resp = await self.client.request("GET", "/api/status")
        assert resp.status == 200
        data = await resp.json()
        assert data["status"] == "ok"
        assert "streaming_db" in data
        assert data["streaming_db"]["exists"] is True

    @unittest_run_loop
    async def test_get_symbols_endpoint(self):
        resp = await self.client.request("GET", "/api/symbols")
        assert resp.status == 200
        data = await resp.json()
        assert isinstance(data, list)
        assert len(data) > 0

    @unittest_run_loop
    async def test_get_ticks_endpoint(self):
        resp = await self.client.request("GET", "/api/ticks?symbol=NVDA&limit=5")
        assert resp.status == 200
        data = await resp.json()
        assert isinstance(data, list)
        assert len(data) == 5
        assert data[0]["symbol"] == "NVDA"

    @unittest_run_loop
    async def test_get_candles_endpoint(self):
        resp = await self.client.request("GET", "/api/candles?symbol=NVDA&timeframe=1s&limit=5")
        assert resp.status == 200
        data = await resp.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert "open" in data[0]
        assert "close" in data[0]
