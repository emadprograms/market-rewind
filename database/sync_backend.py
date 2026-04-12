import libsql
import os
import time
import sys
import logging
from datetime import datetime, timedelta

# Configuration
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

SYNC_URL = os.environ.get("TURSO_DB_URL")
AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")
DB_PATH = "database/market_data.db"

def run_sync_session(duration_hours):
    if not SYNC_URL or not AUTH_TOKEN:
        logger.error("Missing TURSO_DB_URL or TURSO_AUTH_TOKEN")
        sys.exit(1)

    os.makedirs("database", exist_ok=True)
    
    # 1. Connect and perform Initial Sync
    logger.info(f"Connecting to {DB_PATH} and syncing with {SYNC_URL}...")
    try:
        # Use sync_url and auth_token to enable Embedded Replicas
        conn = libsql.connect(DB_PATH, sync_url=SYNC_URL, auth_token=AUTH_TOKEN)
        conn.sync()
        logger.info("Initial sync complete.")
    except Exception as e:
        logger.error(f"Failed initial sync: {e}")
        sys.exit(1)

    # 2. Session Loop
    start_time = datetime.now()
    end_time = start_time + timedelta(hours=duration_hours)
    
    logger.info(f"Starting session loop. Target end time: {end_time.strftime('%H:%M:%S')}")
    
    try:
        while datetime.now() < end_time:
            # Re-sync to get latest changes from Turso
            logger.info("Syncing latest changes...")
            conn.sync()
            
            # Here we just keep the connection alive. 
            # The GitHub workflow will handle the "commit and push" of this db file.
            
            # Wait 5 minutes between syncs
            time.sleep(300) 
            
    except KeyboardInterrupt:
        logger.info("Session stopped manually.")
    except Exception as e:
        logger.error(f"Loop error: {e}")
    finally:
        conn.close()
        logger.info("Backend session finished.")

if __name__ == "__main__":
    hours = float(sys.argv[1]) if len(sys.argv) > 1 else 1
    run_sync_session(hours)
 Greenland
