"""
Massive (Polygon.io) data fetcher with round-robin API key rotation.
Fetches 1-minute OHLCV bars for a single calendar day.

Pattern mirrors: data-harvester/src/api/massive.py
"""
import time
import threading
from datetime import datetime, timedelta
from polygon import RESTClient
from config import US_EASTERN, UTC


class MassiveFetcher:
    """Fetches 1-min bars from Polygon.io, rotating through multiple API keys."""

    def __init__(self, api_keys: list[str]):
        if not api_keys:
            raise ValueError("No Massive API keys provided.")
        
        self._lock = threading.Lock()
        self.api_keys = api_keys
        self.clients = [RESTClient(key) for key in api_keys]
        self._key_index = 0
        self.total_keys = len(api_keys)
        print(f"🔑 Initialized {self.total_keys} Massive API clients")

    def _get_next_client(self) -> tuple[RESTClient, int]:
        """Returns the next client in rotation and its 1-based index."""
        with self._lock:
            client = self.clients[self._key_index]
            idx = self._key_index + 1  # 1-based for display
            self._key_index = (self._key_index + 1) % self.total_keys
            return client, idx

    def fetch_day(self, ticker: str, date_str: str) -> list[dict]:
        """
        Fetches all 1-minute bars for a single calendar day.
        
        Args:
            ticker: Stock symbol (e.g. 'SPY')
            date_str: Date in 'YYYY-MM-DD' format
            
        Returns:
            List of bar dicts with keys: timestamp, open, high, low, close, volume, symbol
        """
        # Build the full-day time range in ET (04:00 → 20:00) converted to UTC
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        
        # Create ET-aware start/end for extended hours
        start_et = US_EASTERN.localize(date_obj.replace(hour=4, minute=0, second=0))
        end_et = US_EASTERN.localize(date_obj.replace(hour=20, minute=0, second=0))
        
        # Convert to UTC timestamps in milliseconds (Polygon expects ms)
        from_ts = int(start_et.astimezone(UTC).timestamp() * 1000)
        to_ts = int(end_et.astimezone(UTC).timestamp() * 1000)

        # Try fetching, with retry on rate limit (rotate to next key)
        max_retries = self.total_keys + 1
        for attempt in range(max_retries):
            # MANDATORY PACING: Small sleep to avoid slamming the API with 9 concurrent threads
            time.sleep(0.5)
            
            client, key_idx = self._get_next_client()
            try:
                aggs = client.list_aggs(
                    ticker=ticker,
                    multiplier=1,
                    timespan="minute",
                    from_=from_ts,
                    to=to_ts,
                    limit=50000
                )
                
                bars = []
                for agg in aggs:
                    bars.append({
                        "timestamp": datetime.fromtimestamp(agg.timestamp / 1000, tz=UTC),
                        "open": agg.open,
                        "high": agg.high,
                        "low": agg.low,
                        "close": agg.close,
                        "volume": agg.volume or 0,
                        "symbol": ticker
                    })
                
                return bars

            except Exception as e:
                error_str = str(e).lower()
                if "429" in error_str or "rate" in error_str or "limit" in error_str:
                    print(f"      ⚠️ Rate limit on key {key_idx}/{self.total_keys}. Rotating...")
                    time.sleep(2)  # Increased pause before trying next key
                    continue
                else:
                    print(f"      ❌ Massive Error for {ticker} on {date_str} (key {key_idx}): {e}")
                    return []

        print(f"      ❌ All {self.total_keys} keys exhausted for {ticker} on {date_str}")
        return []
