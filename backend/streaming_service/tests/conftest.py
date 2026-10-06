"""Shared pytest fixtures for the Market Rewind streaming-service backend tests.

Phase 39+ builds on a deterministic synthetic tick lake that is faithful to the
Repo B Tick Lake Read Contract v1.5.0 (see `tick_lake_factory.py`).

Fixture strata:
  * `mini_lake`      — hermetic, per-test lake under tmp_path
  * `persistent_lake` — the sandbox-resident lake (regenerated once per session)
  * `external_lake`  — an operator-provided lake via TICK_LAKE_ROOT (skipped when absent)
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

import pytest

from tick_lake_factory import SANDBOX_LAKE_ROOT, build_mini_lake, build_persistent_lake


@pytest.fixture
def mini_lake(tmp_path: Path) -> Path:
    """Hermetic deterministic mini lake (per test)."""
    return build_mini_lake(tmp_path / "tick_lake")


@pytest.fixture(scope="session")
def session_lake(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Hermetic rich lake (staging decoys + control-plane noise), built once per session.

    Deliberately NOT tied to any absolute path so the suite is portable across
    checkouts (a previous revision pinned this to the sandbox path).
    """
    root = tmp_path_factory.mktemp("tick_lake_session") / "tick_lake"
    return build_persistent_lake(root)


@pytest.fixture(scope="session")
def sandbox_lake() -> Path:
    """Optional lake at the sandbox discovery-candidate path; skipped when unavailable."""
    try:
        SANDBOX_LAKE_ROOT.parent.mkdir(parents=True, exist_ok=True)
        if not (SANDBOX_LAKE_ROOT / "lake.json").exists():
            build_persistent_lake(SANDBOX_LAKE_ROOT)
    except OSError as exc:  # e.g. read-only /home on macOS
        pytest.skip(f"sandbox-resident lake unavailable: {exc}")
    return SANDBOX_LAKE_ROOT


@pytest.fixture(scope="session")
def external_lake() -> Path:
    """Operator-provided real lake via TICK_LAKE_ROOT; skipped when absent."""
    root = os.environ.get("TICK_LAKE_ROOT")
    if not root:
        pytest.skip("TICK_LAKE_ROOT is not set; real-lake integration test skipped")
    path = Path(root)
    if not (path / "lake.json").is_file():
        pytest.skip(f"TICK_LAKE_ROOT={path} does not contain a lake.json")
    return path


@pytest.fixture(autouse=True)
def _isolate_tick_lake_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Prevent an ambient TICK_LAKE_ROOT from leaking into hermetic tests.

    Tests that exercise env-based discovery re-set it explicitly.
    """
    for var in ("TICK_LAKE_ROOT", "DATA_DIR"):
        monkeypatch.delenv(var, raising=False)
    yield
