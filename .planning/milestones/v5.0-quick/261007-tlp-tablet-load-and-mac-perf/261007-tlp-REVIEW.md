---
quick_id: 261007-tlp
slug: tablet-load-and-mac-perf
artifact: REVIEW
date: 2026-10-07
depth: standard
scope_source: explicit file list (pasted third-party analysis + verified hot paths)
verdict: FINDINGS_CONFIRMED_WITH_CORRECTIONS
---

# Code Review — Tablet Load Latency & Mac CPU/GPU Load

## Scope

Reviewed the hot paths implicated by the reported symptoms (slow tablet load, high Mac
CPU/GPU during replay). A third-party analysis was supplied with the report; this review
**independently verifies each claim against source** rather than accepting it.

Files inspected: `src/App.tsx`, `src/components/{PlaybackManager,PlaybackBar,TimeAndSales}.tsx`,
`src/hooks/{useChartLifecycle,useDatabase,useMarketSimulator}.ts`, `src/hooks/chart/useChartPlugins.ts`,
`src/lib/streamingClient.ts`, `src/store/usePlaybackStore.ts`, `backend/streaming_service/{server,duckdb_client,tick_lake_reader}.py`,
`tools/mac/{start-frontend,start-backend}.sh`, `docs/contracts/repo_b_tick_lake_contract.md`.

Baselines at review time: vitest **432 passed / 2 skipped** (83 files) ·
pytest **226 passed / 2 skipped** · `vite build` **461.19 kB JS → 141.82 kB gzip**.

---

## Critical

### C1 — `/api/symbols` runs a full-lake aggregation whose result is discarded

- `src/hooks/useDatabase.ts:27` calls `streamingClient.getSymbols()`; the **only** consumer
  is line 29: `const symList = syms.map(s => s.symbol)`. Every other field is unused.
- `src/lib/streamingClient.ts:263-286` maps `tick_count`, `first_tick`, `last_tick` — all dead.
- `backend/streaming_service/duckdb_client.py:115` → `symbol_stats()` →
  `tick_lake_reader.py:1037-1075` builds one grouped query:
  `count(*), min(timestamp), max(timestamp), min(price), max(price)` over **every file in the lake**.
- `tick_lake_reader.py:1079-1086` computes `min_price`/`max_price`, which `duckdb_client.get_symbols()`
  then **drops entirely** — the HTTP payload never contains them. Pure wasted I/O.
- No cache exists in the handler (`server.py:216-221`) and none is permitted for the file list
  (contract `docs/contracts/…:478` — *"Never cache a resolved file list"*).

**Impact:** the app's very first data call blocks the UI on a cold full-column scan of the
external-disk lake. This is the dominant boot stall.

**Fix direction:** add a names-only path that resolves symbol **directories** (`list_symbols()`,
`tick_lake_reader.py:1143-1155` — pure `iterdir()` + decode, no Parquet I/O) and returns
`[{symbol}]`. No aggregation ⇒ no cache ⇒ contract §7.3.2 stays satisfied.

### C2 — No response compression on any endpoint

- `backend/streaming_service/server.py:188` constructs `web.Application(middlewares=[cors_middleware])`
  — only CORS. No `gzip`/`deflate`/`Content-Encoding` anywhere in the file.
- `src/App.tsx:143-152` requests `limit: 100000` ticks; `tick_lake_reader.py:113` allows up to `MAX_TICK_LIMIT = 100000`.

**Impact:** a 100k-tick replay buffer ships as raw uncompressed JSON over Wi-Fi. JSON tick
arrays compress ~5-10×. This cost is **absent from the supplied analysis** and is the single
largest avoidable byte-level cost on the tablet path.

---

## Warning

### W1 — Time & Sales does O(N) work per frame, 60×/second

`src/components/TimeAndSales.tsx:37-44` — on **every render**:

```ts
const executedTicks = bufferedTicks.slice(0, currentTickIndex + 1);   // full copy
const symbolExecutedTicks = executedTicks.filter(...);                  // full scan
const totalSymbolTicks = bufferedTicks.filter(...).length;              // second full scan
```

`PlaybackManager.tsx:41-58` drives `advanceSimulationTime` at 60 fps, and `TimeAndSales`
subscribes to `currentTickIndex`/`currentTick`, so this runs ~60×/s. With the 100k buffer
from `App.tsx:146` that is ~12M element-visits/second plus a fresh 100k array each frame.

**Only `visibleTicks` (last 80) is rendered.** `symbolExecutedTicks.length` and `totalSymbolTicks`
are used solely for the footer counter (line 190). The work is entirely avoidable and is the
worst per-frame CPU offender in the app.

### W2 — `canPlay` scans up to 5000 bars on every render — **DOWNGRADED to Info (I3), see Measurement**

`src/components/PlaybackBar.tsx:194-196`:

```ts
const canPlay = bufferedTicks.length > 0 || (
  Boolean(currentDateStr) && masterData.some((b) => b.time.startsWith(currentDateStr))
);
```

`masterData` is populated by `useMarketSimulator.ts:39-42` with `limit: 5000`, so this is an
unmemoized scan per render (`currentDateStr` below it *is* memoized; `canPlay` is not).

**This was filed as a Warning on code-reading grounds and measurement disproved the severity.**
`Array.prototype.some` short-circuits, and `masterData` is chronologically sorted, so when the
session date is present it matches at index 0. Measured (5000 bars, 500 iterations, best-of):

| Case | Cost/call | Cost @60fps |
|---|---|---|
| Date is `masterData[0]` (normal) | 0.0002 ms | 0.01 ms/sec |
| Date absent (holiday/weekend) | 0.0993 ms | **5.96 ms/sec** |

Worst case is ~0.6% of one core and ~0.4% of a single 16.67 ms frame. Real, but immaterial;
it is recorded as Info and is **not** a priority. Retained here as a correction so downstream
work does not treat it as a bottleneck.

### W3 — Dev server is used to serve the tablet

`tools/mac/start-frontend.sh:45,48` runs `vite --host 0.0.0.0 --port …` (dev mode). Dev mode
serves unbundled ES modules — a request waterfall per module over Wi-Fi. The production build
is a single 141.82 kB gzip asset (measured above).

### W4 — Full-screen `backdrop-filter` over continuously repainting canvases

`src/App.tsx:259` (`backdrop-filter: blur(3px)` on the session overlay) plus the `--glass-blur`
variable reused at `src/index.css:42,262,393,581,750,814,851`. Each chart attaches 6 primitives
(`src/hooks/chart/useChartPlugins.ts:46-65`), so a multi-chart grid holds many canvas contexts
repainting during playback. Blur re-samples the composited buffer when content beneath changes.

---

## Info

### I1 — Misleading hardcoded fallback in the status string

`src/hooks/useDatabase.ts:34`: `const totalM = totalTicks > 0 ? (totalTicks / 1_000_000).toFixed(1) : '101.4';`

When the backend reports no tick count, the UI displays **"101.4M Ticks"** — a fabricated value.
This is a measurement hazard: the supplied analysis cites "101.4 million ticks" as an observed
figure, which is indistinguishable from this constant. Treat any such claim as unverified until
independently measured.

### I2 — `useMemo` invalidated every tick, but body is O(1)

`src/components/PlaybackBar.tsx:56-102` depends on `bufferedTicks` (array identity, replaced per
update), so the memo recomputes every frame — however it only reads `bufferedTicks[0]` and
`[length-1]`, so the recomputation is O(1). The supplied analysis described this as heavy
per-frame array work; **that part is overstated**. The real per-frame cost in this component is W2.

---

## Measured Evidence

All figures produced during this review; reproducible via the commands noted. Measurements were
taken on a local NVMe-class filesystem, so **absolute** times understate the external-USB-SSD
case — treat the *ratios* as the durable result.

### M1 — Time & Sales per-frame cost (worst offender, confirmed)

Replicated `TimeAndSales.tsx:37-44` exactly (100,000 ticks, 19 symbols, best of 20 frames, V8):

| Metric | Value |
|---|---|
| Per frame | **9.75 ms** (mean 10.84 ms) |
| Share of 16.67 ms frame budget | **58%** |
| Sustained cost @60fps | **≈585 ms/sec — 58% of one core, continuously** |

This is the dominant frontend CPU cost and the one that explains the reported Mac load. It is
enabled only while the Time & Sales panel is open.

### M2 — `/api/symbols` aggregation vs names-only (confirmed, and extreme)

Synthetic lake built with the repo's own `tick_lake_factory` (contract-conformant layout):

| Files | Rows | `list_symbols()` | `symbol_stats()` | Speedup |
|---|---|---|---|---|
| 200 | 400,000 | 0.0000 s | 0.0528 s | 1327× |
| 2,000 | 4,000,000 | 0.0001 s | 0.4576 s | 6555× |

`symbol_stats()` scales ≈linearly with file count (10× files → 8.7× time), confirming the cost is
per-file/per-column scanning, not fixed overhead. Extrapolating to the reported 7,448-file lake
gives **≈1.7 s on fast local storage**, which makes the reported ~4 s on an external USB SSD
entirely plausible. Payload shrinks 1210 → 200 bytes (6×).

### M3 — Tick payload compression headroom (C2)

100,000 ticks, realistic shape (time/price/volume/symbol/session/bid/ask), `JSON.stringify`:

| | Size |
|---|---|
| Raw JSON | **12.03 MB** |
| gzip | **1.90 MB** |
| Ratio | **6.3×** |

`App.tsx:143-152` issues this request **once per active workspace symbol** in parallel, so a
3-symbol workspace moves ~36 MB uncompressed per session load (~5.7 MB gzipped).

### M4 — `canPlay` (W2 → I3, magnitude corrected)

See W2 above: 0.0002 ms normal / 0.0993 ms worst case. Immaterial.

---

## Corrections to the supplied analysis

| Supplied claim | Verdict |
|---|---|
| Dev server instead of production build | **Confirmed** (W3) |
| `/api/symbols` full-lake scan causes boot stall | **Confirmed** (C1, M2) — and worse: two computed columns are discarded before serialization |
| "101.4 million ticks" scanned | **Unverified / likely wrong** — matches a hardcoded UI constant (I1) |
| 100k ticks = 15–30 MB JSON | **Confirmed and understated** — no compression exists at all (C2, M3: 12 MB raw, 6.3× headroom) |
| PlaybackBar re-renders 60×/s doing heavy work | **Partly wrong** — its memo body is O(1) (I2), and the genuine scan in `canPlay` measures immaterial (I3) |
| TimeAndSales slices/filters 100k arrays 60×/s | **Confirmed, quantified in M1 — 58% of a core** |
| 12+ canvas contexts, 6 plugins/chart | **Confirmed** (W4) |
| `backdrop-filter` costs GPU | **Confirmed** (W4) |
| Client uses absolute URLs, so the Vite `/api` proxy is dead code | **Confirmed** (`streamingClient.ts:56-59`) — a production build needs no proxy change |

## Corrections to this review (from measurement)

- **W2** (`canPlay` O(5000)/render) was raised from code reading and is **immaterial in
  measurement** — downgraded to I3. Filed here explicitly so the finding is not re-inflated later.
- **C2** was understated on first pass: the JSON volume is large but the *6.3× compression
  headroom* is the actionable number (M3).

## Coverage gaps in the supplied analysis

1. **No compression** (C2/M3) — unmentioned; largest byte-level win.
2. **Discarded aggregation columns** (C1) — the fix is to *remove work*, not to cache it.
3. The analysis did not distinguish "renders often" from "does O(N) work per render"; several
   conclusions conflate the two, which is what made the PlaybackBar direction wrong.
4. No item in the analysis was quantified, so the 100× magnitude difference between the real
   offender (M1) and a non-issue (M4) was invisible.
