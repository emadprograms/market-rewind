---
status: awaiting_human_verify
trigger: "I keep running into this issue where on my tab trying to seek forward or backward while the replay is playing immediately crashes the pages and makes it non responsive."
created: 2026-10-08T04:50:00.000Z
updated: 2026-10-08T09:45:00.000Z
---

## Current Focus
<!-- OVERWRITE on each update - always reflects NOW -->

hypothesis: CONFIRMED (see Resolution.root_cause).
test: Fix-acceptance guardrail complete in-sandbox; remaining signals (real-browser E2E and
  real-tick-lake UAT) are env-blocked here and delegated to the user's local agent.
expecting: On a machine with the tick lake and a Playwright browser, seeking/stepping/
  scrubbing while playing keeps the tab responsive, the chart follows the playhead in both
  directions, and no candle newer than the playhead survives a rewind.
next_action: Human/local-agent verification. Run the brief in the session handoff:
  vitest + tsc + build, the two seek guards, tests/regression/chart/chartShaking.spec.ts
  (scrub/rewind/forward+play), tests/regression/replay/realtimePlayback.spec.ts, the mocked
  journey suite, and the manual seek-while-playing UAT with a DevTools longest-task
  measurement on both the fixed branch and main.
bug_class: bohrbug  <!-- deterministic: reproduces on every seek-while-playing, scales with elapsed tick count -->
reasoning_checkpoint:
  hypothesis: Seek-while-playing routes the whole time jump through subscriber 6's per-tick
    catch-up, which emits O(elapsed ticks) chart primitive writes synchronously.
  confirming_evidence: Instrumented harness measured 3,600 price-series writes for a
    3-minute jump over 3 buckets; 7,199 for 30 scrubber seeks; rewind emitted 0 writes while
    the series still held a bucket 3 minutes ahead of the playhead.
  falsification_test: Revert the three src files (git stash) and re-run the guard — the
    counts must return. They did (4 of 5 assertions failed with the original numbers).
  fix_rationale: Make the discontinuity explicit (seekEpoch) so the bulk snapshot path owns
    it, and coalesce primitive writes to one per bucket so no notification can emit O(ticks)
    writes. Neither change alters candle maths or the paused-seek path.
  blind_spots: Sandbox has no browser and no tick lake, so real LWC write cost, GPU repaint
    cost and multi-chart behaviour at 100k ticks are inferred from write counts, not
    measured; the 1D branch's per-tick masterData scan is coalesced but still O(ticks) in
    scan cost.
  candidate_causes: code (subscriber 6 write granularity), code (useChartData refresh rule),
    data (buffer size up to 100k ticks/symbol), config (261007-nsp removed the forced pause).
    Environment ruled out: reproduces headless in jsdom with mocked series.
  and_gate: FIRED — both code causes are necessary. Coalescing alone leaves the rewind leak;
    the snapshot refresh alone leaves O(ticks) writes at high speed multipliers.
tdd_checkpoint:
  test_file: tests/unit/seekWhilePlayingFreeze.test.ts
  red: 4 of 5 failed pre-fix (3600 > 6; 0 > 0; 7199 > 270; 18 > 3)
  green: 5 of 5 post-fix
  secondary_file: tests/integration/seekTimelineCandles.test.tsx (real useChartData hook)

## Symptoms
<!-- Written during gathering, then immutable -->

expected: Pressing step-forward / step-backward, dragging the scrub slider, or submitting a
  time jump while the replay is PLAYING should move the playhead and keep charts updating
  smoothly. The tab must stay responsive.
actual: The tab immediately becomes non-responsive ("crashes the page") when seeking in
  either direction during active playback.
errors: None reported by the user. Symptom is a main-thread block / tab kill, not a thrown
  exception (no ErrorBoundary trip reported).
reproduction: Start a session (ticks buffered) -> press PLAY -> while playing, press
  step-forward or step-backward (default STEP = 3m), or drag the time scrubber.
started: After quick task 261007-nsp ("non-pause seeking", 2026-10-07) made
  `seekTickTime` / `seekTickIndex` / `stepForward` / `stepBackward` preserve `isPaused`
  instead of forcing `isPaused: true`.

## Eliminated
<!-- APPEND only - prevents re-investigating after /clear -->

- hypothesis: An infinite loop / runaway recursion in the seek path (store or hook) blocks
  the main thread forever.
  evidence: Instrumented harness (renderHook + mocked LWC series) completed every seek and
    returned control: a 3-minute seek finished in 22.5ms, a 4-minute seek in similar time.
    All `while` loops in the seek path (binary searches, the `advanceSimulationTime` merge
    loop) provably terminate. The freeze is unbounded-but-finite work per event, re-run per
    scrubber `onChange`, not a non-terminating loop.
  timestamp: 2026-10-08T04:56:00.000Z

- hypothesis: The rAF transport loop in `PlaybackManager` stacks up (multiple concurrent
  loops) when a seek changes `isPaused`/`playbackSpeed`.
  evidence: The effect cleanup cancels `frameIdRef` and the loop re-checks
    `usePlaybackStore.getState().isPaused` before rescheduling; a seek does not change
    `isPaused` (261007-nsp) nor `playbackSpeed`, so the effect does not even re-run on a
    seek. The blow-up reproduces with `PlaybackManager` unmounted entirely.
  timestamp: 2026-10-08T04:56:30.000Z

## Evidence
<!-- APPEND only - facts discovered during investigation -->

- timestamp: 2026-10-08T04:45:00.000Z
  checked: .planning/quick/261007-nsp-playback-trade-quote-fixes/SUMMARY.md
  found: Seek/step/scrub/jump were changed to preserve `isPaused`; `setPaused(true)` was
    removed from the slider `onChange`, `onMouseUp`, `onTouchEnd` and jump-submit handlers.
    Auto-pause now only happens at end-of-session (`targetMs >= maxMs`).
  implication: Seeks can now occur while the direct-canvas playback subscriber is armed.
    Before this change every seek forced a pause, which made subscriber 6 bail out at its
    `if (state.isPaused ...) return` guard, so the expensive catch-up path never ran on a
    seek. This is the regression window.

- timestamp: 2026-10-08T04:47:00.000Z
  checked: src/hooks/useChartLifecycle.ts subscriber 6 (lines ~707-1030)
  found: On every store notification while playing it scans `symbolTicks` from
    `findFirstTickAfter(symbolTicks, lastConsumedTimeRef.current)` up to `state.currentTime`,
    pushes every eligible tick into `newlyElapsedTicks`, then loops over that array calling
    `initPriceSeriesRef.current.update(...)` AND `initVolumeSeriesRef.current.update(...)`
    once per tick (plus DOM `setAttribute` + `toISOString` per new bucket, and for `1D`
    an inner backward scan of `symbolTicks` per tick).
  implication: Cost is O(elapsed ticks) chart primitive updates, not O(elapsed buckets).
    A large forward jump makes this a single unbounded synchronous block on the main thread.

- timestamp: 2026-10-08T04:48:00.000Z
  checked: src/App.tsx loadStreamingTicks + src/hooks/useChartData.ts SYNC-04 fetch
  found: Tick buffer is loaded with `limit: 100000` per active symbol and all symbols are
    merged into one `bufferedTicks` array.
  implication: `k` (ticks elapsed by one seek) can reach tens of thousands. Default STEP is
    3 minutes; on a dense symbol that is easily 10k-50k ticks per press, and a slider drag
    fires `seekTickTime` on every `onChange` event, re-running the scan repeatedly.

- timestamp: 2026-10-08T04:49:00.000Z
  checked: src/hooks/useChartData.ts playback subscription (lines ~88-110)
  found: React state (`globalTime`, `latestTick`, `symbolTicks`) is only refreshed when
    `state.isPaused || ticksChanged`. A seek does not change `ticksBySymbol` identity, so
    while playing a seek produces NO React-state refresh and NO bulk `setData()` snapshot
    rebuild - subscriber 6's per-tick catch-up is the only path that can move the chart.
  implication: The cheap bulk-snapshot path is structurally unreachable for a
    seek-while-playing, so the fix cannot simply skip the catch-up; the snapshot path must
    be made reachable (or the catch-up must be made O(buckets)).

- timestamp: 2026-10-08T04:58:00.000Z
  checked: Instrumented reproduction — `renderHook(useChartLifecycle)` with mocked LWC
    series (harness from tests/unit/chartIncrementalUpdate.test.ts), 7,200 buffered SPY
    ticks at 20/sec, `isPaused: false`, chart hydrated, then a single `seekTickTime()`.
  found: A 3-minute forward seek emitted 2,401 `priceSeries.update()` calls (+2,401
    `volumeSeries.update()`) for 3 elapsed 1-minute buckets. A 4-minute seek emitted 3,601.
    Wall time 22.5ms *with no-op mock series* — real LWC updates invalidate and schedule
    redraws, and the `1D` branch additionally re-scans the tape per tick.
  implication: CONFIRMED. Cost is O(elapsed ticks), not O(elapsed buckets). Scales with the
    buffer (up to 100k ticks/symbol) and multiplies by the number of open charts, and a
    scrubber drag re-runs it on every `onChange` event.

- timestamp: 2026-10-08T04:59:00.000Z
  checked: Same harness, rewind case — seek forward to T0+4min, then back to T0+1min while
    playing.
  found: The rewind emitted ZERO series writes. The series still held bucket 1790343240
    (T0+4min) while `store.currentTime` was 1790343060000 (T0+1min).
  implication: Second defect from the same root cause: subscriber 6's rewind handler resets
    the cursors, but the processing loop's monotonic guard `if (bucketTime <
    lastCandle.time) continue` then drops every rewound tick, so the chart keeps rendering
    candles from after the playhead — a future-data-leakage violation of the project's core
    temporal-isolation invariant.

- timestamp: 2026-10-08T05:00:00.000Z
  checked: Why the frozen chart cannot self-heal — `useChartData` playback subscription.
  found: React state refreshes only on `state.isPaused || ticksChanged`; a seek changes
    neither, so `globalTime`/`latestTick` never move, `chartData` is never recomputed and
    the bulk `setData()` snapshot rebuild never runs for a seek-while-playing.
  implication: The fix must make a seek a first-class *snapshot* event (an explicit
    discontinuity signal), not merely skip the per-tick catch-up — skipping alone would
    leave the chart frozen at the pre-seek state.

- timestamp: 2026-10-08T09:10:38.000Z
  checked: First real-environment run of the fix — maintainer's machine (Darwin 25.6.0 arm64, node
    v25.6.1, Chromium installed, DuckDB backend up, tick lake present at
    /Volumes/Micron-E 0256 A/data-harvester/data/tick_lake: 19 symbols, 7411 partitions, 13308
    files, 1.88 GB), branch pinned at 7b7d551, driven by tools/verify-seek-freeze-fix.sh --quick.
  found: tsc clean; vitest 95 files / 563 passed / 2 skipped; seek guards 8/8; vite build clean
    (463.99 kB, gzip 142.66 kB); backend pytest 232 passed / 2 skipped; and the three live
    regressions closest to this defect all PASS with the fix in place — chartShaking (40s, includes
    "rapid slider scrubbing back and forth" and "seeking backward to earlier time preserves elapsed
    history"), realtimePlayback (15s), sync/ (18s).
  implication: backend_pytest moves skipped -> pass. The fix survives contact with the real tick
    lake and a real browser for every pre-existing seek regression. The defect-specific probe
    produced no measurements on this run — see the next entry.

- timestamp: 2026-10-08T09:12:00.000Z
  checked: Why the new freeze probe produced no FREEZE-REPORT blocks; why 23+ journey tests failed;
    why the auto-picked tape was NVDA 2025-03-21 at 13:00.
  found: (a) The probe died in all four tests with `page.evaluate: ReferenceError: reset is not
    defined` at readProbe — the closure handed to page.evaluate captured its own `reset` parameter
    instead of receiving it, so Playwright serialized a function referencing a name that does not
    exist in the browser. Nothing was measured. (b) The journey failures are pre-existing staleness:
    the app has defaulted the entry time to 09:10 since e57efe8 (useSession.ts:15, App.tsx:126) — a
    commit already on main — while 11 journey specs and tests/regression/mocks/marketSimulator.ts
    still expect the 09:20 anchor, so the mock serves nothing and each test times out at ~41s.
    (c) /api/symbols returns whole-lake aggregates (NVDA 16.9M ticks spanning 2025-03-21 to
    2026-10-08), so deriving a session date from first_tick selected the lake's oldest partial day.
  implication: All three are harness/test defects, not fix defects — none is evidence about the seek
    freeze itself. Fixed by extracting every in-page function into
    tests/regression/chart/freezeProbeInPage.ts with explicit parameters, guarded by
    tests/unit/freezeProbeInPage.test.ts (jsdom behaviour, an AST lint for free variables, and a ban
    on zero-arg page.evaluate closures; both mutants of that lint were killed, the second only after
    the first version of the regex proved vacuous). The picker now takes the date from SEED_DATE and
    contributes only the densest symbol. The journey suite is bounded to 01-boot by default and --ab
    runs it on the baseline as well, so "pre-existing" becomes provable rather than assumed.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: Confirmed — two contributing code causes behind one AND-gate, both unlocked by
  quick task 261007-nsp making seeks non-pausing:
  (A) `useChartLifecycle` subscriber 6 (PERF-01 direct-canvas playback path) treats a seek as
  elapsed playback and replays every jumped-over tick individually, emitting one
  `priceSeries.update()` + one `volumeSeries.update()` per tick inside a synchronous zustand
  subscriber. Measured: 3,600 primitive writes for a 3-minute jump spanning 3 one-minute
  buckets; 7,199 writes for 30 scrubber events; multiplied by open charts and re-run on every
  scrubber `onChange`. That is the freeze.
  (B) The O(buckets) bulk snapshot rebuild was structurally unreachable during a
  seek-while-playing — `useChartData` refreshed React state only on `isPaused || ticksChanged`
  and a seek changes neither — so (A) was the only path that could move the chart, and on a
  rewind its monotonic `bucketTime < lastCandle.time` guard dropped every tick (0 writes),
  leaving candles from after the playhead on screen.
  Contributing conditions, not causes: buffer sized at `limit: 100000` ticks/symbol, and the
  same per-tick write granularity also firing at high speed multipliers (18 writes for a
  900ms frame at 20 ticks/sec).

fix: >
  Three changes. (1) `src/store/usePlaybackStore.ts`: added `seekEpoch`, a monotonic counter
  bumped by every explicit playhead move (`seekTickTime`, `seekTickIndex`, and the tick-mode
  branches of `stepForward`/`stepBackward`), and extracted the seek body verbatim into a
  module-level `computeSeekPatch(state, targetMs, bumpSeekEpoch)` so `advanceSimulationTime`'s
  internal rewind branch reuses the same core with the flag OFF — a per-frame call can never
  trigger a React rebuild. (2) `src/hooks/useChartData.ts`: the playback subscription now also
  refreshes React state when `seekEpoch` changes, so a seek-while-playing recomputes the candle
  snapshot and effect 3 rebuilds the series in bulk — the same path a paused seek always used,
  which also fixes the rewind leak. (3) `src/hooks/useChartLifecycle.ts`: subscriber 6 coalesces
  chart-primitive writes per candle bucket (INGEST-06) via `queueUpdate`/`flushQueuedUpdates`,
  flushing when the bucket changes and at the end of the batch. Candle maths, `lastCandleRef`,
  `syntheticBucketVolumesRef`, the DOM `data-bars-count`/`data-last-bar-time` attributes and the
  1D branch are untouched; only redundant intermediate writes are dropped.

verification:
  target_test: { result: pass, tests: "tests/unit/seekWhilePlayingFreeze.test.ts 5/5; tests/integration/seekTimelineCandles.test.tsx 3/3" }
  mutation_check: { result: skipped, reason_if_skipped: "Stryker not configured in this repo (no stryker.conf, not a dependency); performed manual mutation testing at the fix sites instead", mutant_killed: "5/5 — M1 drop seekEpoch from the useChartData refresh condition (killed by the integration guard, chartData stayed at 30 bars); M2 write per tick, defeating coalescing (killed 3x: 3602>6, 7259>270, 19>3); M3 never flush on bucket change (killed: buckets 1790343000/060/120 missing); M4 never flush at end of batch (killed: 0 writes on a frame delta); M5 never bump seekEpoch in the store (killed 2x: rewind leak + integration guard)" }
  no_op_deletion: { result: pass, deletion_justified_by_rca: false, note: "Diff adds behaviour (seekEpoch signal, snapshot refresh, write coalescing) and deletes none. The store's 274-line diff is a pure move: normalizing `set({...})` -> `return {...}` and stripping the epoch flag, the extracted `computeSeekPatch` body is line-for-line identical to HEAD's `seekTickTime` (100/100 lines)." }
  adjacent_tests: { result: pass, suites_run: ["vitest full suite: 95 files / 563 passed / 2 skipped / 0 failed", "tsc --noEmit: clean", "vite build: clean (464.01 kB, 10.59s)"] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, note: "git stash of the three src files -> 4/5 guard assertions failed with the original numbers (3600 writes, 0 writes on rewind, 7199 writes over 30 seeks, 18 writes per frame); git stash pop -> 5/5 pass." }
  e2e_browser: { result: skipped, reason_if_skipped: "Authoring sandbox has no browser binary and the download host is unreachable. First real-browser run (maintainer's machine, Chromium installed) executed the probe but it failed on its own serialization bug — ReferenceError: reset is not defined — so no measurement was produced. Bug fixed and guarded in tests/unit/freezeProbeInPage.test.ts; a re-run is pending. Neighbouring live E2E did run green there: chartShaking, realtimePlayback, sync/." }
  real_data_uat: { result: skipped, reason_if_skipped: "No tick lake in the authoring sandbox. On the maintainer's machine the real lake is confirmed present (19 symbols, 1.88 GB) and the live seek regressions pass against it, but the human UAT script in the verification brief (seeking while playing at 1x, 10x step fwd/back, full scrub, HH:MM:SS jumps, rewind future-candle check) has not been performed yet." }
  backend_pytest: { result: pass, evidence: "232 passed / 2 skipped on the maintainer's machine (Darwin arm64, real tick lake) at 7b7d551; no backend files changed by this fix." }
  guardrail_verdict: accepted
  rejected_signal: null

oracle_type: derived + specified — the write bound (one primitive write per candle bucket, never
  per tick) is derived from the chart's own unit of state; the rewind assertion (no bucket newer
  than the playhead may remain) is specified by the project's stated invariant of absolute
  temporal isolation / zero future data leakage.
files_changed:
  - src/store/usePlaybackStore.ts
  - src/hooks/useChartData.ts
  - src/hooks/useChartLifecycle.ts
  - tests/unit/seekWhilePlayingFreeze.test.ts (new)
  - tests/integration/seekTimelineCandles.test.tsx (added real-hook seek-while-playing guard)
