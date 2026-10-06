"""
High-Performance DuckDB Streaming Server for Market Rewind.
Exposes REST and WebSocket endpoints for tick-by-tick replay,
dynamic candle synthesis, and symbol inventory.
"""
import sys
import os
import json
import argparse
import asyncio
from datetime import datetime
from aiohttp import web, WSMsgType

# Add repository root to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from backend.streaming_service.duckdb_client import DuckDBService
from backend.streaming_service.tick_lake_reader import (
    LakeMaintenanceInProgressError,
    LakeReaderError,
    LakeUnavailableError,
)

# Optional orjson for maximum serialization speed
try:
    import orjson
    def json_dumps(obj):
        return orjson.dumps(obj).decode("utf-8")
except ImportError:
    def json_dumps(obj):
        return json.dumps(obj, default=str)


class ReplaySession:
    """Manages an active WebSocket tick-by-tick playback session."""
    def __init__(self, ws: web.WebSocketResponse, duckdb_service: DuckDBService):
        self.ws = ws
        self.db = duckdb_service
        self.symbol: str = "QQQ"
        self.is_playing: bool = False
        self.speed: float = 1.0
        self.current_index: int = 0
        self.ticks_buffer: list = []
        self.play_task: asyncio.Task = None

    async def load_ticks(self, symbol: str, start_time: str = None, limit: int = 20000):
        self.symbol = symbol.upper()
        self.ticks_buffer = self.db.query_ticks(
            symbol=self.symbol,
            start_time=start_time,
            limit=limit,
            direction="asc"
        )
        self.current_index = 0
        await self.send_status()

    async def send_status(self):
        current_tick = self.ticks_buffer[self.current_index] if self.ticks_buffer and self.current_index < len(self.ticks_buffer) else None
        msg = {
            "type": "status",
            "symbol": self.symbol,
            "playing": self.is_playing,
            "speed": self.speed,
            "currentIndex": self.current_index,
            "totalBuffered": len(self.ticks_buffer),
            "currentTime": current_tick["time"] if current_tick else None,
        }
        await self.ws.send_str(json_dumps(msg))

    async def step(self, direction: str = "forward"):
        if not self.ticks_buffer:
            return

        if direction == "forward" and self.current_index < len(self.ticks_buffer) - 1:
            self.current_index += 1
            tick = self.ticks_buffer[self.current_index]
            await self.ws.send_str(json_dumps({"type": "tick", "tick": tick, "index": self.current_index}))
        elif direction == "backward" and self.current_index > 0:
            self.current_index -= 1
            tick = self.ticks_buffer[self.current_index]
            await self.ws.send_str(json_dumps({"type": "tick", "tick": tick, "index": self.current_index, "backward": True}))
        await self.send_status()

    async def play_loop(self):
        try:
            while self.is_playing and self.current_index < len(self.ticks_buffer) - 1:
                prev_tick = self.ticks_buffer[self.current_index] if self.current_index >= 0 else None
                self.current_index += 1
                tick = self.ticks_buffer[self.current_index]
                await self.ws.send_str(json_dumps({"type": "tick", "tick": tick, "index": self.current_index}))

                # Real-time proportional delay based on market timestamp delta
                delay = 0.005
                if prev_tick and "time" in prev_tick and "time" in tick:
                    try:
                        t1_str = str(prev_tick["time"]).replace(" ", "T")
                        t2_str = str(tick["time"]).replace(" ", "T")
                        t1 = datetime.fromisoformat(t1_str)
                        t2 = datetime.fromisoformat(t2_str)
                        delta_sec = max(0.0, (t2 - t1).total_seconds())
                        # Cap max pause at 3.0s (scaled by replay speed)
                        delay = min(3.0, delta_sec) / self.speed
                    except Exception:
                        delay = 0.01 / self.speed

                if delay > 0.001:
                    await asyncio.sleep(delay)

            if self.current_index >= len(self.ticks_buffer) - 1:
                self.is_playing = False
                await self.send_status()
        except asyncio.CancelledError:
            pass

    async def set_playing(self, playing: bool):
        self.is_playing = playing
        if self.is_playing:
            if self.play_task and not self.play_task.done():
                self.play_task.cancel()
            self.play_task = asyncio.create_task(self.play_loop())
        else:
            if self.play_task and not self.play_task.done():
                self.play_task.cancel()
        await self.send_status()

    async def seek(self, target_time: str):
        if not self.ticks_buffer:
            return

        # Find closest tick by time
        closest_idx = 0
        for i, tick in enumerate(self.ticks_buffer):
            if tick["time"] >= target_time:
                closest_idx = i
                break
        self.current_index = closest_idx
        tick = self.ticks_buffer[self.current_index]
        await self.ws.send_str(json_dumps({"type": "tick", "tick": tick, "index": self.current_index, "seek": True}))
        await self.send_status()

    def close(self):
        if self.play_task and not self.play_task.done():
            self.play_task.cancel()


# --- CORS Middleware ---
@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        response = await handler(request)

    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    return response


def lake_error_response(exc: LakeReaderError) -> web.Response:
    """Map structured lake failures to HTTP responses (plan 41-01 Task 3).

    Maintenance and unavailable lakes are transient operational states, so both are 503
    with a retry hint; metadata problems are also 503 (the data plane is unusable) but
    reported distinctly so operators can tell them apart.
    """
    if isinstance(exc, LakeMaintenanceInProgressError):
        payload = {"error": "Lake maintenance in progress", "retry_after": 5}
    elif isinstance(exc, LakeUnavailableError):
        payload = {"error": "Tick lake unavailable", "retry_after": 10}
    else:
        payload = {"error": "Tick lake metadata error", "detail": str(exc), "retry_after": 30}
    return web.Response(text=json_dumps(payload), status=503, content_type="application/json")


def bad_request(message: str) -> web.Response:
    return web.Response(text=json_dumps({"error": message}), status=400, content_type="application/json")


class StreamingApp:
    def __init__(self, duckdb_service: DuckDBService):
        self.db = duckdb_service
        self.app = web.Application(middlewares=[cors_middleware])
        self._setup_routes()

    def _setup_routes(self):
        self.app.router.add_get("/api/status", self.handle_status)
        self.app.router.add_get("/api/symbols", self.handle_symbols)
        self.app.router.add_get("/api/symbols/{symbol}", self.handle_symbol_summary)
        self.app.router.add_get("/api/ticks", self.handle_ticks)
        self.app.router.add_get("/api/candles", self.handle_candles)
        self.app.router.add_get("/api/streaming/candles", self.handle_candles)
        self.app.router.add_get("/ws/replay", self.handle_ws_replay)
        self.app.router.add_get("/ws/playback", self.handle_ws_replay)  # plan-compatible alias

    async def handle_status(self, request):
        try:
            self.db.ensure_ready()
        except LakeReaderError as exc:
            return lake_error_response(exc)
        status = self.db.get_status()
        return web.Response(text=json_dumps(status), content_type="application/json")

    async def handle_symbols(self, request):
        try:
            symbols = self.db.get_symbols()
        except LakeReaderError as exc:
            return lake_error_response(exc)
        return web.Response(text=json_dumps(symbols), content_type="application/json")

    async def handle_symbol_summary(self, request):
        symbol = request.match_info.get("symbol", "")
        try:
            summary = self.db.get_symbol_summary(symbol)
        except LakeReaderError as exc:
            return lake_error_response(exc)
        if not summary:
            return web.Response(text=json_dumps({"error": f"Symbol {symbol} not found"}), status=404, content_type="application/json")
        return web.Response(text=json_dumps(summary), content_type="application/json")

    async def handle_ticks(self, request):
        symbol = request.query.get("symbol")
        if not symbol:
            return bad_request("Missing required parameter 'symbol'")

        start_time = request.query.get("start_time")
        end_time = request.query.get("end_time")
        direction = (request.query.get("direction") or "asc").lower()
        try:
            limit = int(request.query.get("limit", 10000))
            offset = int(request.query.get("offset", 0))
        except (TypeError, ValueError):
            return bad_request("'limit' and 'offset' must be integers")
        if limit < 0 or offset < 0:
            return bad_request("'limit' and 'offset' must be non-negative")

        try:
            if direction == "desc":
                # Time & Sales: reverse-chronological tape with computed spread (§4.2).
                # Time bounds are forwarded so a bounded desc query narrows the tape.
                window = offset + limit if limit else 0
                tape = self.db.query_tape(
                    symbol, limit=window, start_time=start_time, end_time=end_time
                )
                ticks = tape[offset:] if limit else []
            else:
                ticks = self.db.query_ticks(
                    symbol=symbol,
                    start_time=start_time,
                    end_time=end_time,
                    limit=limit,
                    offset=offset,
                    direction="asc",
                )
        except LakeReaderError as exc:
            return lake_error_response(exc)
        return web.Response(text=json_dumps(ticks), content_type="application/json")

    async def handle_candles(self, request):
        symbol = request.query.get("symbol")
        if not symbol:
            return bad_request("Missing required parameter 'symbol'")

        timeframe = request.query.get("timeframe") or request.query.get("tf", "1m")
        start_time = request.query.get("start_time") or request.query.get("start")
        end_time = request.query.get("end_time") or request.query.get("end")
        direction = request.query.get("direction")
        session = request.query.get("session")
        try:
            limit = int(request.query.get("limit", 15000))
        except (TypeError, ValueError):
            return bad_request("'limit' must be an integer")
        if limit < 0:
            return bad_request("'limit' must be non-negative")

        try:
            candles = self.db.query_candles(
                symbol=symbol,
                timeframe=timeframe,
                start_time=start_time,
                end_time=end_time,
                limit=limit,
                direction=direction,
                session=session,
            )
        except LakeReaderError as exc:
            return lake_error_response(exc)
        return web.Response(text=json_dumps(candles), content_type="application/json")

    async def handle_ws_replay(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        session = ReplaySession(ws, self.db)
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        action = data.get("action")

                        if action == "load":
                            symbol = data.get("symbol", "QQQ")
                            start_time = data.get("start_time")
                            limit = int(data.get("limit", 20000))
                            await session.load_ticks(symbol, start_time, limit)

                        elif action == "play":
                            await session.set_playing(True)

                        elif action == "pause":
                            await session.set_playing(False)

                        elif action == "step":
                            direction = data.get("direction", "forward")
                            await session.step(direction)

                        elif action == "set_speed":
                            session.speed = max(0.1, float(data.get("speed", 1.0)))
                            await session.send_status()

                        elif action == "seek":
                            target_time = data.get("timestamp")
                            if target_time:
                                await session.seek(target_time)

                    except Exception as err:
                        await ws.send_str(json_dumps({"type": "error", "message": str(err)}))
                elif msg.type == WSMsgType.ERROR:
                    print(f"WS connection closed with exception {ws.exception()}")
        finally:
            session.close()

        return ws


def create_app(streaming_db=None, lake_root=None):
    """Build the aiohttp application.

    `streaming_db` is the legacy keyword (accepted, ignored — the disk database was
    deleted in Milestone v5.0). `lake_root` overrides tick-lake discovery.
    """
    db_service = DuckDBService(streaming_path=streaming_db, lake_root=lake_root)
    server = StreamingApp(db_service)
    return server.app


def main():
    parser = argparse.ArgumentParser(description="Market Rewind DuckDB Streaming Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host interface (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on (default: 8765)")
    parser.add_argument("--streaming-db", default=None, help="Deprecated: ignored (disk database retired)")
    parser.add_argument("--lake-root", default=None, help="Path to the Partitioned Parquet Tick Lake root")

    args = parser.parse_args()
    app = create_app(streaming_db=args.streaming_db, lake_root=args.lake_root)

    print(f"🚀 Starting Market Rewind Streaming Service on http://{args.host}:{args.port}")
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
