"""
Sync Release — Exports the Archive Turso database to a local SQLite file.
Uses Infisical to fetch the archive database credentials (same source of truth
as the historical archiver).

This script is called by the GitHub Actions workflow after a backfill completes,
to create a downloadable SQLite snapshot of the archive database.
"""
import os
import sys
import logging

# Ensure the package directory is on the path
sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DB_PATH = "backend/historical_archiver/archive_data.db"


def run_sync():
    """
    1. Connect to Infisical to get archive DB credentials
    2. Sync the archive Turso database to a local SQLite file
    """
    from infisical_client import InfisicalClient
    import libsql

    # Step 1: Get credentials from Infisical
    logger.info("Connecting to Infisical for archive DB credentials...")
    infisical = InfisicalClient()
    if not infisical.is_connected:
        logger.error("Cannot connect to Infisical. Exiting.")
        sys.exit(1)

    target_creds = infisical.get_target_creds()
    sync_url = target_creds.get("url")
    auth_token = target_creds.get("token")

    if not sync_url or not auth_token:
        logger.error("Missing archive DB credentials in Infisical. Exiting.")
        sys.exit(1)

    logger.info(f"Archive DB URL: {sync_url[:30]}...")

    # Step 2: Sync Turso → local SQLite
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    logger.info(f"Syncing archive database to {DB_PATH}...")
    try:
        conn = libsql.connect(DB_PATH, sync_url=sync_url, auth_token=auth_token)
        conn.sync()

        # Verify
        res = conn.execute("SELECT count(*) FROM market_data")
        count = res.fetchone()[0]
        logger.info(f"Sync complete. Local archive database has {count:,} rows.")

        conn.close()
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    run_sync()
