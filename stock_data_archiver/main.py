"""
Stock Data Archiver — Main Entry Point
=======================================
Backfills historical 1-minute OHLCV data from Massive (Polygon.io) 
into the Turso database for use with Market Rewind.

Architecture:
  - Each worker thread owns a DEDICATED API key (never shared)
  - Days are distributed to workers via a queue
  - Workers process ALL tickers for a day before moving to the next day
  - 60-second cooldown between API calls per worker

Usage:
    python stock_data_archiver/main.py                                              # Full run
    python stock_data_archiver/main.py --from-date 2025-10-01 --to-date 2025-10-01  # Single day
    python stock_data_archiver/main.py --cooldown 30                                 # Custom cooldown
"""
import sys
import os
import argparse
import time
import queue
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

# Ensure the package directory is on the path so config, etc. can be imported
sys.path.insert(0, os.path.dirname(__file__))

from config import DEFAULT_FROM, DEFAULT_TO
from infisical_client import InfisicalClient
from massive_fetcher import MassiveFetcher
from turso_writer import TursoWriter


def generate_date_range(from_date: str, to_date: str) -> list[str]:
    """Generates a list of 'YYYY-MM-DD' strings for each weekday in the range (inclusive)."""
    start = datetime.strptime(from_date, "%Y-%m-%d")
    end = datetime.strptime(to_date, "%Y-%m-%d")
    
    dates = []
    current = start
    while current <= end:
        # Skip weekends (Saturday=5, Sunday=6) — no equity market data
        if current.weekday() < 5:
            dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    
    return dates


def main():
    parser = argparse.ArgumentParser(description="Stock Data Archiver — Historical Backfill Tool")
    parser.add_argument("--from-date", default=DEFAULT_FROM, help=f"Start date (default: {DEFAULT_FROM})")
    parser.add_argument("--to-date", default=DEFAULT_TO, help=f"End date (default: {DEFAULT_TO})")
    parser.add_argument("--skip-resume-check", action="store_true", help="Force re-fetch even if data exists")
    parser.add_argument("--cooldown", type=int, default=60, help="Seconds to wait between API calls per worker (default: 60)")
    args = parser.parse_args()

    print("=" * 60)
    print("📦 STOCK DATA ARCHIVER")
    print(f"   Range: {args.from_date} → {args.to_date}")
    print(f"   Cooldown: {args.cooldown}s per key between fetches")
    print("=" * 60)

    # ── Step 1: Connect to Infisical ──
    print("\n🔐 Step 1: Connecting to Infisical...")
    infisical = InfisicalClient()
    if not infisical.is_connected:
        print("❌ Cannot proceed without Infisical. Exiting.")
        sys.exit(1)

    # ── Step 2: Fetch API keys ──
    print("\n🔑 Step 2: Fetching Massive API keys...")
    massive_keys = infisical.get_massive_keys()
    if not massive_keys:
        print("❌ No Massive API keys found. Exiting.")
        sys.exit(1)
    print(f"   Found {len(massive_keys)} API keys.")

    # ── Step 3: Connect to Turso ──
    print("\n🗄️  Step 3: Connecting to Turso databases...")
    source_creds = infisical.get_source_creds()
    target_creds = infisical.get_target_creds()

    if not source_creds.get("url") or not target_creds.get("url"):
        print("❌ Missing Source or Target Turso credentials in Infisical. Exiting.")
        sys.exit(1)
    
    source_writer = TursoWriter(url=source_creds["url"], token=source_creds["token"])

    # ── Step 4: Discover tickers ──
    print("\n📊 Step 4: Discovering tickers from aw_ticker_notes + SPY...")
    ticker_pairs = source_writer.get_massive_tickers()
    if not ticker_pairs:
        print("❌ No tickers found. Exiting.")
        source_writer.close()
        sys.exit(1)
    
    print(f"   Found {len(ticker_pairs)} tickers:")
    for display, massive in ticker_pairs:
        tag = f" (→ {massive})" if display != massive else ""
        print(f"      • {display}{tag}")

    # ── Step 5: Initialize Massive fetcher ──
    print("\n🚀 Step 5: Initializing Massive fetcher...")
    fetcher = MassiveFetcher(api_keys=massive_keys)

    # ── Step 6: Generate date range ──
    dates = generate_date_range(args.from_date, args.to_date)
    total_days = len(dates)
    total_tasks = total_days * len(ticker_pairs)
    num_workers = min(len(massive_keys), total_days)
    print(f"\n📅 {total_days} trading days × {len(ticker_pairs)} tickers = {total_tasks} fetch tasks")

    # ── Step 7: Worker-Per-Day Parallel Backfill ──
    print("\n" + "=" * 60)
    print("🏁 STARTING PARALLEL BACKFILL")
    print(f"   Workers:  {num_workers} (1 dedicated key each)")
    print(f"   Cooldown: {args.cooldown}s between fetches per worker")
    print(f"   Strategy: Each worker processes ALL tickers for a day,")
    print(f"             then picks the next available day from the queue.")
    print("=" * 60)

    # Day queue — workers pull from this when they finish a day
    day_queue = queue.Queue()
    for date_str in dates:
        day_queue.put(date_str)

    # Shared progress counters (only accessed under counter_lock)
    counter_lock = threading.Lock()
    stats = {
        "completed": 0,
        "skipped": 0,
        "failed": 0,
        "total_bars": 0,
        "days_done": 0,
    }
    start_time = time.time()

    def worker_fn(worker_id: int):
        """
        Worker thread function. Each worker:
        1. Pulls a day from the queue
        2. Processes ALL tickers for that day sequentially
        3. Waits 60s between each API call
        4. When the day is done, pulls the next day
        5. Exits when the queue is empty
        """
        # Each worker gets its own Turso connection (no lock needed for writes)
        local_writer = TursoWriter(url=target_creds["url"], token=target_creds["token"])
        
        try:
            while True:
                # Pull the next available day
                try:
                    date_str = day_queue.get_nowait()
                except queue.Empty:
                    break  # No more days — worker is done
                
                print(f"\n  🔑 Worker {worker_id} (Key {worker_id + 1}/{len(massive_keys)}) → {date_str}")
                last_fetch_time = 0.0  # Tracks when the last API call was made
                
                for display_name, massive_ticker in ticker_pairs:
                    # ── Resume Check (no API call → no cooldown needed) ──
                    if not args.skip_resume_check:
                        existing = local_writer.check_day_exists(display_name, date_str)
                        if existing > 0:
                            with counter_lock:
                                stats["completed"] += 1
                                stats["skipped"] += 1
                            print(f"    ⏭️  W{worker_id} {display_name} ({date_str}): {existing} rows exist")
                            continue

                    # ── Enforce Cooldown (60s since last API call) ──
                    if last_fetch_time > 0:
                        elapsed = time.time() - last_fetch_time
                        if elapsed < args.cooldown:
                            remaining = args.cooldown - elapsed
                            print(f"    ⏳ W{worker_id}: Waiting {remaining:.0f}s before {display_name}...")
                            time.sleep(remaining)

                    # ── Fetch from Polygon (starts the cooldown timer) ──
                    last_fetch_time = time.time()
                    bars = fetcher.fetch_day(worker_id, massive_ticker, date_str)
                    
                    if not bars:
                        with counter_lock:
                            stats["completed"] += 1
                        print(f"    ⚠️  W{worker_id} {display_name} ({date_str}): No data")
                        continue

                    # ── Write to Turso ──
                    for bar in bars:
                        bar["symbol"] = display_name

                    try:
                        count = local_writer.upsert_bars(bars)
                        with counter_lock:
                            stats["total_bars"] += count
                            stats["completed"] += 1
                            elapsed_total = time.time() - start_time
                            rate = stats["completed"] / elapsed_total if elapsed_total > 0 else 0
                            eta_mins = (total_tasks - stats["completed"]) / rate / 60 if rate > 0 else 0
                        print(f"    ✅ W{worker_id} {display_name} ({date_str}): {count} bars [{stats['completed']}/{total_tasks}] ETA: {eta_mins:.0f}m")
                    except Exception as e:
                        with counter_lock:
                            stats["completed"] += 1
                            stats["failed"] += 1
                        print(f"    ❌ W{worker_id} {display_name} ({date_str}): {e}")

                # Day is fully processed
                with counter_lock:
                    stats["days_done"] += 1
                print(f"  ✅ Worker {worker_id} finished {date_str} ({stats['days_done']}/{total_days} days done)")

        finally:
            local_writer.close()

    # Launch workers — one per key, capped at the number of days
    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures = [executor.submit(worker_fn, i) for i in range(num_workers)]
        for f in as_completed(futures):
            try:
                f.result()
            except Exception as e:
                print(f"❌ Worker crashed: {e}")

    # ── Summary ──
    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print("📊 BACKFILL COMPLETE")
    print(f"   Total bars written:  {stats['total_bars']:,}")
    print(f"   Days processed:      {stats['days_done']}")
    print(f"   Tasks completed:     {stats['completed']}")
    print(f"   Tasks skipped:       {stats['skipped']} (resume)")
    print(f"   Tasks failed:        {stats['failed']}")
    print(f"   Time elapsed:        {elapsed / 60:.1f} minutes")
    print("=" * 60)

    source_writer.close()


if __name__ == "__main__":
    main()
