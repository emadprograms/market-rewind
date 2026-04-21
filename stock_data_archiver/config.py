"""
Configuration constants for the Stock Data Archiver.
"""
from pytz import timezone

# Timezone Configuration
US_EASTERN = timezone('US/Eastern')
UTC = timezone('UTC')

# Default date range: October 2025 → January 2026
DEFAULT_FROM = "2025-10-01"
DEFAULT_TO = "2026-01-31"

# Data Schema (matches data-harvester and market-rewind frontend)
SCHEMA_COLS = ['timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume', 'session', 'source']

# Extended hours trading window in ET (04:00 pre-market → 20:00 post-market)
EXTENDED_HOURS_START_ET = 4   # 4:00 AM ET
EXTENDED_HOURS_END_ET = 20   # 8:00 PM ET

# Batch size for Turso upserts
BATCH_SIZE = 100
