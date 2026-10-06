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

Phase 39 scope: root discovery, metadata validation, encoding, pruning, guard.
Query execution (in-memory DuckDB resampling) is layered on in Phase 40 via
``ensure_ready()`` + :meth:`TickLakeReader.resolve_files`.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union

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
    ) -> None:
        self.expected_format = expected_format
        self.compatible_versions = tuple(compatible_versions)
        self.lake_root: Path = self._resolve_root(lake_root)
        self.ticks_dir: Path = self.lake_root / TICKS_DIRNAME
        self.metadata: Optional[Dict[str, Any]] = None
        self.schema_version: Optional[int] = None
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
