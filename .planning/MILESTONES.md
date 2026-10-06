# Project Milestones: Market Rewind

## v5.0 Partitioned Parquet Tick Lake Integration (Repo B Contract Compliance) (Shipped: 2026-10-06)

**Delivered:** Complete re-architecture of Market Rewind's data access layer from the retired disk-backed `streaming.duckdb` database to Data Harvester's zero-dependency Partitioned Parquet Tick Lake adhering strictly to the Repo B Read Contract (`docs/contracts/repo_b_tick_lake_contract.md` v1.5.0). Implemented isolated in-memory DuckDB query runner (`:memory:`), filesystem partition directory pruning, uppercase percent-encoding for `[A-Za-z0-9_-]` safe set, dual-schema compatibility (Schema v1 and Schema v2 / quote rewrite), deterministic `(timestamp, ingest_id)` OHLCV tie-breaking, reverse-chronological order flow tape with spread, fail-fast maintenance guards, and comprehensive test suite alignment.

**Phases completed:** 39-42 (4 plans total)

**Key accomplishments:**
- Implemented standalone `TickLakeReader` in `backend/streaming_service/tick_lake_reader.py` with zero library imports from `data-harvester`
- Partition pruning to `ticks/symbol=<ENCODED_SYMBOL>/date=<YYYY-MM-DD>/*.parquet`, safe encoding for symbols (`BRK.B` -> `BRK%2EB`, `EUR/USD` -> `EUR%2FUSD`)
- Vectorized DuckDB `time_bucket()` resampling on ephemeral `:memory:` connections with `threads=4` and `max_memory=2GB`
- Deterministic OHLCV candle aggregation with `arg_min` / `arg_max` tie-breaking across subsecond to daily timeframes
- Dual-schema support coalescing Schema v1 (`price`, `volume`) and Schema v2 (`bid_price`, `ask_price`) without column binder errors
- Strict RTH filtering for daily (`1d`) candles (`session = 'REG'`)
- Reverse-chronological Time & Sales / Order Flow Tape queries with computed spread (`ask - bid`)
- Maintenance guard checking `<lake_root>/_maintenance/in_progress.json` with HTTP 503 retry responses
- Restored backend test suite from 11 failures to 220 passing tests (97% backend line coverage)
- 100% green pass rate across 81 Vitest files (422 passed, 2 skipped), 69/69 Playwright journey tests, clean production build

**Stats:**
- 4 phases, 4 plans, 13 requirements verified (100%)
- 220 backend pytest tests passing (97% line coverage)
- 81/81 Vitest test files passing (422 tests)
- 69/69 Playwright browser journey tests passing
- Clean production build (459.65 kB JS / 141.21 kB gzip)

**Git range:** `feat(phase-39)` → `feat(phase-42)` (`9968e9e` → `8446652`)

---

## v4.3 Live Data Stabilization and Testing (Shipped: 2026-09-30)

**Delivered:** Resolved the four critical defects discovered during the final live-browser verification (`FINAL-LIVE-BROWSER-REVIEW-96ca478.md`). Unified daily volume aggregation and live price policy across play/pause states, prevented old symbol history from leaking during symbol switches, guaranteed sorted, unique data when merging history chunks, and proved stability across all unit and Playwright test suites.

**Phases completed:** 34-38 (5 plans total)

**Key accomplishments:**
- Replicated all 4 live review failure modes in unit and Playwright tests before altering any code
- Unified daily volume aggregation and live price calculation across live and paused states
- Fixed render context transitions by clearing old canvas data and blocking pending requests on symbol switches
- Guaranteed sorted and unique bar sequence when merging history chunks and rapid timeframe switching
- Full verification: 80/80 Vitest test files passing (418 tests), 69/69 Playwright journey tests passing, clean production build

**Stats:**
- 5 phases, 5 plans, 10 requirements verified (100%)
- 80/80 Vitest test files passing (418 tests)
- 69/69 Playwright offline journey tests passing
- Clean production build

**Git range:** `feat(phase-34)` → `feat(phase-38)`

---

## v4.2 State Machine Convergence & Temporal Strictness (Shipped: 2026-09-30)

**Delivered:** Systematically resolved the three remaining P1 transition and look-ahead defects documented in `docs/reviews/2026-09-30-replay-review.md`. Following strict TDD, eliminated seek-then-play fallback volume drops, prevented switched-symbol unclosed 5m price leaks, strictly isolated daily forming candles to RTH session hours and completed minutes at 09:30:01, and proved mathematical equivalence across continuous playback, direct seek, seek-then-play, and rewind-and-replay.

**Phases completed:** 29-33 (5 plans total)

**Key accomplishments:**
- Replicated all 3 defects in focused unit and Playwright tests before altering application code (verified Red phase)
- Reconstructed constituent minute volume state upon snapshot hydration in `useChartLifecycle.ts`, preventing volume loss when seeking into multi-minute bars then resuming playback
- Parameterized forming candle containment by source bar duration in `useChartData.ts`, eliminating unclosed 5-minute price leakage when switching symbols
- Rebuilt daily candle aggregation in `useChartData.ts` to strictly observe RTH session hours and isolate unclosed forming minutes at 09:30:01
- Proved Layer 2 mathematical equivalence across continuous play, direct seek, seek-then-play, and rewind-and-replay (`CONV-TEST-02`)
- Ingested Codex review probes into `tests/codex/rereview/` and `tests/codex/followup/`
- Resolved post-milestone review findings from `market-rewind-c3a3791-review.md` and `market-rewind-356b1e2-review.md`: isolated daily forming candles from synthetic fallback ticks in live playback and hydration, connected real data hooks in convergence tests, and hardened Playwright replay boundary assertion
- Full Green phase verification: 77/77 test files (398 tests) passed, 11/11 backend pytest passed, 65/65 Playwright journey tests passed, 0 build errors

**Stats:**
- 5 phases, 5 plans, 11 requirements verified (100%)
- 77/77 Vitest test files passing (398 tests)
- 11/11 Python pytest backend service tests passing
- 65/65 Playwright offline journey tests passing
- Clean production build (890ms)

**Git range:** `feat(phase-29)` → `feat(phase-33)`

---

## v4.1 Replay Convergence, State Machine Synchronization & Transition Integrity (Shipped: 2026-09-30)

**Delivered:** Systematically resolved all 8 architectural and transition findings from `market-rewind-review-2026-09-29.md`. Fixed React hook-order safety in Time & Sales, synchronized the consumed-tick cursor across seeks and rewinds, guarded session date switches against asynchronous races, protected forming multi-minute candles across their entire interval, accumulated constituent minute volumes in fallback mode, anchored timeline scrubber bounds across seeks, and ingested all Codex test suites into the main repository.

**Phases completed:** 25-28 (4 plans total)

**Key accomplishments:**
- Fixed React hook-order mismatch in `TimeAndSales.tsx` by unconditionally declaring `usePlaybackStore` subscriptions at the top level
- Synchronized `lastConsumedTimeRef` with seek snapshots and added temporal discontinuity resets for rewind in `useChartLifecycle.ts`
- Optimized per-frame tick ingestion from $O(N)$ full scans to $O(\log N)$ binary search (`findFirstTickAfter`) with early break
- Extended forming candle look-ahead protection to the entire bucket interval (`bMs <= effectiveCutoff && bMs + 60000 > effectiveCutoff`) in `useChartData.ts`
- Tracked constituent minute volumes in `syntheticBucketVolumesRef`, summing constituent minutes instead of replacing with the latest minute
- Added monotonic `sessionGenRef` to `loadStreamingTicks` in `src/App.tsx`, preventing late date responses from overwriting active session time
- Anchored scrubber `minTime` and `maxTime` in `PlaybackBar.tsx` across seeks, preventing premarket domain loss when seeking forward to 09:34
- Imported all 6 Codex diagnostic and review test suites into `tests/codex/`
- 100% test-first verification: Red phase verified (7/7 failed), Green phase passing 70/70 suites (366 tests), backend 11/11 passed, Playwright 4/4 passed

**Stats:**
- 4 phases, 4 plans, 12 requirements verified (100%)
- 70/70 Vitest test files passing (366 tests)
- 11/11 Python pytest backend service tests passing
- 4/4 Playwright E2E journey tests passing
- Clean production build (825ms)

**Git range:** `feat(phase-25)` → `feat(phase-28)` (`819fa4a` → `90e2fe9`)

---

## v4.0 Canonical Single-Database (`streaming.db`) Replay Engine & Defect Elimination (Shipped: 2026-09-29)

**Delivered:** Established a canonical, single-database architecture powered exclusively by `streaming.duckdb` (permanently retiring `historical.duckdb`), and eliminated all 9 playback, lifecycle, volume, and timeline defects from `market-rewind-diagnosis-and-plan.md` via rigorous Test-Driven Development (TDD) across 11 diagnostic replication suites.

**Phases completed:** 21-24 (4 plans total)

**Key accomplishments:**
- Permanently purged `historical.duckdb` from backend, frontend, schema validation, and config, building all candles purely from `streaming.duckdb` via DuckDB `time_bucket()` in 26ms
- Event-deduplicated volume tracking and multi-tick intra-frame high/low trade aggregation (DIAG 1, DIAG 2)
- Reconciled canvas history prepending so older arriving bars always render (DIAG 3)
- Immediate first-candle initialization when history is empty (DIAG 4)
- Multi-symbol buffer ingestion cursor stability preserving active replay position (DIAG 5)
- Elimination of synthetic premarket fallback volume compounding (DIAG 6)
- Strict extended-hours filtering (`isRthTick`) during active playback when ETH is disabled (DIAG 7)
- Atomic symbol switching with immediate price clearing and zero old company candle leakage (DIAG 8)
- Zero future OHLC leakage on forming multi-minute candles at cutoff (DIAG 9)
- Playback snapshot unfreezing on tick arrival (DIAG 10)
- Monotonic session generation tokens preventing out-of-order date response clock overwrites (DIAG 11)
- Time & Sales order flow tape symbol isolation and active badge filtering (RENDER-04)
- Timeline scrubber stabilization with integer-second snapping and explicit `HH:MM:SS` jump input (SCRUB-01, SCRUB-02)
- 100% test-first verification: Red phase verified, Green phase passing 62/62 suites (341 tests), backend 11/11 passed, Playwright 2/2 passed

**Stats:**
- 4 phases, 4 plans, 18 requirements verified (100%)
- 62/62 Vitest test files passing (341 tests)
- 11/11 Python pytest backend service tests passing
- 2/2 Playwright E2E journey tests passing
- Clean production build (998ms)

**Git range:** `feat(phase-21)` → `feat(phase-24)`

---

## v3.2 High-Performance Chart Playback & Data Reliability Engine (Shipped: 2026-09-28)

**Delivered:** Eliminated CPU saturation during market replay and resolved the intermittent single-candle loading bug by decoupling high-frequency playback state from React, executing O(1) direct canvas series updates via lightweight-charts, preventing viewport drag-fighting during playback, and establishing comprehensive single-candle initialization safeguards.

**Phases completed:** 18-20 (3 plans total)

**Key accomplishments:**
- Decoupled playback state from React render tree (0 React re-renders/sec during 60fps playback)
- Direct O(1) lightweight-charts series updates for price and volume (<0.02ms per frame)
- Non-blocking viewport interaction allowing free panning and zooming during playback
- Single-candle loading bug elimination with boundary validation and load suppression
- 50/50 test suites and 282/282 tests passing with zero regressions

**Stats:**
- 3 phases, 3 plans, 12 tasks
- 12/12 requirements verified (100%)
- 50/50 test suites passing, 282/282 tests passing
- Clean production build (828ms)

**Git range:** `feat(phase-18)` → `feat(phase-20)` (`0c2de80` → `9edd9c4`)

**What's next:** Milestone v4.0 Canonical Single-Database (`streaming.db`) Replay Engine & Comprehensive Defect Elimination

---

## v3.1 Pure Streaming DuckDB Replay Engine, Global Multi-Asset Sync & Playwright Hardening (Shipped: 2026-09-26)

**Delivered:** Re-architected Market Rewind to run exclusively on `streaming.duckdb`, synchronizing real-time market playback across all active charts and groups simultaneously, with strict date boundaries, removal of legacy SQLite/Vercel artifacts, and a comprehensive test-first Playwright/unit test suite.

**Phases completed:** 13-17 (5 plans total)

**Key accomplishments:**
- Completely removed `sql.js`, SQLite WASM workers, and `historical.duckdb` dependencies
- Implemented multi-ticker simultaneous playback synchronization (AAPL, AMD, NVDA, SPY)
- Built universal simulation clock engine with sub-millisecond tick timing
- Delivered O(1) incremental candle updates (<0.05ms per frame) eliminating animation lag
- Enhanced Time & Sales tape streaming with millisecond precision, local ET timezone formatting, and instant scroll

**Stats:**
- 26 files modified / created
- 5 phases, 5 plans, 20 tasks
- 14/14 requirements verified (100%)
- 15/15 Playwright E2E and 145/145 Vitest unit tests passing

**Git range:** `feat(phase-13)` → `chore(milestone)` (`e8f7607` → `15ec8a5`)

**What's next:** Next milestone candidate features (TAPE-02 multi-symbol tape, ORDER-02 paper trading engine, EXPORT-01 session export, INDICATORS-01 multi-timeframe overlays)

---

## v3.0 Pure Tick-by-Tick Replay & Temporal Isolation Engine (Shipped: 2026-09-26)

**Delivered:** Pure tick-by-tick market replay with canonical 9:20 AM ET date resets, zero future data leakage through strict temporal bounding, and real-time intraday candle forming directly from tick streams.

**Phases completed:** 9-12 (4 plans total)

**Key accomplishments:**
- Permanently eliminated legacy TICK vs BAR toggle in favor of a unified high-performance tick replay pipeline
- Implemented canonical 9:20 AM ET date reset with complete temporal isolation
- Built real-time candle synthesizer dynamically aggregating 1s, 5s, 15s, 1m, 5m, 15m, 1h bars from raw ticks
- Established comprehensive automated regression test suite covering date resets and temporal boundaries

**Stats:**
- 14 files modified / created
- 4 phases, 4 plans, 16 tasks
- 5/5 requirements verified (100%)
- Full test suite passing

**Git range:** `feat(phase-09)` → `chore(milestone)` (`f87cc07` → `03d80a9`)

**What's next:** Milestone v3.1 architecture cleanup and multi-asset global playback synchronization

---

## v2.0 Tick-by-Tick Streaming Engine & Modern UI (Shipped: 2026-09-26)

**Delivered:** Integration with high-performance DuckDB backend (`streaming.duckdb`), millisecond tick streaming engine, live Time & Sales order flow tape, and a modernized dark financial terminal layout.

**Phases completed:** 5-8 (4 plans total)

**Key accomplishments:**
- Direct read-only connection to DuckDB streaming storage querying 37.8M+ ticks with sub-50ms latency
- Dynamic `time_bucket()` candlestick aggregation supporting sub-second to daily intervals
- Millisecond-accurate tick replay engine with variable speeds (0.5x to 100x / instant)
- Time & Sales / Order Flow Tape component with live prints, bid/ask spread, and color-coded trade sizes
- Dark terminal UI refresh with tick scrubber and live session metrics

**Stats:**
- 4 phases, 4 plans, 18 tasks
- 12/12 requirements verified (100%)

**Git range:** `docs: start milestone v2.0` → `docs: audit & archive milestone v2.0` (`f87cc07` → `6c578d9`)

**What's next:** Milestone v3.0 temporal isolation and pure tick-by-tick replay

---

## v1.0 Stability Guardrails & Multi-Chart Core (Shipped: 2026-09-25)

**Delivered:** Foundational multi-chart market replay frontend with viewport stabilization during infinite prepend, symbol group linking, type-safe lightweight-charts plugins, and worker-offloaded database access.

**Phases completed:** 1-4 (14 plans total)

**Key accomplishments:**
- Viewport anchor stabilization preventing jumps when prepending historical candle batches
- Dynamic multi-chart grid layouts with group linking (A, B, C, D) and leader-follower propagation
- Decomposed monolithic `useChartLifecycle` into modular specialized hooks
- Built type-safe primitive renderers for session shading, volume profiles, and drawing tools
- Migrated database operations to asynchronous web worker proxy

**Stats:**
- 4 phases, 14 plans, 42 tasks
- Full E2E and unit test coverage across viewport stability and group synchronization

**Git range:** `2ae7f27` → `a12662f`

**What's next:** Milestone v2.0 DuckDB integration and tick streaming engine
