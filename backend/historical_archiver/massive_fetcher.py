"""
Massive (Polygon.io) data fetcher with dedicated per-worker API keys.
Fetches 1-minute OHLCV bars for a single calendar day.

Architecture: Each worker thread owns a dedicated API key. Keys are never
shared or rotated between workers. Rate limiting is handled by the caller
(60s cooldown between fetches).

Pattern mirrors: data-harvester/src/api/massive.py
"""
import time
from datetime import datetime
from polygon import RESTClient
from config import US_EASTERN, UTC


class MassiveFetcher:
    """Fetches 1-min bars from Polygon.io using dedicated per-worker clients."""

    def __init__(self, api_keys: list[str]):
        if not api_keys:
            raise ValueError("No Massive API keys provided.")
        
        self.api_keys = api_keys
        self.clients = [RESTClient(key) for key in api_keys]
        self.total_keys = len(api_keys)
        print(f"🔑 Initialized {self.total_keys} dedicated Massive API clients")

    def fetch_day(self, worker_id: int, ticker: str, date_str: str) -> list[dict]:
        """
        Fetches all 1-minute bars for a single calendar day using a dedicated client.
        
        Args:
            worker_id: Index of the worker/client to use (0-based, maps to a specific API key)
            ticker: Stock symbol (e.g. 'SPY')
            date_str: Date in 'YYYY-MM-DD' format
            
        Returns:
            List of bar dicts with keys: timestamp, open, high, low, close, volume, symbol
        """
        client = self.clients[worker_id % self.total_keys]

        # Build the full-day time range in ET (04:00 → 20:00) converted to UTC
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        start_et = US_EASTERN.localize(date_obj.replace(hour=4, minute=0, second=0))
        end_et = US_EASTERN.localize(date_obj.replace(hour=20, minute=0, second=0))
        from_ts = int(start_et.astimezone(UTC).timestamp() * 1000)
        to_ts = int(end_et.astimezone(UTC).timestamp() * 1000)

        # Retry on the SAME key (no rotation — this worker owns this key)
        max_retries = 3
        for attempt in range(max_retries):
            try:
                aggs = client.list_aggs(
                    ticker=ticker,
                    multiplier=1,
                    timespan="minute",
                    from_=from_ts,
                    to=to_ts,
                    limit=50000
                )
                
                return [{
                    "timestamp": datetime.utcfromtimestamp(agg.timestamp / 1000),
                    "open": agg.open,
                    "high": agg.high,
                    "low": agg.low,
                    "close": agg.close,
                    "volume": agg.volume or 0,
                    "symbol": ticker
                } for agg in aggs]

            except Exception as e:
                error_str = str(e).lower()
                if "429" in error_str or "rate" in error_str or "limit" in error_str:
                    wait = 60 * (attempt + 1)  # 60s, 120s, 180s progressive backoff
                    print(f"      ⚠️ Rate limit on W{worker_id} (key {worker_id+1}/{self.total_keys}). Backing off {wait}s...")
                    time.sleep(wait)
                    continue
                else:
                    print(f"      ❌ Error for {ticker} on {date_str} (W{worker_id}): {e}")
                    return []

        print(f"      ❌ Max retries exhausted for {ticker} on {date_str} (W{worker_id})")
        return []
