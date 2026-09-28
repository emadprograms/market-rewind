"""
DuckDB Client for Market Rewind.
Direct read-only zero-copy integration with data-harvester's dedicated databases:
- streaming.duckdb: 37.8M+ raw tick records (ticks table)
- historical.duckdb: 8.8M+ 1-minute historical candles (market_data table)
"""
import os
import time
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional
import duckdb

# Determine database paths relative to market-rewind root
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DEFAULT_DATA_HARVESTER_DIR = ROOT_DIR.parent / "data-harvester" / "data"

STREAMING_DB_PATH = os.environ.get(
    "STREAMING_DB_PATH",
    str(DEFAULT_DATA_HARVESTER_DIR / "streaming.duckdb")
)
HISTORICAL_DB_PATH = os.environ.get(
    "HISTORICAL_DB_PATH",
    str(DEFAULT_DATA_HARVESTER_DIR / "historical.duckdb")
)

INTERVAL_MAP = {
    "1s": "1 second",
    "5s": "5 seconds",
    "15s": "15 seconds",
    "30s": "30 seconds",
    "1m": "1 minute",
    "3m": "3 minutes",
    "5m": "5 minutes",
    "15m": "15 minutes",
    "30m": "30 minutes",
    "1h": "1 hour",
    "4h": "4 hours",
    "1d": "1 day",
}


class DuckDBService:
    def __init__(self, streaming_path: Optional[str] = None, historical_path: Optional[str] = None):
        self.streaming_path = streaming_path or STREAMING_DB_PATH
        self.historical_path = historical_path or HISTORICAL_DB_PATH
        self._validate_paths()

    def _validate_paths(self):
        self.has_streaming = os.path.exists(self.streaming_path)
        self.has_historical = os.path.exists(self.historical_path)

    def get_connection(self, db_path: str, max_retries: int = 5, retry_delay: float = 0.05) -> duckdb.DuckDBPyConnection:
        """Connects to DuckDB with read_only=True and retries on concurrent lock."""
        last_err = None
        for attempt in range(max_retries):
            try:
                return duckdb.connect(db_path, read_only=True)
            except Exception as e:
                err_msg = str(e)
                last_err = e
                if "lock" in err_msg.lower() and attempt < max_retries - 1:
                    time.sleep(retry_delay * (2 ** attempt))
                    continue
                raise last_err or RuntimeError(f"Could not connect to DuckDB at {db_path}")

    def get_status(self) -> Dict[str, Any]:
        """Returns health status, file sizes, and record counts."""
        self._validate_paths()
        status: Dict[str, Any] = {
            "status": "ok",
            "streaming_db": {
                "path": self.streaming_path,
                "exists": self.has_streaming,
                "size_bytes": os.path.getsize(self.streaming_path) if self.has_streaming else 0,
                "tick_count": 0,
            },
            "historical_db": {
                "path": self.historical_path,
                "exists": self.has_historical,
                "size_bytes": os.path.getsize(self.historical_path) if self.has_historical else 0,
                "candle_count": 0,
            },
        }

        if self.has_streaming:
            try:
                conn = self.get_connection(self.streaming_path)
                res = conn.execute("SELECT count(*) FROM ticks").fetchone()
                status["streaming_db"]["tick_count"] = res[0] if res else 0
                conn.close()
            except Exception as e:
                status["streaming_db"]["error"] = str(e)

        if self.has_historical:
            try:
                conn = self.get_connection(self.historical_path)
                res = conn.execute("SELECT count(*) FROM market_data").fetchone()
                status["historical_db"]["candle_count"] = res[0] if res else 0
                conn.close()
            except Exception as e:
                status["historical_db"]["error"] = str(e)

        return status

    def get_symbols(self) -> List[Dict[str, Any]]:
        """Returns list of symbols available in streaming.duckdb with tick counts and time ranges."""
        if not self.has_streaming:
            return []

        conn = self.get_connection(self.streaming_path)
        try:
            query = """
                SELECT 
                    symbol,
                    count(*) as tick_count,
                    min(timestamp) as min_ts,
                    max(timestamp) as max_ts
                FROM ticks
                GROUP BY symbol
                ORDER BY tick_count DESC
            """
            rows = conn.execute(query).fetchall()
            results = []
            for row in rows:
                results.append({
                    "symbol": row[0],
                    "tick_count": row[1],
                    "first_tick": row[2].isoformat() if row[2] else None,
                    "last_tick": row[3].isoformat() if row[3] else None,
                })
            return results
        finally:
            conn.close()

    def get_symbol_summary(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Returns detailed stats for a specific symbol."""
        if not self.has_streaming:
            return None

        conn = self.get_connection(self.streaming_path)
        try:
            query = """
                SELECT 
                    count(*) as tick_count,
                    min(timestamp) as min_ts,
                    max(timestamp) as max_ts,
                    min(price) as min_price,
                    max(price) as max_price
                FROM ticks
                WHERE symbol = ?
            """
            stats = conn.execute(query, [symbol.upper()]).fetchone()
            if not stats or stats[0] == 0:
                return None

            latest = conn.execute("""
                SELECT timestamp, price, volume, bid, ask, source, session
                FROM ticks
                WHERE symbol = ?
                ORDER BY timestamp DESC
                LIMIT 1
            """, [symbol.upper()]).fetchone()

            return {
                "symbol": symbol.upper(),
                "tick_count": stats[0],
                "first_tick": stats[1].isoformat() if stats[1] else None,
                "last_tick": stats[2].isoformat() if stats[2] else None,
                "min_price": stats[3],
                "max_price": stats[4],
                "latest_quote": {
                    "timestamp": latest[0].isoformat() if latest else None,
                    "price": latest[1] if latest else None,
                    "volume": latest[2] if latest else None,
                    "bid": latest[3] if latest else None,
                    "ask": latest[4] if latest else None,
                    "source": latest[5] if latest else None,
                    "session": latest[6] if latest else None,
                } if latest else None
            }
        finally:
            conn.close()

    def query_ticks(
        self,
        symbol: str,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 10000,
        offset: int = 0,
        direction: str = "asc"
    ) -> List[Dict[str, Any]]:
        """Queries raw tick records for a symbol."""
        if not self.has_streaming:
            return []

        conn = self.get_connection(self.streaming_path)
        try:
            where_clauses = ["symbol = ?"]
            params: List[Any] = [symbol.upper()]

            if start_time:
                where_clauses.append("timestamp >= ?::TIMESTAMP")
                params.append(start_time)
            if end_time:
                where_clauses.append("timestamp <= ?::TIMESTAMP")
                params.append(end_time)

            where_stmt = " AND ".join(where_clauses)
            order_dir = "ASC" if direction.lower() == "asc" else "DESC"
            clamped_limit = min(max(1, limit), 100000)

            query = f"""
                SELECT 
                    timestamp,
                    symbol,
                    price,
                    coalesce(volume, 1.0) as volume,
                    bid,
                    ask,
                    source,
                    session
                FROM ticks
                WHERE {where_stmt}
                ORDER BY timestamp {order_dir}
                LIMIT {clamped_limit} OFFSET {offset}
            """
            rows = conn.execute(query, params).fetchall()
            return [
                {
                    "time": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
                    "symbol": row[1],
                    "price": float(row[2]),
                    "volume": float(row[3]) if row[3] is not None else 1.0,
                    "bid": float(row[4]) if row[4] is not None else None,
                    "ask": float(row[5]) if row[5] is not None else None,
                    "source": row[6],
                    "session": row[7],
                }
                for row in rows
            ]
        finally:
            conn.close()

    def query_candles(
        self,
        symbol: str,
        timeframe: str = "1m",
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 15000,
        direction: Optional[str] = None,
        session: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Dynamically aggregates ticks into OHLCV candles using DuckDB time_bucket().
        If no ticks match and timeframe is 1m+, attempts fallback to historical.duckdb.
        When querying historical window up to end_time (start_time is None), queries the latest
        candles before end_time (DESC) and reverses them to return in chronological ASC order.
        For 1d timeframe, strictly uses Regular Trading Hours (RTH / session = 'REG').
        """
        interval = INTERVAL_MAP.get(timeframe.lower(), "1 minute")
        candles: List[Dict[str, Any]] = []

        if self.has_streaming:
            conn = self.get_connection(self.streaming_path)
            try:
                where_clauses = ["symbol = ?"]
                params: List[Any] = [symbol.upper()]

                if session and session.upper() != "ALL":
                    where_clauses.append("upper(session) = ?")
                    params.append(session.upper())
                elif not session and timeframe.lower() in ("1d", "1 day"):
                    where_clauses.append("(upper(session) = 'REG' OR session = 'RTH')")

                if start_time:
                    where_clauses.append("timestamp >= ?::TIMESTAMP")
                    params.append(start_time)
                if end_time:
                    where_clauses.append("timestamp <= ?::TIMESTAMP")
                    params.append(end_time)

                where_stmt = " AND ".join(where_clauses)
                clamped_limit = min(max(1, limit), 50000)
                order_desc = (direction.lower() == "desc") if direction else (start_time is None and end_time is not None)
                order_dir = "DESC" if order_desc else "ASC"

                query = f"""
                    SELECT 
                        time_bucket(INTERVAL '{interval}', timestamp::TIMESTAMP) AS bucket_time,
                        first(price ORDER BY timestamp) AS open,
                        max(price) AS high,
                        min(price) AS low,
                        last(price ORDER BY timestamp) AS close,
                        sum(coalesce(volume, 1.0)) AS volume,
                        count(*) AS tick_count
                    FROM ticks
                    WHERE {where_stmt}
                    GROUP BY bucket_time
                    ORDER BY bucket_time {order_dir}
                    LIMIT {clamped_limit}
                """
                rows = conn.execute(query, params).fetchall()
                if order_desc:
                    rows.reverse()

                candles = [
                    {
                        "time": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
                        "open": float(row[1]),
                        "high": float(row[2]),
                        "low": float(row[3]),
                        "close": float(row[4]),
                        "volume": float(row[5]),
                        "tick_count": int(row[6]),
                    }
                    for row in rows
                ]
            finally:
                conn.close()

        # If fewer candles than requested limit were found and historical DB exists, backfill from historical
        if self.has_historical and len(candles) < clamped_limit:
            remaining_limit = clamped_limit - len(candles)
            hist_end_time = candles[0]["time"] if candles else end_time
            hist_candles = self._query_historical_candles(
                symbol=symbol,
                timeframe=timeframe,
                start_time=start_time,
                end_time=hist_end_time,
                limit=remaining_limit,
                direction=direction,
                session=session
            )
            if candles and hist_candles and hist_candles[-1]["time"] == candles[0]["time"]:
                hist_candles = hist_candles[:-1]
            candles = hist_candles + candles

        return candles

    def _query_historical_candles(
        self,
        symbol: str,
        timeframe: str,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 15000,
        direction: Optional[str] = None,
        session: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Queries 1-minute historical candles from historical.duckdb with optional resampling."""
        interval = INTERVAL_MAP.get(timeframe.lower(), "1 minute")
        conn = self.get_connection(self.historical_path)
        try:
            where_clauses = ["symbol = ?"]
            params: List[Any] = [symbol.upper()]

            if session and session.upper() != "ALL":
                where_clauses.append("upper(session) = ?")
                params.append(session.upper())
            elif not session and timeframe.lower() in ("1d", "1 day"):
                where_clauses.append("(upper(session) = 'REG' OR session = 'RTH')")

            if start_time:
                where_clauses.append("timestamp >= ?::TIMESTAMP")
                params.append(start_time)
            if end_time:
                where_clauses.append("timestamp <= ?::TIMESTAMP")
                params.append(end_time)

            where_stmt = " AND ".join(where_clauses)
            clamped_limit = min(max(1, limit), 50000)
            order_desc = (direction.lower() == "desc") if direction else (start_time is None and end_time is not None)
            order_dir = "DESC" if order_desc else "ASC"

            query = f"""
                SELECT 
                    time_bucket(INTERVAL '{interval}', timestamp::TIMESTAMP) AS bucket_time,
                    first(open ORDER BY timestamp) AS open,
                    max(high) AS high,
                    min(low) AS low,
                    last(close ORDER BY timestamp) AS close,
                    sum(coalesce(volume, 0.0)) AS volume,
                    count(*) AS candle_count
                FROM market_data
                WHERE {where_stmt}
                GROUP BY bucket_time
                ORDER BY bucket_time {order_dir}
                LIMIT {clamped_limit}
            """
            rows = conn.execute(query, params).fetchall()
            if order_desc:
                rows.reverse()

            return [
                {
                    "time": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
                    "open": float(row[1]),
                    "high": float(row[2]),
                    "low": float(row[3]),
                    "close": float(row[4]),
                    "volume": float(row[5]),
                    "tick_count": int(row[6]),
                }
                for row in rows
            ]
        finally:
            conn.close()
