"""Standalone, zero-dependency reader core for the Partitioned Parquet Tick Lake.

Implements Market Rewind's side of the **Repo B Tick Lake Read Contract v1.5.0**
(`docs/contracts/repo_b_tick_lake_contract.md`):

* **Zero library imports** from the Data Harvester repository (§1.4) — this module uses
  only the Python standard library.
* **Query root is ``<lake_root>/ticks/`` only** (§2.1/§2.3): ``_staging/``, ``_maintenance/``,
  ``_migration/`` and ``_control/`` are never traversed.
* **Canonical symbol encoding** (§2.2): the safe set is ``[A-Za-z0-9_-]``; every other
  character is percent-encoded byte-by-byte with uppercase hex, so ``BRK.B`` lives in
  ``symbol=BRK%2EB/`` and an unencoded lookup silently matches nothing.
* **Filesystem partition pruning** (§2.3): partitions are resolved in Python by symbol and
  UTC event date before any query executes; an empty match returns ``[]`` without DuckDB.
* **Structured errors** (§7.1): ``LakeUnavailableError``, ``LakeCorruptedMetadataError``,
  ``LakeIncompatibleSchemaError`` and ``LakeMaintenanceInProgressError``, all rooted at
  ``LakeReaderError``.
* **Maintenance guard** (§6.1): ``_maintenance/in_progress.json`` blocks execution.

Phase 39 delivered root discovery, metadata validation, symbol encoding, partition
pruning and the maintenance guard. Phase 40 layers the query engine on top (§3.4, §4.1):

* **Isolated in-memory DuckDB sessions** (``:memory:`` with ``threads = 4``,
  ``max_memory = '2GB'``, ``TimeZone = 'UTC'``) — no disk database, no locks.
* **Deterministic OHLCV resampling** via ``time_bucket`` plus ``arg_min``/``arg_max``
  over the ``(timestamp, ingest_id)`` tuple key.
* **Dual schema ingestion**: schema v1 files use ``price``; schema v2 rows use
  ``bid_price``; heterogeneous file sets are coalesced with ``union_by_name``.
* **Daily RTH isolation** for ``1d`` candles (``session = 'REG'``).
* **Retry-once on ``duckdb.IOException``** with re-resolution (§7.3.3).
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, time as _time, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple, Union

import duckdb

__all__ = [
    "SAFE_SYMBOL_CHARS",
    "LAKE_FORMAT",
    "DEFAULT_COMPATIBLE_VERSIONS",
    "LakeReaderError",
    "LakeUnavailableError",
    "LakeCorruptedMetadataError",
    "LakeIncompatibleSchemaError",
    "LakeMaintenanceInProgressError",
    "encode_symbol",
    "decode_symbol",
    "TickLakeReader",
    "default_lake_root_candidates",
]

# --------------------------------------------------------------------------- #
# Constants (contract §2.2, §7.1)
# --------------------------------------------------------------------------- #

#: Contract §2.2 — only these characters survive partition-directory encoding.
SAFE_SYMBOL_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
)

#: Contract §7.1 — ``lake.json`` declares ``format = "tick_lake"``.
LAKE_FORMAT = "tick_lake"

#: Contract §7.1 — ``compatible_versions = [1]``; the deferred rewrite raises this.
DEFAULT_COMPATIBLE_VERSIONS = (1,)

LAKE_METADATA_FILENAME = "lake.json"
TICKS_DIRNAME = "ticks"
SYMBOL_PREFIX = "symbol="
DATE_PREFIX = "date="
MAINTENANCE_GUARD_PARTS = ("_maintenance", "in_progress.json")
PARQUET_GLOB = "*.parquet"

#: Contract §2.2 canonical date-partition name: ``date=<YYYY-MM-DD>``. Applied strictly
#: because ``date.fromisoformat`` also accepts ``20261002`` and ISO-week names such as
#: ``2026-W40-1``, which must never be folded into a query.
DATE_DIR_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: Timeframe → DuckDB interval literal. Mirrors the retired service's map (1s .. 1d);
#: an unknown timeframe falls back to ``1 minute`` for API compatibility.
INTERVAL_MAP: Dict[str, str] = {
    "1s": "1 second",
    "5s": "5 seconds",
    "15s": "15 seconds",
    "30s": "30 seconds",
    "1m": "1 minute",
    "3m": "3 minutes",
    "5m": "5 minutes",
    "15m": "15 minutes",
    "30m": "30 minutes",
    "1h": "1 hour",
    "4h": "4 hours",
    "1d": "1 day",
}
DEFAULT_INTERVAL = "1 minute"

#: Timeframes whose candles are daily (Regular Trading Hours policy applies).
DAILY_TIMEFRAMES = frozenset({"1d", "1 day"})

#: DuckDB session bounds (contract §4.1 / LAKE-RESAMPLE-01).
DEFAULT_THREADS = 4
DEFAULT_MAX_MEMORY = "2GB"

#: Result clamps mirroring the retired service (and bounding memory per query).
MAX_CANDLE_LIMIT = 50000
MAX_TICK_LIMIT = 100000
MAX_TAPE_LIMIT = 100000

_MEMORY_LIMIT_PATTERN = re.compile(r"^\d+(\.\d+)?\s*(KB|MB|GB|TB)$", re.IGNORECASE)

#: Repository root (``<repo>/backend/streaming_service/tick_lake_reader.py`` → ``<repo>``).
ROOT_DIR = Path(__file__).resolve().parent.parent.parent

#: Historical default data location on developer machines: ``<repo>/../data-harvester/data``.
DEFAULT_DATA_HARVESTER_DIR = ROOT_DIR.parent / "data-harvester" / "data"

#: External-volume fallback (contract note on mounted volumes; §2.1).
EXTERNAL_VOLUME_LAKE = Path("/Volumes/Micron-E 0256 A/data-harvester/data/tick_lake")

_HEX_DIGITS = frozenset("0123456789abcdefABCDEF")

DateLike = Union[str, date, datetime]


# --------------------------------------------------------------------------- #
# Structured error taxonomy (contract §7.1)
# --------------------------------------------------------------------------- #

class LakeReaderError(Exception):
    """Base class for every tick lake reader failure."""


class LakeUnavailableError(LakeReaderError):
    """Lake root is missing, unmounted, or not a directory."""


class LakeCorruptedMetadataError(LakeReaderError):
    """``lake.json`` is missing, unreadable, unparseable, or malformed."""


class LakeIncompatibleSchemaError(LakeReaderError):
    """``lake.json`` format is unrecognized or the schema version is incompatible."""


class LakeMaintenanceInProgressError(LakeReaderError):
    """``_maintenance/in_progress.json`` exists; readers must fail fast (contract §6.1)."""


# --------------------------------------------------------------------------- #
# Canonical symbol encoding (contract §2.2 / §4.1)
# --------------------------------------------------------------------------- #

def encode_symbol(symbol: str) -> str:
    """Encode a display symbol into its partition-directory form.

    Safe characters (``[A-Za-z0-9_-]``) pass through unchanged; everything else —
    including the period — is percent-encoded byte-by-byte with uppercase hex.
    ``BRK.B`` → ``BRK%2EB``; ``EUR/USD`` → ``EUR%2FUSD``.
    """
    encoded: List[str] = []
    for ch in symbol:
        if ch in SAFE_SYMBOL_CHARS:
            encoded.append(ch)
        else:
            encoded.extend(f"%{byte:02X}" for byte in ch.encode("utf-8"))
    return "".join(encoded)


def decode_symbol(encoded: str) -> str:
    """Inverse of :func:`encode_symbol`; accepts lowercase hex, rejects bad escapes."""
    decoded = bytearray()
    index = 0
    length = len(encoded)
    while index < length:
        ch = encoded[index]
        if ch == "%":
            escape = encoded[index + 1:index + 3]
            if len(escape) != 2 or any(digit not in _HEX_DIGITS for digit in escape):
                raise ValueError(f"Malformed percent-escape in symbol path: {encoded!r}")
            decoded.append(int(escape, 16))
            index += 3
        else:
            decoded.extend(ch.encode("utf-8"))
            index += 1
    try:
        return bytes(decoded).decode("utf-8")
    except UnicodeDecodeError as exc:  # pragma: no cover - defensive
        raise ValueError(f"Undecodable symbol path: {encoded!r}") from exc


# --------------------------------------------------------------------------- #
# Root discovery (contract §2.1; LAKE-READ-01)
# --------------------------------------------------------------------------- #

def default_lake_root_candidates() -> List[Path]:
    """Ordered fallback candidates when neither an argument nor ``TICK_LAKE_ROOT`` is given.

    Later candidates cover the repo-local ``data/tick_lake`` symlink, the historical
    sibling ``data-harvester`` checkout, and the mounted external volume.
    """
    candidates: List[Path] = []
    data_dir_env = os.environ.get("DATA_DIR")
    if data_dir_env:
        candidates.append(Path(data_dir_env).expanduser() / "tick_lake")
    candidates.extend(
        [
            DEFAULT_DATA_HARVESTER_DIR / "tick_lake",
            ROOT_DIR / "data" / "tick_lake",
            DEFAULT_DATA_HARVESTER_DIR / "tick_lake",
            EXTERNAL_VOLUME_LAKE,
        ]
    )
    ordered: List[Path] = []
    for candidate in candidates:
        if candidate not in ordered:
            ordered.append(candidate)
    return ordered


def _is_plain_int(value: Any) -> bool:
    """True for real integers; rejects ``bool`` (which is an ``int`` subclass in Python)."""
    return isinstance(value, int) and not isinstance(value, bool)


def _parse_partition_date(dir_name: str) -> Optional[date]:
    """Return the partition date for a canonical ``date=YYYY-MM-DD`` directory name.

    Non-canonical names (``date=20261002``, ``date=2026-W40-1``) return ``None`` so they
    are ignored rather than silently matched.
    """
    if not dir_name.startswith(DATE_PREFIX):
        return None
    text = dir_name[len(DATE_PREFIX):]
    if not DATE_DIR_PATTERN.match(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:  # pragma: no cover - regex already constrains the shape
        return None


def _to_utc_date(value: DateLike) -> date:
    """Normalize ``date``/``datetime``/ISO-string input to a UTC calendar date (§7.1)."""
    if isinstance(value, datetime):
        if value.tzinfo is not None and value.tzinfo.utcoffset(value) is not None:
            return value.astimezone(timezone.utc).date()
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return date.fromisoformat(text)
        return _to_utc_date(parsed)
    raise TypeError(f"Unsupported date value: {value!r} ({type(value).__name__})")


def _to_utc_datetime(value: Union[DateLike, datetime, None]) -> Optional[datetime]:
    """Normalize ``date``/``datetime``/ISO-string input to a naive UTC datetime (§7.1).

    Timezone-aware inputs are converted to UTC; naive inputs are taken as UTC. Strings may
    be ISO dates, naive ISO datetimes, or ``Z``/offset-suffixed datetimes.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None and value.tzinfo.utcoffset(value) is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
    if isinstance(value, date):
        return datetime.combine(value, _time.min)
    if isinstance(value, str):
        text = value.strip()
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return datetime.combine(date.fromisoformat(text), _time.min)
        return _to_utc_datetime(parsed)
    raise TypeError(f"Unsupported datetime value: {value!r} ({type(value).__name__})")


def _is_date_only(value: Any) -> bool:
    """True when the caller supplied a calendar date without a time-of-day component."""
    if isinstance(value, datetime):
        return False
    if isinstance(value, date):
        return True
    if isinstance(value, str):
        return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value.strip()))
    return False


def _end_boundary(value: Any) -> Tuple[Optional[datetime], Optional[datetime]]:
    """Normalize an end bound.

    A date-only end bound is inclusive of that whole UTC date (``< next midnight``); an
    explicit timestamp keeps the legacy ``<=`` semantics. Returns ``(inclusive, exclusive)``.
    """
    if value is None:
        return None, None
    if _is_date_only(value):
        day = _to_utc_datetime(value)
        return None, day + timedelta(days=1)
    return _to_utc_datetime(value), None


@dataclass(frozen=True)
class _Projection:
    """SQL expressions and read options derived from the resolved files' physical columns."""

    symbol_expr: str
    price_expr: str
    volume_expr: str
    bid_expr: str
    ask_expr: str
    source_expr: str
    session_expr: str
    ingest_id_expr: str
    has_symbol_column: bool
    has_session_column: bool
    has_ingest_id_column: bool
    union_by_name: bool
    schema_fingerprint: Tuple[str, ...]


def _parquet_row_count(path: Path) -> Optional[int]:
    """Row count from Parquet footer metadata only; ``None`` when unavailable."""
    try:
        import pyarrow.parquet as pq  # local import: optional fast path

        return int(pq.ParquetFile(str(path)).metadata.num_rows)
    except Exception:
        return None


def _sql_literal(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _coalesce_expr(primary: str, fallback: str) -> str:
    return f"coalesce({primary}, {fallback})"


# --------------------------------------------------------------------------- #
# Reader
# --------------------------------------------------------------------------- #

class TickLakeReader:
    """Fail-fast, read-only reader over the Partitioned Parquet Tick Lake."""

    def __init__(
        self,
        lake_root: Optional[Union[str, Path]] = None,
        *,
        expected_format: str = LAKE_FORMAT,
        compatible_versions: Sequence[int] = DEFAULT_COMPATIBLE_VERSIONS,
        validate: bool = True,
        threads: int = DEFAULT_THREADS,
        max_memory: str = DEFAULT_MAX_MEMORY,
    ) -> None:
        self.expected_format = expected_format
        self.compatible_versions = tuple(compatible_versions)
        self.threads = int(threads)
        if self.threads < 1:
            raise ValueError("threads must be >= 1")
        if not _MEMORY_LIMIT_PATTERN.match(str(max_memory)):
            raise ValueError(f"max_memory must look like '2GB' (got {max_memory!r})")
        self.max_memory = str(max_memory).upper()
        self.lake_root: Path = self._resolve_root(lake_root)
        self.ticks_dir: Path = self.lake_root / TICKS_DIRNAME
        self.metadata: Optional[Dict[str, Any]] = None
        self.schema_version: Optional[int] = None
        # Parquet footers are immutable; cache column sets keyed by (mtime, size) to avoid
        # re-reading footers on every query. File *lists* are never cached (contract §7.3.2).
        self._schema_cache: Dict[Tuple[str, int, int], Tuple[str, ...]] = {}
        if validate:
            self.validate_lake()

    # -- discovery ---------------------------------------------------------- #

    @staticmethod
    def _resolve_root(lake_root: Optional[Union[str, Path]]) -> Path:
        """Precedence: explicit argument → ``TICK_LAKE_ROOT`` → default candidates.

        An explicit argument or env var is authoritative: a bad value fails fast
        instead of silently falling back to another candidate.
        """
        if lake_root is not None:
            return Path(lake_root).expanduser().resolve()
        env_root = os.environ.get("TICK_LAKE_ROOT")
        if env_root:
            return Path(env_root).expanduser().resolve()
        candidates = default_lake_root_candidates()
        for candidate in candidates:
            if candidate.is_dir():
                return candidate.resolve()
        return candidates[0].resolve()

    # -- validation (contract §7.1) ----------------------------------------- #

    def validate_lake(self) -> None:
        """Fail-fast validation of root state and ``lake.json`` metadata."""
        root = self.lake_root
        if not root.exists() or not root.is_dir():
            raise LakeUnavailableError(
                f"Tick lake root is missing or not a directory: {root}"
            )

        meta_path = root / LAKE_METADATA_FILENAME
        if not meta_path.is_file():
            raise LakeCorruptedMetadataError(f"Missing lake metadata file: {meta_path}")
        try:
            metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise LakeCorruptedMetadataError(
                f"Lake metadata is not valid JSON: {meta_path} ({exc})"
            ) from exc
        except OSError as exc:
            raise LakeCorruptedMetadataError(
                f"Lake metadata is unreadable: {meta_path} ({exc})"
            ) from exc

        if not isinstance(metadata, dict):
            raise LakeCorruptedMetadataError(
                f"Lake metadata must be a JSON object: {meta_path}"
            )
        if metadata.get("format") != self.expected_format:
            raise LakeIncompatibleSchemaError(
                f"Unrecognized lake format {metadata.get('format')!r}; "
                f"expected {self.expected_format!r}"
            )
        if "schema_version" not in metadata:
            raise LakeCorruptedMetadataError(
                f"Lake metadata lacks schema_version: {meta_path}"
            )

        compatible = metadata.get("compatible_versions", list(self.compatible_versions))
        if not isinstance(compatible, (list, tuple)) or not all(
            _is_plain_int(item) for item in compatible
        ):
            raise LakeCorruptedMetadataError(
                f"compatible_versions must be a list of integers: {meta_path}"
            )
        schema_version = metadata["schema_version"]
        if not _is_plain_int(schema_version):
            # Malformed value (e.g. true, "1", 1.5) is metadata corruption, not a
            # well-typed but unsupported version.
            raise LakeCorruptedMetadataError(
                f"schema_version must be an integer: {meta_path} (got {schema_version!r})"
            )
        if schema_version not in compatible:
            raise LakeIncompatibleSchemaError(
                f"Incompatible lake schema_version {schema_version!r}; "
                f"reader supports {list(compatible)}"
            )

        self.metadata = metadata
        self.schema_version = int(schema_version)

    # -- maintenance guard (contract §6.1 / §7.1) ---------------------------- #

    def maintenance_guard_path(self) -> Path:
        return self.lake_root.joinpath(*MAINTENANCE_GUARD_PARTS)

    def is_maintenance_in_progress(self) -> bool:
        """True while ``_maintenance/in_progress.json`` exists."""
        return self.maintenance_guard_path().is_file()

    def ensure_ready(self) -> None:
        """Gate called before query execution: valid lake, no maintenance running."""
        self.validate_lake()
        if self.is_maintenance_in_progress():
            raise LakeMaintenanceInProgressError(
                "Tick lake maintenance is in progress "
                f"({self.maintenance_guard_path()}); retry with exponential backoff (5-30s)"
            )

    # -- partition pruning (contract §2.3; LAKE-READ-03) --------------------- #

    def symbol_partition_dir(self, symbol: str) -> Path:
        """``<ticks>/symbol=<ENCODED_UPPERCASE_SYMBOL>/`` (contract §2.2)."""
        return self.ticks_dir / f"{SYMBOL_PREFIX}{encode_symbol(symbol.upper())}"

    def list_partition_dates(self, symbol: str) -> List[date]:
        """Sorted UTC dates that have a partition directory for ``symbol``."""
        symbol_dir = self.symbol_partition_dir(symbol)
        if not symbol_dir.is_dir():
            return []
        dates: List[date] = []
        for entry in symbol_dir.iterdir():
            if not entry.is_dir():
                continue
            partition_date = _parse_partition_date(entry.name)
            if partition_date is not None:
                dates.append(partition_date)
        return sorted(dates)

    def resolve_files(
        self,
        symbol: str,
        start_date: Optional[DateLike] = None,
        end_date: Optional[DateLike] = None,
        *,
        inclusive_end: bool = True,
    ) -> List[str]:
        """Prune partitions at the filesystem level and return sorted Parquet paths.

        Contract §2.3: resolution happens before any query executes, only under
        ``ticks/``, and an empty match returns ``[]`` without touching DuckDB.
        Contract §7.1: ``inclusive_end=False`` yields a half-open ``[start, end)`` range.
        """
        symbol_dir = self.symbol_partition_dir(symbol)
        if not symbol_dir.is_dir():
            return []

        start = _to_utc_date(start_date) if start_date is not None else None
        end = _to_utc_date(end_date) if end_date is not None else None
        if start is not None and end is not None:
            if start > end or (start == end and not inclusive_end):
                return []

        matched: List[str] = []
        for entry in symbol_dir.iterdir():
            if not entry.is_dir():
                continue
            partition_date = _parse_partition_date(entry.name)
            if partition_date is None:
                continue  # non-canonical/malformed partition: ignore, never error (§7.1)
            if start is not None and partition_date < start:
                continue
            if end is not None:
                if inclusive_end and partition_date > end:
                    continue
                if not inclusive_end and partition_date >= end:
                    continue
            for parquet_file in entry.glob(PARQUET_GLOB):
                if parquet_file.is_file():
                    matched.append(str(parquet_file))
        return sorted(matched)

    # -- in-memory DuckDB execution (contract §4.1; LAKE-RESAMPLE-01) -------- #

    def _connect(self) -> duckdb.DuckDBPyConnection:
        """Open an isolated in-memory session with the contract's bounded settings."""
        connection = duckdb.connect(":memory:")
        connection.execute("SET TimeZone = 'UTC'")
        connection.execute(f"SET threads = {self.threads}")
        connection.execute(f"SET max_memory = '{self.max_memory}'")
        return connection

    def _file_columns(self, path: str) -> Tuple[str, ...]:
        """Physical column names of one Parquet file (footer metadata only)."""
        try:
            stat = os.stat(path)
        except OSError as exc:
            raise duckdb.IOException(f"IO Error: could not stat {path}: {exc}") from exc
        key = (str(path), stat.st_mtime_ns, stat.st_size)
        cached = self._schema_cache.get(key)
        if cached is not None:
            return cached

        try:
            import pyarrow.parquet as pq  # local import: optional fast path

            columns = tuple(pq.read_schema(path).names)
        except ImportError:  # pragma: no cover - pyarrow is present in the test env
            connection = self._connect()
            try:
                described = connection.execute(
                    "SELECT * FROM read_parquet([?], hive_partitioning=false) LIMIT 0", [str(path)]
                ).description
                columns = tuple(column[0] for column in described)
            finally:
                connection.close()

        self._schema_cache[key] = columns
        return columns

    def _build_projection(
        self, files: Sequence[str], *, symbol: str, need_session: bool
    ) -> _Projection:
        """Derive SQL expressions from the columns physically present in ``files``.

        Contract §3: v1 files carry ``price``/``volume``/``bid``/``ask``; v2 rows carry
        ``bid_price``/``ask_price`` and no ``volume``. A projection referencing a column
        that is absent raises a DuckDB binder error, so the expressions are built from the
        intersection (common) and union of the files' column sets; ``union_by_name=true``
        is only enabled when the files are heterogeneous.
        """
        if not files:
            raise LakeUnavailableError("projection requested for an empty file list")

        column_sets = [set(self._file_columns(path)) for path in files]
        common: set = set.intersection(*column_sets)
        union: set = set.union(*column_sets)
        mixed = common != union

        if "timestamp" not in common:
            raise LakeIncompatibleSchemaError(
                "Resolved Parquet files lack a common 'timestamp' column (§3.2)"
            )
        if "ingest_id" not in common:
            raise LakeIncompatibleSchemaError(
                "Resolved Parquet files lack a common 'ingest_id' column; deterministic "
                "tie-breaking on (timestamp, ingest_id) is impossible (§3.2/§3.4)"
            )
        if need_session and "session" not in common:
            raise LakeIncompatibleSchemaError(
                "Resolved Parquet files lack a common 'session' column; the requested "
                "session/RTH filter cannot be enforced (§3.2)"
            )

        price_candidates = [name for name in ("price", "bid_price") if name in union]
        if not price_candidates:
            raise LakeIncompatibleSchemaError(
                "Resolved Parquet files contain neither 'price' (v1) nor 'bid_price' (v2)"
            )
        if "price" in common and "bid_price" in common:
            price_expr = _coalesce_expr("price", "bid_price")
        elif "price" in common:
            price_expr = "price"
        elif "bid_price" in common:
            price_expr = "bid_price"
        else:
            price_expr = _coalesce_expr("price", "bid_price")

        if "volume" in common:
            volume_expr = "coalesce(volume, 1.0)"
        elif "volume" in union:
            volume_expr = "coalesce(volume, 1.0)"
        else:
            volume_expr = "1.0"

        bid_expr = self._quote_expr("bid", "bid_price", common, union)
        ask_expr = self._quote_expr("ask", "ask_price", common, union)

        has_symbol = "symbol" in common
        symbol_expr = "symbol" if has_symbol else _sql_literal(symbol.upper())
        source_expr = "source" if "source" in common else "NULL"
        session_expr = "session" if "session" in common else "NULL"

        return _Projection(
            symbol_expr=symbol_expr,
            price_expr=price_expr,
            volume_expr=volume_expr,
            bid_expr=bid_expr,
            ask_expr=ask_expr,
            source_expr=source_expr,
            session_expr=session_expr,
            ingest_id_expr="ingest_id",
            has_symbol_column=has_symbol,
            has_session_column="session" in common,
            has_ingest_id_column=True,
            union_by_name=mixed,
            schema_fingerprint=tuple(sorted(common)),
        )

    @staticmethod
    def _quote_expr(primary: str, fallback: str, common: set, union: set) -> str:
        if primary in common and fallback in common:
            return _coalesce_expr(primary, fallback)
        if primary in common:
            return primary
        if fallback in common:
            return fallback
        if primary in union or fallback in union:
            return _coalesce_expr(primary, fallback)
        return "NULL"

    def _read_parquet_source(self, projection: _Projection) -> str:
        options = "hive_partitioning=false"
        if projection.union_by_name:
            options += ", union_by_name=true"
        return f"read_parquet(?, {options})"

    def _execute_query(
        self,
        resolve: Callable[[], List[str]],
        build: Callable[[Sequence[str]], Tuple[str, List[Any]]],
        transform: Callable[[Sequence[Sequence[Any]]], List[Dict[str, Any]]],
    ) -> List[Dict[str, Any]]:
        """Resolve → build → execute, retrying once on ``duckdb.IOException`` (§7.3.3)."""
        files = resolve()
        if not files:
            return []

        attempts = 0
        while True:
            connection = None
            try:
                sql, params = build(files)
                connection = self._connect()
                rows = connection.execute(sql, [list(files)] + list(params)).fetchall()
                return transform(rows)
            except duckdb.IOException:
                # A file may vanish before or during execution (compaction/maintenance);
                # contract §7.3.3 requires re-resolution and a single retry.
                if attempts >= 1:
                    raise
                attempts += 1
                files = resolve()
                if not files:
                    return []
            finally:
                if connection is not None:
                    connection.close()

    # -- resampling queries (LAKE-RESAMPLE-02/03/04) ------------------------- #

    def query_candles(
        self,
        symbol: str,
        timeframe: str = "1m",
        start_time: Optional[Union[DateLike, datetime]] = None,
        end_time: Optional[Union[DateLike, datetime]] = None,
        limit: int = 15000,
        direction: Optional[str] = None,
        session: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Aggregate ticks into deterministic OHLCV candles (contract §3.4).

        ``direction='desc'`` (or ``end_time`` without ``start_time``) selects the most recent
        ``limit`` buckets; results are always returned in ascending bucket order.
        ``1d`` candles enforce ``session = 'REG'`` unless an explicit session is given
        (``session='ALL'`` disables the filter).
        """
        self.ensure_ready()
        normalized = (timeframe or "1m").lower()
        interval = INTERVAL_MAP.get(normalized, DEFAULT_INTERVAL)

        session_text = str(session).strip().upper() if session is not None else None
        if session_text == "":
            session_text = None  # empty string means "unspecified", not "no filter"
        session_filter: Optional[str] = None
        if session_text is not None and session_text != "ALL":
            session_filter = session_text
        elif session_text is None and normalized in DAILY_TIMEFRAMES:
            session_filter = "REG"

        start_dt = _to_utc_datetime(start_time)
        end_dt, end_exclusive = _end_boundary(end_time)
        clamped_limit = min(max(int(limit), 0), MAX_CANDLE_LIMIT)
        if clamped_limit == 0:
            return []

        if direction is not None:
            order_desc = str(direction).lower() == "desc"
        else:
            order_desc = start_time is None and end_time is not None
        order_dir = "DESC" if order_desc else "ASC"

        last_partition_date = (
            end_dt.date() if end_dt is not None
            else (end_exclusive - timedelta(days=1)).date() if end_exclusive is not None
            else None
        )

        def resolve() -> List[str]:
            return self.resolve_files(
                symbol,
                start_dt.date() if start_dt else None,
                last_partition_date,
            )

        def build(files: Sequence[str]) -> Tuple[str, List[Any]]:
            projection = self._build_projection(
                files, symbol=symbol, need_session=session_filter is not None
            )
            where: List[str] = []
            params: List[Any] = []
            if projection.has_symbol_column:
                where.append("upper(symbol) = ?")
                params.append(symbol.upper())
            if session_filter is not None:
                where.append("upper(session) = ?")
                params.append(session_filter)
            if start_dt is not None:
                where.append("timestamp >= ?")
                params.append(start_dt)
            if end_dt is not None:
                where.append("timestamp <= ?")
                params.append(end_dt)
            if end_exclusive is not None:
                where.append("timestamp < ?")
                params.append(end_exclusive)
            where_sql = f"WHERE {' AND '.join(where)}" if where else ""

            sql = f"""
                SELECT
                    time_bucket(INTERVAL '{interval}', timestamp) AS bucket_time,
                    {projection.symbol_expr} AS symbol,
                    arg_min({projection.price_expr}, (timestamp, {projection.ingest_id_expr})) AS open,
                    max({projection.price_expr}) AS high,
                    min({projection.price_expr}) AS low,
                    arg_max({projection.price_expr}, (timestamp, {projection.ingest_id_expr})) AS close,
                    sum({projection.volume_expr}) AS volume,
                    count(*) AS tick_count
                FROM {self._read_parquet_source(projection)}
                {where_sql}
                GROUP BY bucket_time, symbol
                ORDER BY bucket_time {order_dir}
                LIMIT {clamped_limit}
            """
            return sql, params

        @staticmethod
        def transform(rows: Sequence[Sequence[Any]]) -> List[Dict[str, Any]]:
            candles = [
                {
                    "time": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
                    "symbol": row[1],
                    "open": float(row[2]),
                    "high": float(row[3]),
                    "low": float(row[4]),
                    "close": float(row[5]),
                    "volume": float(row[6]),
                    "tick_count": int(row[7]),
                }
                for row in rows
            ]
            if order_desc:
                candles.reverse()  # contract-facing order is always chronological
            return candles

        return self._execute_query(resolve, build, transform)

    def query_ticks(
        self,
        symbol: str,
        start_time: Optional[Union[DateLike, datetime]] = None,
        end_time: Optional[Union[DateLike, datetime]] = None,
        limit: int = 10000,
        offset: int = 0,
        direction: str = "asc",
    ) -> List[Dict[str, Any]]:
        """Return raw ticks ordered by ``(timestamp, ingest_id)`` in the requested direction."""
        self.ensure_ready()
        start_dt = _to_utc_datetime(start_time)
        end_dt, end_exclusive = _end_boundary(end_time)
        clamped_limit = min(max(int(limit), 0), MAX_TICK_LIMIT)
        clamped_offset = max(int(offset), 0)
        if clamped_limit == 0:
            return []
        order_dir = "ASC" if str(direction).lower() == "asc" else "DESC"

        last_partition_date = (
            end_dt.date() if end_dt is not None
            else (end_exclusive - timedelta(days=1)).date() if end_exclusive is not None
            else None
        )

        def resolve() -> List[str]:
            return self.resolve_files(
                symbol,
                start_dt.date() if start_dt else None,
                last_partition_date,
            )

        def build(files: Sequence[str]) -> Tuple[str, List[Any]]:
            projection = self._build_projection(files, symbol=symbol, need_session=False)
            where: List[str] = []
            params: List[Any] = []
            if projection.has_symbol_column:
                where.append("upper(symbol) = ?")
                params.append(symbol.upper())
            if start_dt is not None:
                where.append("timestamp >= ?")
                params.append(start_dt)
            if end_dt is not None:
                where.append("timestamp <= ?")
                params.append(end_dt)
            if end_exclusive is not None:
                where.append("timestamp < ?")
                params.append(end_exclusive)
            where_sql = f"WHERE {' AND '.join(where)}" if where else ""

            sql = f"""
                SELECT
                    timestamp,
                    {projection.symbol_expr} AS symbol,
                    {projection.price_expr} AS price,
                    {projection.volume_expr} AS volume,
                    {projection.bid_expr} AS bid,
                    {projection.ask_expr} AS ask,
                    {projection.source_expr} AS source,
                    {projection.session_expr} AS session
                FROM {self._read_parquet_source(projection)}
                {where_sql}
                ORDER BY timestamp {order_dir}, {projection.ingest_id_expr} {order_dir}
                LIMIT {clamped_limit} OFFSET {clamped_offset}
            """
            return sql, params

        @staticmethod
        def transform(rows: Sequence[Sequence[Any]]) -> List[Dict[str, Any]]:
            return [
                {
                    "time": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
                    "symbol": row[1],
                    "price": float(row[2]) if row[2] is not None else None,
                    "volume": float(row[3]) if row[3] is not None else 1.0,
                    "bid": float(row[4]) if row[4] is not None else None,
                    "ask": float(row[5]) if row[5] is not None else None,
                    "source": row[6],
                    "session": row[7],
                }
                for row in rows
            ]

        return self._execute_query(resolve, build, transform)

    def query_tape(
        self,
        symbol: str,
        limit: int = 50,
        *,
        max_partitions: int = 31,
    ) -> List[Dict[str, Any]]:
        """Reverse-chronological order-flow tape with computed spread (contract §4.2).

        Reads the newest ``date=`` partitions first and only spills into older ones when
        they cannot satisfy ``limit``, so a thin latest partition cannot silently truncate
        a Time & Sales panel. Rows are ordered ``timestamp DESC, ingest_id DESC``; spread is
        ``round(ask - bid, 4)`` and is ``NULL`` whenever either quote side is missing.
        """
        self.ensure_ready()
        clamped_limit = min(max(int(limit), 0), MAX_TAPE_LIMIT)
        if clamped_limit == 0:
            return []

        partition_dates = self.list_partition_dates(symbol)
        if not partition_dates:
            return []

        def resolve_for(dates: Sequence[date]) -> List[str]:
            files: List[str] = []
            for day in dates:
                files.extend(self.resolve_files(symbol, day, day))
            return sorted(files)

        def build(files: Sequence[str]) -> Tuple[str, List[Any]]:
            projection = self._build_projection(files, symbol=symbol, need_session=False)
            spread_expr = (
                f"CASE WHEN {projection.bid_expr} IS NOT NULL AND {projection.ask_expr} IS NOT NULL "
                f"THEN round({projection.ask_expr} - {projection.bid_expr}, 4) ELSE NULL END"
            )
            where = ""
            params: List[Any] = []
            if projection.has_symbol_column:
                where = "WHERE upper(symbol) = ?"
                params.append(symbol.upper())
            sql = f"""
                SELECT
                    timestamp,
                    {projection.symbol_expr} AS symbol,
                    {projection.price_expr} AS price,
                    {projection.volume_expr} AS volume,
                    {projection.bid_expr} AS bid,
                    {projection.ask_expr} AS ask,
                    {spread_expr} AS spread,
                    {projection.source_expr} AS source,
                    {projection.session_expr} AS session
                FROM {self._read_parquet_source(projection)}
                {where}
                ORDER BY timestamp DESC, {projection.ingest_id_expr} DESC
                LIMIT {clamped_limit}
            """
            return sql, params

        @staticmethod
        def transform(rows: Sequence[Sequence[Any]]) -> List[Dict[str, Any]]:
            return [
                {
                    "timestamp": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
                    "symbol": row[1],
                    "price": float(row[2]) if row[2] is not None else None,
                    "volume": float(row[3]) if row[3] is not None else 1.0,
                    "bid": float(row[4]) if row[4] is not None else None,
                    "ask": float(row[5]) if row[5] is not None else None,
                    "spread": float(row[6]) if row[6] is not None else None,
                    "source": row[7],
                    "session": row[8],
                }
                for row in rows
            ]

        # Newest partitions first; stop as soon as the requested window is satisfied.
        ordered_dates = list(reversed(partition_dates))[: max(1, int(max_partitions))]
        chosen: List[date] = []
        result: List[Dict[str, Any]] = []
        for day in ordered_dates:
            chosen.append(day)
            result = self._execute_query(lambda: resolve_for(chosen), build, transform)
            if len(result) >= clamped_limit:
                break
        return result

    def symbol_stats(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """Per-symbol aggregates: tick count, first/last tick, min/max traded price.

        With ``symbol=None`` the whole lake is aggregated in a single grouped query.
        ``min_price``/``max_price`` use the same price expression as candle aggregation
        (v1 ``price`` / v2 ``bid_price``, coalesced for mixed sets).
        """
        self.ensure_ready()

        if symbol is not None:
            files = self.resolve_files(symbol)
            if not files:
                return []
        else:
            files = []
            for name in self.list_symbols():
                files.extend(self.resolve_files(name))
            files = sorted(files)
            if not files:
                return []

        def build(file_list: Sequence[str]) -> Tuple[str, List[Any]]:
            projection = self._build_projection(file_list, symbol=symbol or "", need_session=False)
            filter_symbol = symbol is not None and projection.has_symbol_column
            where = "WHERE upper(symbol) = ?" if filter_symbol else ""
            params: List[Any] = [symbol.upper()] if filter_symbol else []
            sql = f"""
                SELECT
                    {projection.symbol_expr} AS symbol,
                    count(*) AS tick_count,
                    min(timestamp) AS first_tick,
                    max(timestamp) AS last_tick,
                    min({projection.price_expr}) AS min_price,
                    max({projection.price_expr}) AS max_price
                FROM {self._read_parquet_source(projection)}
                {where}
                GROUP BY symbol
                ORDER BY tick_count DESC, symbol ASC
            """
            return sql, params

        @staticmethod
        def transform(rows: Sequence[Sequence[Any]]) -> List[Dict[str, Any]]:
            return [
                {
                    "symbol": row[0],
                    "tick_count": int(row[1]),
                    "first_tick": row[2].isoformat() if hasattr(row[2], "isoformat") else str(row[2]),
                    "last_tick": row[3].isoformat() if hasattr(row[3], "isoformat") else str(row[3]),
                    "min_price": float(row[4]) if row[4] is not None else None,
                    "max_price": float(row[5]) if row[5] is not None else None,
                }
                for row in rows
                if int(row[1]) > 0
            ]

        return self._execute_query(lambda: files, build, transform)

    def lake_totals(self, *, footer_scan_limit: int = 2000) -> Dict[str, Any]:
        """Lake inventory from directory names and Parquet footers (no data scan).

        ``tick_count`` is ``None`` when the file count exceeds ``footer_scan_limit`` so a
        very large lake cannot stall a status endpoint.
        """
        symbols = self.list_symbols()
        partitions = 0
        files: List[Path] = []
        if self.ticks_dir.is_dir():
            for symbol_dir in sorted(self.ticks_dir.iterdir()):
                if not symbol_dir.is_dir() or not symbol_dir.name.startswith(SYMBOL_PREFIX):
                    continue
                for entry in sorted(symbol_dir.iterdir()):
                    if entry.is_dir() and _parse_partition_date(entry.name) is not None:
                        partitions += 1
                        files.extend(sorted(entry.glob(PARQUET_GLOB)))

        tick_count: Optional[int] = None
        size_bytes = 0
        if files:
            for path in files:
                try:
                    size_bytes += path.stat().st_size
                except OSError:
                    pass
            if len(files) <= footer_scan_limit:
                total = 0
                counted = True
                for path in files:
                    rows = _parquet_row_count(path)
                    if rows is None:
                        counted = False
                        break
                    total += rows
                tick_count = total if counted else None

        return {
            "path": str(self.lake_root),
            "exists": self.lake_root.is_dir(),
            "symbol_count": len(symbols),
            "partition_count": partitions,
            "file_count": len(files),
            "size_bytes": size_bytes,
            "tick_count": tick_count,
        }

    def list_symbols(self) -> List[str]:
        """Decoded display symbols present under ``ticks/`` (sorted)."""
        if not self.ticks_dir.is_dir():
            return []
        symbols: List[str] = []
        for entry in self.ticks_dir.iterdir():
            if not entry.is_dir() or not entry.name.startswith(SYMBOL_PREFIX):
                continue
            try:
                symbols.append(decode_symbol(entry.name[len(SYMBOL_PREFIX):]))
            except ValueError:
                continue
        return sorted(symbols)
