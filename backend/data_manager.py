import os
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from libsql_client import create_client_sync
import pytz
import logging

# Configuration
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DB_URL = os.environ.get("TURSO_DB_URL")
AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

def get_db_client():
    if not DB_URL or not AUTH_TOKEN:
        raise ValueError("Missing TURSO_DB_URL or TURSO_AUTH_TOKEN environment variables.")
    url = DB_URL.replace("libsql://", "https://")
    return create_client_sync(url=url, auth_token=AUTH_TOKEN)

def fetch_and_upsert():
    client = get_db_client()
    
    # 1. Get tickers from symbol_map
    logger.info("Fetching tickers from symbol_map...")
    rs = client.execute("SELECT user_ticker FROM symbol_map")
    tickers = [row[0] for row in rs.rows]
    
    if not tickers:
        logger.warning("No tickers found in symbol_map table.")
        return

    # 2. Ensure market_data table exists with correct schema and index
    logger.info("Ensuring market_data table exists...")
    client.execute("""
        CREATE TABLE IF NOT EXISTS market_data (
            symbol TEXT,
            timestamp DATETIME,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            session TEXT,
            PRIMARY KEY (symbol, timestamp)
        )
    """)

    # 3. Fetch data for each ticker
    for ticker in tickers:
        logger.info(f"Processing {ticker}...")
        try:
            # Fetch last 7 days of 1m data (Yahoo's max for 1m)
            data = yf.download(ticker, period="7d", interval="1min", progress=False)
            
            if data.empty:
                logger.warning(f"No data returned for {ticker}.")
                continue

            # Flatten MultiIndex columns if necessary
            if isinstance(data.columns, pd.MultiIndex):
                data.columns = data.columns.get_level_values(0)

            data = data.reset_index()
            data.rename(columns={"Datetime": "timestamp", "Date": "timestamp", "Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"}, inplace=True)

            # Convert to UTC and then to ISO string
            data['timestamp'] = pd.to_datetime(data['timestamp']).dt.tz_convert('UTC').dt.strftime('%Y-%m-%dT%H:%M:%SZ')
            
            # Determine session (Simplified logic: 9:30-16:00 ET is REG, else EXT)
            # This is a bit coarse but fits the requirement
            ny_tz = pytz.timezone('America/New_York')
            
            def get_session(ts_str):
                dt_utc = datetime.strptime(ts_str, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=pytz.UTC)
                dt_ny = dt_utc.astimezone(ny_tz)
                if dt_ny.weekday() >= 5: # Weekend
                    return 'EXT'
                market_open = dt_ny.replace(hour=9, minute=30, second=0, microsecond=0)
                market_close = dt_ny.replace(hour=16, minute=0, second=0, microsecond=0)
                if market_open <= dt_ny < market_close:
                    return 'REG'
                return 'EXT'

            data['session'] = data['timestamp'].apply(get_session)

            # 4. Batch Upsert into Turso
            logger.info(f"Upserting {len(data)} rows for {ticker}...")
            
            # We use chunks to avoid large transaction limits if necessary
            for i in range(0, len(data), 500):
                chunk = data.iloc[i:i+500]
                values = []
                for _, row in chunk.iterrows():
                    values.append((
                        ticker, row['timestamp'], row['open'], row['high'], 
                        row['low'], row['close'], row['volume'], row['session']
                    ))
                
                # SQLite / LibSQL UPSERT
                query = """
                INSERT INTO market_data (symbol, timestamp, open, high, low, close, volume, session)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, timestamp) DO UPDATE SET
                    open=excluded.open,
                    high=excluded.high,
                    low=excluded.low,
                    close=excluded.close,
                    volume=excluded.volume,
                    session=excluded.session
                """
                client.batch([ (query, v) for v in values ])

            logger.info(f"✅ Successfully updated {ticker}.")

        except Exception as e:
            logger.error(f"❌ Error processing {ticker}: {e}")

    logger.info("Done.")

if __name__ == "__main__":
    fetch_and_upsert()
