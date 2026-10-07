---
status: resolved
trigger: "Tablet initial load takes extremely long, and Mac CPU/GPU usage is very high during replay."
created: 2026-10-07T08:24:50.000Z
updated: 2026-10-07T08:36:00.000Z
---

## Current Focus

hypothesis: The tablet delay and the Mac load are four independent mechanisms, not one; the
  dominant tablet cost is uncompressed 100k-tick JSON repeated per symbol, and the dominant Mac
  cost is an O(N)-per-frame pass in TimeAndSales.
test: Quantify each mechanism in isolation rather than reasoning from source structure.
expecting: If a mechanism is real, its measured unit cost will be non-trivial against its budget
  (60fps frame, or Wi-Fi byte budget). Costs below noise falsify the hypothesis.
next_action: Formalize the confirmed mechanisms as regression tests (RED) — see gsd-add-tests.
bug_class: bohrbug
reasoning_checkpoint: Two of four suspected mechanisms survived quantification; one suspected
  mechanism (canPlay) was falsified by measurement and downgraded. Weighing each candidate
  against its budget, rather than against code appearance, is what separated them.
tdd_checkpoint: null

## Symptoms

expected: Tablet renders the replay UI promptly after opening the app; Mac stays responsive and
  cool during replay.
actual: Tablet shows a long blocking load (connection/loading state). Mac CPU and GPU spike
  during replay; the machine gets hot.
errors: None — no crash, no console error. Both are pure cost/latency problems.
reproduction:
  - Tablet: open the app over LAN from the Mac host, observe time-to-interactive.
  - Mac: start a session, press play, open Time & Sales, observe CPU/GPU.
started: Grown over time; recent architectural shifts (tick lake on external disk, 100k-tick
  buffers, multi-symbol workspaces) plausibly increased both.

## Eliminated

- hypothesis: PlaybackBar's `useMemo` does heavy O(N) array work every frame (claimed by the
  supplied analysis).
  evidence: The memo body (`PlaybackBar.tsx:56-102`) reads only `bufferedTicks[0]` and
  `bufferedTicks[length-1]`. It recomputes each frame because `bufferedTicks` identity changes,
  but the work is O(1).
  timestamp: 2026-10-07T08:24:50.000Z

- hypothesis: `canPlay`'s un-memoized `masterData.some(...)` over 5000 bars is a per-frame
  bottleneck (raised by this review).
  evidence: Measured: 0.0002 ms normal (short-circuits at index 0 on sorted data), 0.0993 ms
  worst case (absent date) → ≤5.96 ms/sec at 60fps. Immaterial. Falsified by the review's own
  measurement and downgraded to Info.
  timestamp: 2026-10-07T08:24:50.000Z

- hypothesis: The Vite `/api` proxy is on the tablet's hot path.
  evidence: `streamingClient.ts:56-59,100-102` build absolute `http://<hostname>:8765` URLs and
  never use relative ones, so the proxy is bypassed for data. It is therefore neither a
  contributor to the slowness nor an obstacle to a production build.
  timestamp: 2026-10-07T08:24:50.000Z

## Evidence

- timestamp: 2026-10-07T08:24:50.000Z
  checked: `tools/mac/start-frontend.sh:45,48`
  found: Runs `vite --host 0.0.0.0 --port 3000` (dev mode) — unbundled ES module waterfall.
  implication: Tablet pays hundreds of round-trips; the built bundle is 461 kB (141.8 kB gzip),
  a single asset. Confirms mechanism A.

- timestamp: 2026-10-07T08:24:50.000Z
  checked: `backend/streaming_service/server.py` (whole file) for `gzip`/`Content-Encoding`/middleware
  found: Only `cors_middleware` (`server.py:146-162`). No compression of any kind.
  implication: Every payload ships raw. Mechanism B is real and was missing from the supplied
  analysis.

- timestamp: 2026-10-07T08:24:50.000Z
  checked: Payload size for 100k ticks (M3 in REVIEW.md)
  found: 12.03 MB raw JSON → 1.90 MB gzip (6.3×). `App.tsx:143-152` repeats this per active symbol.
  implication: On the tablet's Wi-Fi link the uncompressed form is the single largest avoidable
  transfer cost; ~36 MB for a 3-symbol workspace.

- timestamp: 2026-10-07T08:24:50.000Z
  checked: `duckdb_client.py:115` → `tick_lake_reader.py:1037-1086` (`symbol_stats`), and the sole
  consumer `useDatabase.ts:27-29`
  found: One grouped aggregation computing `count(*)`, `min/max(timestamp)`, `min/max(price)` over
  every file in the lake. The only consumer keeps `s.symbol`. `get_symbols()` also drops the
  computed `min_price`/`max_price` before serialization.
  implication: On the boot path the app performs a full-lake column scan and discards the result.
  Mechanism C. The fix is to delete work, not to cache it — which also avoids the contract's
  no-caching rule (`docs/contracts/repo_b_tick_lake_contract.md:478`, §7.3.2).

- timestamp: 2026-10-07T08:24:50.000Z
  checked: `symbol_stats()` vs `list_symbols()` on a synthetic contract-conformant lake (M2)
  found: At 2,000 files/4M rows: 0.4576 s vs 0.0001 s → 6555× faster. Cost scales ≈linearly with
  file count. Extrapolated to 7,448 files: ≈1.7 s on fast local storage.
  implication: Quantitatively explains the reported multi-second boot stall on the external SSD.

- timestamp: 2026-10-07T08:24:50.000Z
  checked: `TimeAndSales.tsx:37-44` cost at N=100,000 (M1)
  found: 9.75 ms/frame best case → 58% of a 16.67 ms frame budget → ≈585 ms/sec at 60fps.
  implication: Dominant frontend CPU cost. Only `visibleTicks` (last 80, line 41) is rendered;
  the two full-array passes exist solely for a footer counter (line 190). Mechanism D.

- timestamp: 2026-10-07T08:24:50.000Z
  checked: `useChartLifecycle.ts:805-820` + `useChartPlugins.ts:46-65`, `App.tsx:259`, `src/index.css`
  found: 6 `attachPrimitive()` calls per chart; `backdrop-filter: blur(3px)` on a full-viewport
  overlay, plus `--glass-blur` reused at 7 further sites.
  implication: Mechanism E — continuous canvas repaint under a blur shader. Real, but GPU-side and
  the least independently measurable without the actual Mac; treat as lower confidence.

- timestamp: 2026-10-07T08:24:50.000Z
  checked: `useDatabase.ts:34`
  found: `totalTicks > 0 ? (totalTicks/1e6).toFixed(1) : '101.4'` — a hardcoded fallback tick count.
  implication: Measurement hazard. The supplied analysis' "101.4 million ticks" is
  indistinguishable from this constant and must be treated as unverified. Reported tick totals
  actually come from `/api/status` → `lake_totals()`, which is footer-only and capped at 2000 files.

## Resolution

root_cause: Four independent contributing mechanisms (an AND-gate, not a single fault):
  (A) the tablet is served the unbundled dev server;
  (B) no response compression, so 12 MB/symbol tick payloads cross Wi-Fi raw;
  (C) `/api/symbols` performs a discarded full-lake aggregation on the boot path;
  (D) `TimeAndSales` performs O(N)-per-frame work at 60fps (≈58% of a core) for data it discards.
  (E) canvas repaint under a full-viewport backdrop blur is a secondary GPU contributor.
  Two originally-suspected causes were falsified (see Eliminated).
fix: >
  (A) tools/mac/start-frontend.sh now builds and serves the bundled output by default
      (vite preview), with --dev as an explicit escape hatch for local editing.
  (B) compression_middleware added to the aiohttp app (server.py), gzip-negotiated for
      JSON/text bodies >= 1 KiB, with Vary: Accept-Encoding. Wraps CORS so CORS headers
      survive.
  (C) New reader.symbol_names() / DuckDBService.get_symbol_names() enumerate partition
      directories with no Parquet I/O; /api/symbols?names_only=1 selects it, and
      StreamingClient.getSymbols() now requests it. The aggregate default is untouched
      for backward compatibility, and no file list is cached (contract §7.3.2).
  (D) TimeAndSales builds a per-(buffer,symbol) position index once and per frame does a
      binary search plus a bounded slice, replacing a per-render full copy + two full
      filters. Hooks were moved above the isOpen early return to keep hook order stable.
verification:
  frontend: "85 files, 438 passed / 2 skipped (baseline 432 passed; +6 new, 0 regressions)"
  backend: "232 passed / 2 skipped (baseline 226; +6 new, 0 regressions)"
  build: "vite build clean; tsc --noEmit clean"
  measured:
    tape_element_visits_per_frame: "199,179 -> <=4,000 budget (3/3 budget tests green)"
    tick_payload_wire_bytes: "15.6 MB -> 1.29 MB per 100k-tick symbol (12.1x, measured on the wire)"
    symbols_resolution: "symbol_stats 0.4576s @2,000 files/4M rows vs list_symbols 0.0001s (6555x)"
    prod_first_paint_requests: "3 (index.html + 1 JS + 1 CSS) vs per-module dev waterfall (47 src modules)"
  not_verified: "End-to-end tablet load time and Mac CPU/GPU deltas require the real Mac,
    real tick lake, and tablet — see _test-plan in the quick-task SUMMARY."
oracle_type: derived  # mechanism-level: assertions derive from measured budgets (frame
  element-visits, compressed wire bytes, query class), not from the buggy paths' own output
files_changed:
  - tools/mac/start-frontend.sh
  - backend/streaming_service/server.py
  - backend/streaming_service/duckdb_client.py
  - backend/streaming_service/tick_lake_reader.py
  - src/components/TimeAndSales.tsx
  - src/lib/streamingClient.ts
  - vite.config.ts
  - backend/streaming_service/tests/test_hotpath_budgets.py        (new)
  - tests/performance/tapeElementBudget.test.tsx                   (new)
  - tests/unit/bootInventoryContract.test.ts                       (new)

## Post-fix correction discovered during self-review

`names_only` enumerates symbols alphabetically, whereas the aggregate form returned them
sorted by tick count descending. Membership is unchanged (pinned by
`test_boot_symbols_path_returns_every_lake_symbol`), and the app's default ticker comes
from `localStorage`/`AAPL` rather than list order. The only user-visible effects are the
sidebar dropdown ordering and a rare double-fallback in `useSession.ts:29`. Doing better
would require the tick counts — i.e. the scan we just removed — so alphabetical is the
deliberate trade. Recorded here so it is a decision, not a surprise.
