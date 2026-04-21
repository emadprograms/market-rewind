"""
Stock Data Archiver — Main Entry Point
=======================================
Backfills historical 1-minute OHLCV data from Massive (Polygon.io) 
into the Turso database for use with Market Rewind.

Usage:
    python stock_data_archiver/main.py                          # Full run: Oct 2025 → Jan 2026
    python stock_data_archiver/main.py --from-date 2025-10-01 --to-date 2025-10-01   # Single day test
"""
import sys
import os
import argparse
import time
from datetime import datetime, timedelta

# Ensure the package directory is on the path so config, etc. can be imported
sys.path.insert(0, os.path.dirname(__file__))

from config import DEFAULT_FROM, DEFAULT_TO
from infisical_client import InfisicalClient
from massive_fetcher import MassiveFetcher
from turso_writer import TursoWriter


def generate_date_range(from_date: str, to_date: str) -> list[str]:
    """Generates a list of 'YYYY-MM-DD' strings for each calendar day in the range (inclusive)."""
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
    args = parser.parse_args()

    print("=" * 60)
    print("📦 STOCK DATA ARCHIVER")
    print(f"   Range: {args.from_date} → {args.to_date}")
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
    print("\n🗄️  Step 3: Connecting to Turso database...")
    turso_creds = infisical.get_turso_creds()
    if not turso_creds.get("url") or not turso_creds.get("token"):
        print("❌ Missing Turso credentials in Infisical. Exiting.")
        sys.exit(1)
    
    writer = TursoWriter(url=turso_creds["url"], token=turso_creds["token"])

    # ── Step 4: Discover tickers from symbol_map ──
    print("\n📊 Step 4: Reading symbol_map for Massive-eligible tickers...")
    ticker_pairs = writer.get_massive_tickers()
    if not ticker_pairs:
        print("❌ No tickers with massive_ticker found in symbol_map. Exiting.")
        writer.close()
        sys.exit(1)
    
    print(f"   Found {len(ticker_pairs)} tickers:")
    for display, massive in ticker_pairs:
        tag = f" (→ {massive})" if display != massive else ""
        print(f"      • {display}{tag}")

    # ── Step 5: Initialize Massive fetcher ──
    print("\n🚀 Step 5: Initializing Massive fetcher...")
    fetcher = MassiveFetcher(massive_keys)

    # ── Step 6: Generate date range ──
    dates = generate_date_range(args.from_date, args.to_date)
    total_days = len(dates)
    total_tasks = total_days * len(ticker_pairs)
    print(f"\n📅 {total_days} trading days × {len(ticker_pairs)} tickers = {total_tasks} fetch tasks")

    # ── Step 7: Main loop — Day by Day, Ticker by Ticker ──
    print("\n" + "=" * 60)
    print("🏁 STARTING BACKFILL")
    print("=" * 60)

    completed = 0
    skipped = 0
    failed = 0
    total_bars = 0
    start_time = time.time()

    for day_idx, date_str in enumerate(dates, 1):
        print(f"\n📅 [{day_idx}/{total_days}] {date_str}")
        
        for display_name, massive_ticker in ticker_pairs:
            completed += 1
            
            # Resume check: skip if data already exists
            if not args.skip_resume_check:
                existing = writer.check_day_exists(display_name, date_str)
                if existing > 0:
                    print(f"   ⏭️  {display_name}: {existing} rows already exist. Skipping.")
                    skipped += 1
                    continue

            # Fetch from Polygon
            bars = fetcher.fetch_day(massive_ticker, date_str)
            
            if not bars:
                print(f"   ⚠️  {display_name}: No data returned (holiday/no trading?).")
                continue

            # Override symbol to display_name (e.g. massive might be "SPY" but display is "SPY")
            for bar in bars:
                bar["symbol"] = display_name

            # Write to Turso
            try:
                count = writer.upsert_bars(bars)
                total_bars += count
                elapsed = time.time() - start_time
                rate = completed / elapsed if elapsed > 0 else 0
                eta_mins = (total_tasks - completed) / rate / 60 if rate > 0 else 0
                print(f"   ✅ {display_name}: {count} bars written. [{completed}/{total_tasks}] ETA: {eta_mins:.0f}m")
            except Exception as e:
                failed += 1
                print(f"   ❌ {display_name}: Write failed: {e}")

    # ── Summary ──
    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print("📊 BACKFILL COMPLETE")
    print(f"   Total bars written:  {total_bars:,}")
    print(f"   Days processed:      {total_days}")
    print(f"   Tasks completed:     {completed}")
    print(f"   Tasks skipped:       {skipped} (resume)")
    print(f"   Tasks failed:        {failed}")
    print(f"   Time elapsed:        {elapsed / 60:.1f} minutes")
    print("=" * 60)

    writer.close()


if __name__ == "__main__":
    main()
