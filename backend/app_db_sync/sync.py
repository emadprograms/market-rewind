import libsql
import os
import sys
import logging

# Configuration
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

SYNC_URL = os.environ.get("TURSO_DB_URL")
AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")
DB_PATH = "backend/app_db_sync/market_data.db"

def run_single_sync():
    """
    Performs exactly one synchronization from Turso to the local database file.
    No loops, no continuous connection.
    """
    if not SYNC_URL or not AUTH_TOKEN:
        logger.error("Missing TURSO_DB_URL or TURSO_AUTH_TOKEN")
        sys.exit(1)

    os.makedirs("backend/app_db_sync", exist_ok=True)
    
    logger.info(f"Connecting to {DB_PATH} and performing ONE-TIME master sync...")
    try:
        # Connect with sync capability
        conn = libsql.connect(DB_PATH, sync_url=SYNC_URL, auth_token=AUTH_TOKEN)
        
        # Pull latest changes from Turso. 
        # For the first run, this creates the DB. 
        # For subsequent runs, it only pulls deltas (saving reads).
        conn.sync()
        
        # Verify data exists locally
        res = conn.execute("SELECT count(*) FROM market_data")
        count = res.fetchone()[0]
        logger.info(f"Sync complete. Local database now has {count} rows.")
        
        conn.close()
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_single_sync()
