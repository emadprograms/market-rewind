# Pitfalls & Mitigations: Partitioned Parquet Tick Lake Integration

**Milestone:** v5.0
**Domain:** High-Frequency Tick Replay & Quantitative Data Pipeline
**Date:** 2026-10-06

---

## 1. Critical Pitfalls & Mitigations

### 1. Recursive Root Globbing
- **Pitfall:** Using `Path(lake_root).glob("**/*.parquet")` or DuckDB recursive scans across `<TICK_LAKE_ROOT>/`.
- **Consequence:** Scans traverse `_staging/` (incomplete `.tmp` files with missing footers), `_maintenance/` (staged compacted files or retired copies), and `_migration/` (historical chunks), corrupting queries and causing `FileNotFoundError` or duplicate counts.
- **Mitigation:** Only scan the active `ticks/` subtree. Always prune at the Python filesystem level down to specific symbol and date directories: `ticks/symbol=<ENCODED_SYMBOL>/date=<YYYY-MM-DD>/*.parquet`.

### 2. Symbol Encoding Mismatch
- **Pitfall:** Directly querying directory paths with unencoded tickers like `symbol=BRK.B` or `symbol=EUR/USD`.
- **Consequence:** Directory not found, returning empty data without error.
- **Mitigation:** Safe set is strictly `[A-Za-z0-9_-]`. The period (`.`), forward slash (`/`), space, etc. MUST be uppercase percent-encoded byte-by-byte (e.g. `BRK.B` -> `BRK%2EB`). Implement `encode_symbol()` and enforce it across all path resolution logic.

### 3. File Disappearance Mid-Query (Snapshot Race)
- **Pitfall:** A file is resolved by Python, but compaction or maintenance moves or deletes it before DuckDB executes `read_parquet(?)`.
- **Consequence:** DuckDB raises `duckdb.IOException: No files found that match the pattern "..."`.
- **Mitigation:**
  1. Inspect `_maintenance/in_progress.json` before querying; if active, fail fast or retry with backoff.
  2. If `duckdb.IOException` occurs, immediately re-resolve the partition directory (to capture newly compacted files) and retry the query once before bubbling the error.

### 4. Arrow Schema Incompatibility on Dictionary Encoding
- **Pitfall:** Setting `hive_partitioning=true` in `read_parquet` or inferring Hive schema in PyArrow.
- **Consequence:** The physical Parquet files already contain a dictionary-encoded `symbol` column (`dictionary<values=string, indices=int32>`). Inferring Hive partitioning generates a conflicting plain `string` partition column, crashing with `ArrowTypeError: Field symbol has incompatible types`.
- **Mitigation:** Always query with `hive_partitioning=false` when calling DuckDB `read_parquet(?, hive_partitioning=false)`.

### 5. Memory Exhaustion on Unbounded Queries
- **Pitfall:** Opening `duckdb.connect(":memory:")` without thread or memory limits, or scanning months of data in one query.
- **Consequence:** Out-of-memory crash (OOM) on large multi-symbol or multi-month historical scans.
- **Mitigation:**
  - Execute `SET threads = 4` and `SET max_memory = '2GB'` on every connection.
  - Require explicit date boundaries and clamp query limits (e.g., max 15,000 candles or 100,000 ticks).

### 6. Dual Schema (v1 vs v2) Column Differences
- **Pitfall:** Hardcoding SQL `SELECT price, volume FROM read_parquet(?)` when querying new Schema v2 rows that store `bid_price` and `ask_price`.
- **Consequence:** DuckDB raises `Binder Error: Referenced column "price" not found in file`.
- **Mitigation:** Inspect schema or use DuckDB SQL expression handling / fallback queries:
  - If `bid_price` is present and `price` is null/absent, compute candle values from `COALESCE(price, bid_price)`.
  - For Schema v1 files, use `price` and `COALESCE(volume, 1.0)`.

### 7. Stray Imports from `data-harvester`
- **Pitfall:** Importing classes or utilities from `data-harvester/src/` (e.g., `from src.storage.config import ...`).
- **Consequence:** Violates the fundamental Repo B Read Contract requirement: zero dependencies on data-harvester internals. Breaks if repos are run independently, containerized, or deployed to separate hosts.
- **Mitigation:** All lake reader functions, encoders, and exceptions must be entirely self-contained inside `backend/streaming_service/`.
