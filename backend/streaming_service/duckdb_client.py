"""Tick-lake adapter for the Market Rewind streaming service.

Historically this module attached `data/streaming.duckdb` directly, which required an
exclusive disk lock and broke outright when Data Harvester migrated to the Partitioned
Parquet Tick Lake and deleted the database (Milestone v5.0, contract §1.1).

`DuckDBService` is now a thin, read-only adapter over :class:`TickLakeReader`:

* no disk database, no `ATTACH`, no file locks — all queries run on private in-memory
  DuckDB sessions against pruned Parquet partitions;
* public method signatures and response shapes are unchanged, so `server.py` and the
  React client keep working;
* failures surface as the structured `LakeReaderError` family, which `server.py` maps to
  HTTP 503 responses.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from backend.streaming_service.tick_lake_reader import (
    INTERVAL_MAP,
    LakeReaderError,
    LakeUnavailableError,
    TickLakeReader,
)

__all__ = ["DuckDBService", "INTERVAL_MAP"]


class DuckDBService:
    """Read-only service facade over the Partitioned Parquet Tick Lake."""

    def __init__(
        self,
        streaming_path: Optional[str] = None,
        *,
        lake_root: Optional[Union[str, Path]] = None,
    ) -> None:
        # `streaming_path` is accepted for backward compatibility with
        # `create_app(streaming_db=...)` callers and intentionally ignored: the disk
        # database no longer exists (contract §1.1). `lake_root` wins when both are set.
        self.streaming_path = streaming_path  # deprecated, unused
        self.reader = TickLakeReader(lake_root, validate=False)

    # -- properties --------------------------------------------------------- #

    @property
    def lake_root(self) -> Path:
        return self.reader.lake_root

    def ensure_ready(self) -> None:
        """Validate the lake and fail fast during maintenance (server maps to 503)."""
        self.reader.ensure_ready()

    # -- status ------------------------------------------------------------- #

    def get_status(self) -> Dict[str, Any]:
        """Health payload: lake metadata, inventory counts and a legacy `streaming_db` block.

        Never raises: a missing/corrupt lake is reported as `unavailable`/`degraded` so a
        status probe cannot crash the service.
        """
        payload: Dict[str, Any] = {"status": "ok"}

        error: Optional[str] = None
        try:
            self.reader.validate_lake()
        except LakeUnavailableError as exc:
            error = str(exc)
            payload["status"] = "unavailable"
        except LakeReaderError as exc:
            error = str(exc)
            payload["status"] = "degraded"

        maintenance = False
        totals: Dict[str, Any] = {
            "path": str(self.reader.lake_root),
            "exists": self.reader.lake_root.is_dir(),
            "symbol_count": 0,
            "partition_count": 0,
            "file_count": 0,
            "size_bytes": 0,
            "tick_count": None,
        }
        if payload["status"] != "unavailable":
            maintenance = self.reader.is_maintenance_in_progress()
            totals = self.reader.lake_totals()

        lake_block = {
            **totals,
            "format": (self.reader.metadata or {}).get("format"),
            "schema_version": self.reader.schema_version,
            "compatible_versions": (self.reader.metadata or {}).get("compatible_versions"),
            "maintenance_in_progress": maintenance,
        }
        if error:
            lake_block["error"] = error

        payload["tick_lake"] = lake_block
        # Backward-compatible block for existing clients (the name is retained; the data
        # now comes from the tick lake).
        payload["streaming_db"] = {
            "path": str(self.reader.lake_root),
            "exists": bool(lake_block["exists"]),
            "size_bytes": lake_block["size_bytes"],
            "tick_count": lake_block["tick_count"] or 0,
        }
        if error:
            payload["error"] = error
        return payload

    # -- symbol inventory ---------------------------------------------------- #

    def get_symbols(self) -> List[Dict[str, Any]]:
        """Per-symbol tick counts and time ranges, sorted by tick count descending.

        Costs a full-lake aggregation. Callers that only need names (notably the app's
        startup inventory) should use :meth:`get_symbol_names` instead.
        """
        stats = self.reader.symbol_stats()
        return [
            {
                "symbol": row["symbol"],
                "tick_count": row["tick_count"],
                "first_tick": row["first_tick"],
                "last_tick": row["last_tick"],
            }
            for row in stats
        ]

    def get_symbol_names(self) -> List[Dict[str, Any]]:
        """Symbol inventory without aggregation (boot path).

        Returns ``[{"symbol": ...}]`` resolved from partition directory names. No tick
        data is read, so this does not scale with lake size.
        """
        return self.reader.symbol_names()

    def get_symbol_summary(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Aggregate metrics plus the latest quote for one symbol (None when unknown)."""
        rows = self.reader.symbol_stats(symbol)
        if not rows:
            return None
        stats = rows[0]

        latest_quote: Optional[Dict[str, Any]] = None
        tape = self.reader.query_tape(symbol, limit=1)
        if tape:
            head = tape[0]
            latest_quote = {
                "timestamp": head["timestamp"],
                "price": head["price"],
                "volume": head["volume"],
                "bid": head["bid"],
                "ask": head["ask"],
                "source": head["source"],
                "session": head["session"],
            }

        return {
            "symbol": stats["symbol"],
            "tick_count": stats["tick_count"],
            "first_tick": stats["first_tick"],
            "last_tick": stats["last_tick"],
            "min_price": stats["min_price"],
            "max_price": stats["max_price"],
            "latest_quote": latest_quote,
        }

    # -- data queries -------------------------------------------------------- #

    def query_ticks(
        self,
        symbol: str,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 10000,
        offset: int = 0,
        direction: str = "asc",
    ) -> List[Dict[str, Any]]:
        """Raw ticks (ascending or reverse-chronological) in the legacy `MarketTick` shape."""
        return self.reader.query_ticks(
            symbol=symbol,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            offset=offset,
            direction=direction,
        )

    def query_tape(
        self,
        symbol: str,
        limit: int = 50,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Reverse-chronological tape rows with computed spread (§4.2)."""
        return self.reader.query_tape(
            symbol, limit=limit, start_time=start_time, end_time=end_time
        )

    def query_candles(
        self,
        symbol: str,
        timeframe: str = "1m",
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 15000,
        direction: Optional[str] = None,
        session: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """OHLCV candles resampled from lake ticks (daily candles are RTH-only by default)."""
        return self.reader.query_candles(
            symbol=symbol,
            timeframe=timeframe,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            direction=direction,
            session=session,
        )
