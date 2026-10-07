---
quick_id: 261007-tlp
slug: tablet-load-and-mac-perf
status: complete
date: 2026-10-07
trigger: "Tablet initial load takes extremely long, and Mac CPU/GPU usage is very high during replay."
artifacts:
  review: 261007-tlp-REVIEW.md
  debug: ../../debug/tablet-load-and-mac-cpu-gpu.md
---

# Quick Task Summary: Tablet Load Latency & Mac CPU/GPU Load

## Overview

Four independent mechanisms were confirmed by measurement, two suspected causes were
falsified, and all confirmed mechanisms were fixed with RED→GREEN tests. Two of the
supplied analysis' conclusions were **wrong** and one of this task's own findings was
**corrected by its own measurement** — both are recorded rather than quietly dropped.

## Root causes (an AND-gate, not one bug)

| # | Mechanism | Evidence |
|---|---|---|
| A | Tablet served the **unbundled dev server** | `start-frontend.sh` ran `vite` dev; prod = 3 requests vs 47+ per-module |
| B | **No response compression** — 100k-tick payloads crossed Wi-Fi raw | 15.6 MB → 1.29 MB gzip (**12.1×**) measured on the wire |
| C | `/api/symbols` ran a **discarded full-lake aggregation** on the boot path | 0.4576 s @2,000 files vs 0.0001 s names-only (**6555×**); 2 computed columns dropped before serialization |
| D | `TimeAndSales` did **O(N) work per frame** at 60fps for data it discarded | 199,179 element visits/frame → budget 4,000 |

Mechanism E (`backdrop-filter` under continuous canvas repaint) is a real but
GPU-side contributor; it is **documented, not fixed** — see Deferred.

## Falsified (recorded so they are not re-investigated)

- **PlaybackBar's `useMemo`** was claimed to do heavy per-frame array work. Its body is
  O(1) (`bufferedTicks[0]` / `[length-1]` only).
- **`canPlay`'s un-memoized `masterData.some()`** was raised by this task's own review as
  a Warning. Measurement: 0.0002 ms normal (short-circuits at index 0), 0.0993 ms worst
  case → ≤6 ms/sec. **Immaterial; downgraded to Info.**
- The supplied analysis' **"101.4 million ticks"** matches a hardcoded UI fallback string
  (`useDatabase.ts:34`), so it is treated as unverified rather than as a measurement.

## Changes

| File | Change |
|---|---|
| `tools/mac/start-frontend.sh` | Prod serving by default (`vite preview` after a build); `--dev` escape hatch; warns when an already-running instance may be in the other mode |
| `vite.config.ts` | Added `preview` block mirroring the dev proxy + `allowedHosts: true` (the host check 403s the tablet otherwise — reproduced) |
| `backend/.../server.py` | `compression_middleware` (gzip, ≥1 KiB, `Vary`), wraps CORS; `names_only` branch on `/api/symbols` |
| `backend/.../tick_lake_reader.py` | `symbol_names()` — directory enumeration, zero Parquet I/O, no file-list caching |
| `backend/.../duckdb_client.py` | `get_symbol_names()` |
| `src/lib/streamingClient.ts` | Boot path requests `names_only=1` |
| `src/components/TimeAndSales.tsx` | Per-(buffer,symbol) index + binary search + bounded slice; hooks moved above the `isOpen` early return |

## Tests added (RED before, GREEN after)

- `backend/streaming_service/tests/test_hotpath_budgets.py` — 6 tests: boot path must not
  aggregate (monkeypatch oracle), default keeps its stats contract, correctness of the
  symbol set, gzip on the wire with `auto_decompress=False`, decompressed-body equality,
  `Vary`, CORS survival, no compression below threshold, complexity-class assertion.
- `tests/performance/tapeElementBudget.test.tsx` — 3 tests: element-visit budget, buffer-size
  independence, plus a behavioural guard (80 rows) so the optimization cannot cheat.
- `tests/unit/bootInventoryContract.test.ts` — 3 tests pinning the client half of the
  boot-path contract so client and server cannot drift apart.

**Oracles are `derived`** (measured budgets / query class), not assertions about the old
implementation's output — so any correct optimization passes.

## Verification

| Gate | Result |
|---|---|
| Frontend vitest | **438 passed / 2 skipped, 85 files** (baseline 432 — +6, zero regressions) |
| Backend pytest | **232 passed / 2 skipped** (baseline 226 — +6, zero regressions) |
| `tsc --noEmit` | clean |
| `vite build` | clean — 461.51 kB JS → 141.99 kB gzip |
| Production serve | HTTP 200, preview host accepted, bundle + CSS served |

### One real bug this task introduced, caught by an existing test

Placing the new `useMemo` calls after `if (!isOpen) return null` produced
*"Rendered more hooks than during the previous render"* and broke
`tests/codex/review/ui.test.ts` and `tests/unit/reviewTransitions.test.tsx`. The
pre-existing regression test caught it; hooks were moved above the early return. Recorded
because it is evidence the suite does its job.

## Deferred

- **Mechanism E** (`backdrop-filter: blur` over continuously repainting canvases): real,
  but this change set was not verified on the Mac, and GPU cost was not independently
  measured here. Removed from scope rather than guessed at.
- **Static-asset compression**: `vite preview` does not gzip, so the 461 kB bundle travels
  identity (≈1 s on Wi-Fi, then browser-cached). Serving `dist/` from the aiohttp backend
  would compress it too, but that would move the app to port 8765 and change its URL.

## Not verifiable in this environment (needs the Mac)

There is no tick lake, no real market data, and no Mac here. Mechanisms and budgets are
verified; **absolute** end-to-end improvements are not. To measure on the real system:

```bash
# 1. Baselines (from the repo root)
curl -s -o /dev/null -w 'symbols: %{time_total}s\n' 'http://localhost:8765/api/symbols'          # old: ~4 s on the real lake
curl -s -o /dev/null -w 'symbols fake: %{time_total}s\n' 'http://localhost:8765/api/symbols?names_only=1'
curl -s -o /dev/null -w 'ticks: %{time_total}s %{size_download} bytes\n' \
  'http://localhost:8765/api/ticks?symbol=SPY&limit=100000'
curl -s -H 'Accept-Encoding: gzip' -o /dev/null \
  -w 'ticks gz: %{time_total}s %{size_download} bytes\n' \
  'http://localhost:8765/api/ticks?symbol=SPY&limit=100000'

# 2. Confirm compression is negotiated on the wire
curl -sI -H 'Accept-Encoding: gzip' 'http://localhost:8765/api/ticks?symbol=SPY&limit=100000' \
  | grep -i 'content-encoding\|vary'

# 3. Tablet load: open the app from the tablet with the Mac's Activity Monitor CPU visible.
#    Expect the single-bundle load and ~12x less tick traffic. Compare against
#    ./tools/mac/start-frontend.sh --dev to see the old behaviour.
```
