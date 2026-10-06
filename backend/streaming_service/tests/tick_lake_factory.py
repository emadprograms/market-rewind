"""Deterministic synthetic tick-lake generator for Market Rewind backend tests.

Implements the on-disk layout of the Repo B Tick Lake Read Contract v1.5.0
(`docs/contracts/repo_b_tick_lake_contract.md` §2, §3.2):

    <root>/lake.json
    <root>/ticks/symbol=<ENCODED_SYMBOL>/date=<YYYY-MM-DD>/*.parquet
    <root>/_maintenance/in_progress.json      (optional guard file)
    <root>/_staging/...                       (decoy tree that must never be queried)

This module intentionally does **not** import the reader under test so fixtures
cannot mask implementation defects.

Physical schema v1 column set (contract §3.2):
    timestamp TIMESTAMP(us) naive UTC, symbol dictionary<utf8> str,
    price f64, volume f64?, bid f64?, ask f64?, source str, session str, ingest_id str
Schema v2 (contract §3, the deferred `quote_rewrite` target):
    timestamp, symbol, bid_price, ask_price, source, session, ingest_id
"""
from __future__ import annotations

import json
import os
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

import pyarrow as pa
import pyarrow.parquet as pq

# Independent copy of the contract safe set ([A-Za-z0-9_-]) so encoding tests
# in fixtures and implementation are cross-checked rather than shared.
SAFE_SYMBOL_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
)

SCHEMA_V1_COLUMNS = (
    "timestamp", "symbol", "price", "volume", "bid", "ask", "source", "session", "ingest_id",
)
SCHEMA_V2_COLUMNS = (
    "timestamp", "symbol", "bid_price", "ask_price", "source", "session", "ingest_id",
)

#: Symbol/date matrix for the standard mini lake. Includes symbols that require
#: percent-encoded partition directory names (period, slash).
DEFAULT_SYMBOLS: Dict[str, Dict[str, Any]] = {
    "AAPL": {"base": 190.0, "days": ["2026-10-02", "2026-10-03"]},
    "NVDA": {"base": 120.0, "days": ["2026-10-02"]},
    "BRK.B": {"base": 450.0, "days": ["2026-10-02"]},
    "EUR/USD": {"base": 1.08, "days": ["2026-10-02", "2026-10-05"]},
    "JPM": {"base": 210.0, "days": ["2026-10-03", "2026-10-04"]},
}


#: Optional sandbox-resident lake, equal to the discovery candidate
#: `<repo>/../data-harvester/data/tick_lake` on the sandbox layout. Overridable via
#: `MR_SANDBOX_LAKE_ROOT`; fixtures skip (never fail) when the path is unavailable.
SANDBOX_LAKE_ROOT = Path(
    os.environ.get("MR_SANDBOX_LAKE_ROOT", "/home/user/data-harvester/data/tick_lake")
)


def encode_symbol(symbol: str) -> str:
    """Contract §2.2 / §4.1 encoding (uppercase percent-encoding, byte-by-byte)."""
    encoded: List[str] = []
    for ch in symbol:
        if ch in SAFE_SYMBOL_CHARS:
            encoded.append(ch)
        else:
            encoded.extend(f"%{byte:02X}" for byte in ch.encode("utf-8"))
    return "".join(encoded)


def write_lake_json(
    root: Path,
    *,
    fmt: str = "tick_lake",
    schema_version: int = 1,
    compatible_versions: Sequence[int] = (1,),
    extra: Optional[Dict[str, Any]] = None,
) -> Path:
    """Write `<root>/lake.json` (contract §7.1)."""
    root.mkdir(parents=True, exist_ok=True)
    payload: Dict[str, Any] = {
        "format": fmt,
        "schema_version": schema_version,
        "compatible_versions": list(compatible_versions),
        "created_at": "2026-10-02T00:00:00Z",
        "producer": "market-rewind-test-fixtures",
    }
    if extra:
        payload.update(extra)
    path = root / "lake.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def session_for(ts: datetime) -> str:
    """US-equity session tag from a naive UTC timestamp (DST approximation is
    irrelevant for fixtures; the contract only requires the tag, §3.2)."""
    minutes = ts.hour * 60 + ts.minute
    if minutes < 13 * 60 + 30:
        return "PRE"
    if minutes < 20 * 60:
        return "REG"
    return "POST"


def generate_ticks(
    symbol: str,
    day: str,
    base: float,
    *,
    count: int = 60,
    start_utc: str = "12:00:00",
    seed: int = 1337,
) -> List[Dict[str, Any]]:
    """Deterministic, contract-shaped tick rows for one symbol/date partition.

    Guarantees exercised by fixtures:
      * rows sorted by (timestamp, ingest_id)              (contract §3.3)
      * duplicate timestamps with distinct ingest_id       (contract §3.4)
      * NULL volume rows that coalesce to 1.0              (contract §3.4)
      * PRE / REG / POST session tags                      (contract §3.2)
    """
    rng = random.Random(f"{seed}:{symbol}:{day}")
    hour, minute, second = (int(x) for x in start_utc.split(":"))
    cursor = datetime.fromisoformat(f"{day}T{start_utc}")
    price = base
    rows: List[Dict[str, Any]] = []
    seq = 0

    for i in range(count):
        price = max(0.5, price * (1 + rng.uniform(-0.0008, 0.0008)))
        bid = round(price - 0.01, 6)
        ask = round(price + 0.01, 6)
        seq += 1
        ingest_id = f"w1_{int(cursor.timestamp() * 1_000_000)}_{seq:04d}"
        rows.append(
            {
                "timestamp": cursor,
                "symbol": symbol,
                "price": round(price, 6),
                "volume": None if i % 17 == 0 else round(rng.uniform(1.0, 40.0), 2),
                "bid": bid,
                "ask": ask,
                "source": "CAPITAL" if symbol != "AAPL" else "DATABENTO",
                "session": session_for(cursor),
                "ingest_id": ingest_id,
            }
        )

        # every 25th tick duplicates the timestamp with a new ingest_id (§3.4)
        if i % 25 == 24:
            seq += 1
            rows.append(
                {
                    "timestamp": cursor,
                    "symbol": symbol,
                    "price": round(price * (1 + rng.uniform(-0.0005, 0.0005)), 6),
                    "volume": round(rng.uniform(1.0, 10.0), 2),
                    "bid": bid,
                    "ask": ask,
                    "source": "CAPITAL",
                    "session": session_for(cursor),
                    "ingest_id": f"w1_{int(cursor.timestamp() * 1_000_000)}_{seq:04d}",
                }
            )

        step = rng.choice([timedelta(seconds=1)] * 6 + [timedelta(seconds=2), timedelta(seconds=5)])
        cursor = cursor + step

    rows.sort(key=lambda r: (r["timestamp"], r["ingest_id"]))
    return rows


def _arrow_table(rows: Sequence[Dict[str, Any]], schema: str) -> pa.Table:
    if schema == "v2":
        arrays = {
            "timestamp": pa.array([r["timestamp"] for r in rows], type=pa.timestamp("us")),
            "symbol": pa.array([r["symbol"] for r in rows]).dictionary_encode(),
            "bid_price": pa.array([r.get("bid_price", r.get("bid")) for r in rows], type=pa.float64()),
            "ask_price": pa.array([r.get("ask_price", r.get("ask")) for r in rows], type=pa.float64()),
            "source": pa.array([r["source"] for r in rows], type=pa.string()),
            "session": pa.array([r["session"] for r in rows], type=pa.string()),
            "ingest_id": pa.array([r["ingest_id"] for r in rows], type=pa.string()),
        }
        return pa.table(arrays)
    arrays = {
        "timestamp": pa.array([r["timestamp"] for r in rows], type=pa.timestamp("us")),
        # contract §3.2: symbol is physically dictionary-encoded
        "symbol": pa.array([r["symbol"] for r in rows]).dictionary_encode(),
        "price": pa.array([r["price"] for r in rows], type=pa.float64()),
        "volume": pa.array([r["volume"] for r in rows], type=pa.float64()),
        "bid": pa.array([r["bid"] for r in rows], type=pa.float64()),
        "ask": pa.array([r["ask"] for r in rows], type=pa.float64()),
        "source": pa.array([r["source"] for r in rows], type=pa.string()),
        "session": pa.array([r["session"] for r in rows], type=pa.string()),
        "ingest_id": pa.array([r["ingest_id"] for r in rows], type=pa.string()),
    }
    return pa.table(arrays)


def partition_dir(root: Path, symbol: str, day: str) -> Path:
    return root / "ticks" / f"symbol={encode_symbol(symbol.upper())}" / f"date={day}"


def write_partition(
    root: Path,
    symbol: str,
    day: str,
    rows: Sequence[Dict[str, Any]],
    *,
    filename: str = "batch_writer_1_000001.parquet",
    schema: str = "v1",
) -> Path:
    """Write one Parquet micro-batch into the correct encoded partition dir."""
    target = partition_dir(root, symbol, day)
    target.mkdir(parents=True, exist_ok=True)
    path = target / filename
    pq.write_table(_arrow_table(rows, schema), path)
    return path


def write_partition_raw(
    root: Path,
    symbol_dir: str,
    day: str,
    rows: Sequence[Dict[str, Any]],
    filename: str,
    *,
    schema: str = "v1",
) -> Path:
    """Write a partition using a *literal* symbol directory name (decoys/tests only).

    Used to plant unencoded (`symbol=BRK.B`) or staging-located files that
    contract-compliant pruning must never read.
    """
    target = root / "ticks" / symbol_dir / f"date={day}"
    target.mkdir(parents=True, exist_ok=True)
    path = target / filename
    pq.write_table(_arrow_table(rows, schema), path)
    return path


def build_mini_lake(
    root: Path,
    *,
    symbols: Optional[Dict[str, Dict[str, Any]]] = None,
    count: int = 60,
    seed: int = 1337,
    lake_json: bool = True,
) -> Path:
    """Build a complete, deterministic mini lake and return its root."""
    root = Path(root)
    if lake_json:
        write_lake_json(root)
    spec = symbols if symbols is not None else DEFAULT_SYMBOLS
    for symbol, info in spec.items():
        for i, day in enumerate(info["days"]):
            rows = generate_ticks(symbol, day, info["base"], count=count, seed=seed)
            write_partition(
                root,
                symbol,
                day,
                rows,
                filename=f"batch_writer_1_{i + 1:06d}.parquet",
            )
            # second, migrated-historical-style chunk on the first day
            if i == 0 and len(rows) > 10:
                write_partition(
                    root,
                    symbol,
                    day,
                    rows[:10],
                    filename="chunk_000001.parquet",
                )
    return root


def add_staging_decoy(root: Path, symbol: str = "AAPL", day: str = "2026-10-02") -> Path:
    """Create a parquet file under `_staging/` that must never be read (contract §2.3)."""
    rows = generate_ticks(symbol, day, 1.0, count=5)
    target = root / "_staging" / "ticks" / f"symbol={encode_symbol(symbol.upper())}" / f"date={day}"
    target.mkdir(parents=True, exist_ok=True)
    path = target / ".tmp_partial.parquet"
    pq.write_table(_arrow_table(rows, "v1"), path)
    return path


def mark_maintenance(root: Path) -> Path:
    """Create the maintenance guard file (contract §6.1)."""
    target = root / "_maintenance"
    target.mkdir(parents=True, exist_ok=True)
    path = target / "in_progress.json"
    path.write_text(json.dumps({"task": "compaction", "started_at": "2026-10-06T03:00:00Z"}), encoding="utf-8")
    return path


def corrupt_lake_json(root: Path) -> Path:
    """Write an unparseable lake.json."""
    root.mkdir(parents=True, exist_ok=True)
    path = root / "lake.json"
    path.write_text("{ this is not valid json ", encoding="utf-8")
    return path


def build_persistent_lake(root: Path, *, count: int = 240, seed: int = 20261006) -> Path:
    """Build the larger sandbox-resident mini lake used for integration tests.

    Slightly richer than the hermetic fixtures: more ticks per partition plus a
    decoy staging tree and control-plane noise.
    """
    root = Path(root)
    build_mini_lake(root, count=count, seed=seed)
    add_staging_decoy(root)
    control = root / "_control"
    control.mkdir(parents=True, exist_ok=True)
    (control / "registry.json").write_text(
        json.dumps({"version": 1, "active": list(DEFAULT_SYMBOLS.keys())}), encoding="utf-8"
    )
    return root
