"""
Turso database writer for the Stock Data Archiver.
Handles connection, schema init, resume checks, and batch upserts.

Pattern mirrors: data-harvester/src/database/operations.py
"""
from datetime import datetime
from libsql_client import create_client_sync
from config import US_EASTERN, UTC


# Session classification boundaries (Eastern Time)
_MARKET_OPEN = datetime.strptime("09:30", "%H:%M").time()
_MARKET_CLOSE = datetime.strptime("16:00", "%H:%M").time()


def _classify_session(utc_timestamp: datetime) -> str:
    """Classifies a UTC timestamp into PRE/REG/POST based on Eastern Time."""
    import pytz
    if utc_timestamp.tzinfo is None:
        utc_timestamp = pytz.utc.localize(utc_timestamp)
    et_time = utc_timestamp.astimezone(US_EASTERN).time()
    
    if et_time < _MARKET_OPEN:
        return "PRE"
    elif et_time > _MARKET_CLOSE:
        return "POST"
    return "REG"


class TursoWriter:
    """Manages the connection to Turso and provides read/write operations."""

    def __init__(self, url: str, token: str):
        if not url or not token:
            raise ValueError("Missing Turso URL or auth token.")
        
        # Convert libsql:// to https:// for the sync client
        sanitized_url = url.replace("libsql://", "https://")
        
        self.client = create_client_sync(url=sanitized_url, auth_token=token)
        print(f"✅ Connected to Turso: {sanitized_url[:50]}...")
        self._ensure_schema()

    def _ensure_schema(self):
        """Creates the market_data and symbol_map tables if they don't exist."""
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS market_data (
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                open REAL, 
                high REAL, 
                low REAL, 
                close REAL, 
                volume REAL, 
                session TEXT,
                source TEXT,
                PRIMARY KEY (symbol, timestamp)
            )
        """)
        
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS symbol_map (
                display_name TEXT PRIMARY KEY,
                yahoo_ticker TEXT,
                massive_ticker TEXT,
                binance_ticker TEXT,
                capital_ticker TEXT
            )
        """)

    def get_massive_tickers(self) -> list[tuple[str, str]]:
        """
        Reads the aw_ticker_notes table from the source DB and returns
        all unique tickers, plus SPY.
        Returns a list of (display_name, massive_ticker) tuples.
        """
        # 1. Fetch unique tickers from notes table
        res = self.client.execute("SELECT DISTINCT ticker FROM aw_ticker_notes")
        tickers = {row[0] for row in res.rows if row[0]}
        
        # 2. Ensure SPY is included
        tickers.add("SPY")
        
        # 3. Format as (display_name, massive_ticker)
        # For typical US equities, these are identical
        sorted_tickers = sorted(list(tickers))
        return [(t, t) for t in sorted_tickers]

    def check_day_exists(self, ticker: str, date_str: str) -> int:
        """
        Returns the number of rows already stored for a given ticker+date.
        Used for resume capability — skip days that are already populated.
        """
        start = f"{date_str} 00:00:00"
        end = f"{date_str} 23:59:59"
        
        res = self.client.execute(
            "SELECT COUNT(*) FROM market_data WHERE symbol = ? AND timestamp >= ? AND timestamp <= ?",
            [ticker, start, end]
        )
        return res.rows[0][0] if res.rows else 0

    def upsert_bars(self, bars: list[dict]) -> int:
        """
        Batch upserts bars into market_data with Tier-1 source protection.
        Uses the libSQL batch API — sends ALL bars in a single HTTP call.
        """
        if not bars:
            return 0

        _SQL = """INSERT INTO market_data 
               (timestamp, symbol, open, high, low, close, volume, session, source) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(symbol, timestamp) DO UPDATE SET
                   open=excluded.open,
                   high=excluded.high,
                   low=excluded.low,
                   close=excluded.close,
                   volume=excluded.volume,
                   session=excluded.session,
                   source=excluded.source
               WHERE 
                   (market_data.source NOT IN ('MASSIVE', 'BINANCE')) OR 
                   (excluded.source IN ('MASSIVE', 'BINANCE'))"""

        statements = []
        for bar in bars:
            ts = bar["timestamp"]
            session = _classify_session(ts)
            ts_str = ts.strftime('%Y-%m-%d %H:%M:%S')
            statements.append((
                _SQL,
                [ts_str, bar["symbol"], bar["open"], bar["high"], bar["low"],
                 bar["close"], bar["volume"], session, "MASSIVE"]
            ))

        # Send all statements in one HTTP call (chunked at 500 for safety)
        CHUNK = 500
        for i in range(0, len(statements), CHUNK):
            self.client.batch(statements[i:i + CHUNK])

        return len(bars)

    def close(self):
        """Closes the database connection."""
        try:
            self.client.close()
        except Exception:
            pass
