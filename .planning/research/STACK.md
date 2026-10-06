# Technology Stack: Partitioned Parquet Tick Lake Integration

**Milestone:** v5.0
**Domain:** High-Frequency Tick Replay & Financial Time-Series Storage
**Date:** 2026-10-06

---

## 1. Core Stack Additions & Changes

| Layer | Existing (v4.3) | New (v5.0) | Rationale |
|---|---|---|---|
| **Storage Engine** | Single disk-backed DuckDB file (`streaming.duckdb`) | Partitioned Parquet Tick Lake (`ticks/symbol=*/date=*/*.parquet`) | `data-harvester` v5.0 permanently deleted disk `.duckdb` files. Parquet files provide immutable, lock-free micro-batch storage. |
| **Reader Connection** | File connection `duckdb.connect(db_path, read_only=True)` | Ephemeral in-memory connection `duckdb.connect(":memory:")` | Eliminates file locking collisions (`duckdb.IOException: Could not set lock on file`) and permits unbounded concurrent reader threads. |
| **Parquet Scanner** | Internal table scans `FROM ticks` | Vectorized DuckDB Parquet scanner `FROM read_parquet(?, hive_partitioning=false)` | Reads pruned lists of Parquet batch files directly into memory at C++ SIMD speed. |
| **Partition Resolver** | SQL `WHERE symbol = ?` over unified table | Filesystem-level partition directory resolution and date filtering | Bypasses unnecessary filesystem traversal; queries only relevant `date=YYYY-MM-DD` partitions. |
| **Symbol Encoding** | Unmodified strings | Percent-encoding uppercase hex for `[^A-Za-z0-9_-]` (e.g., `BRK.B` -> `BRK%2EB`) | Strictly adheres to Hive directory naming convention specified in Repo B Read Contract v1.5.0. |
| **Python Dependencies** | `duckdb>=1.0.0`, `aiohttp>=3.8.0`, `pytest` | Same (`duckdb>=1.0.0`, `pyarrow>=14.0.0` optional) with **ZERO** `data-harvester` library imports | Contract mandate: Downstream consumer must have zero dependency on `data-harvester/src`. |

---

## 2. Component Specifications

### DuckDB In-Memory Execution
- **Version:** `duckdb >= 1.0.0` (installed in `.venv`: DuckDB 1.1.x+)
- **Session Primitives:**
  ```python
  con = duckdb.connect(":memory:")
  con.execute("SET TimeZone = 'UTC'")
  con.execute("SET threads = 4")
  con.execute("SET max_memory = '2GB'")
  ```
- **Query Paradigm:**
  - Resolve candidate parquet file paths using `Path.glob()` over `ticks/symbol=<ENCODED_SYMBOL>/date=<YYYY-MM-DD>/*.parquet`.
  - Pass the explicit list of file paths as parameter `?` to `read_parquet(?, hive_partitioning=false)`.
  - Always close the connection in a `finally` block or context manager.

### Partition Directory & Lake Root Resolution
- **Environment Variables:**
  - `TICK_LAKE_ROOT`: Primary override pointing to root directory of tick lake.
  - `DATA_DIR`: Fallback pointing to base directory containing `tick_lake`.
- **Precedence Order:**
  1. Explicit constructor argument `lake_root`.
  2. `os.environ.get("TICK_LAKE_ROOT")`.
  3. `os.environ.get("DATA_DIR") / "tick_lake"`.
  4. Relative repository path: `ROOT_DIR.parent / "data-harvester" / "data" / "tick_lake"`.
  5. Fallback path: `/Volumes/Micron-E 0256 A/data-harvester/data/tick_lake` (if mounted).
- **Metadata Contract:**
  - Inspect `lake.json` at root to verify `format == "tick_lake"` and `schema_version in compatible_versions`.

---

## 3. Libraries & Dependencies

- **`duckdb`**: Core query execution engine for dynamic `time_bucket()` candle resampling, tape pagination, and symbol summaries.
- **`pathlib.Path`**: Filesystem traversal, partition path construction, and maintenance guard polling.
- **`aiohttp`**: Async HTTP server and WebSocket transport serving Market Rewind UI.
- **`pytest` & `pytest-aiohttp`**: Comprehensive backend integration test suite.
