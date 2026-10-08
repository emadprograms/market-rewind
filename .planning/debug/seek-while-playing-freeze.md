---
status: awaiting_human_verify
trigger: "I keep running into this issue where on my tab trying to seek forward or backward while the replay is playing immediately crashes the pages and makes it non responsive."
created: 2026-10-08T04:50:00.000Z
updated: 2026-10-08T14:30:00.000Z
---

## Current Focus
<!-- OVERWRITE on each update - always reflects NOW -->

hypothesis: CONFIRMED in direction (see Resolution.root_cause). Cause 2 (1D per-tick
  O(ticks x future) work) is supported by browser timing but NOT yet profiled. Cause 1 and
  cause 2 contributions are not separated. SEEK-BULK-01 (this round) removes the O(buckets)
  write cost of a multi-bucket seek. Its browser effect is not yet measured.
test: In-sandbox: tsc 0; vitest 98 files / 594 passed / 2 skipped; tests/unit/seekBulkRebuild.test.tsx
  (3 new) kills all three mutants. Browser: pending the user's probe on the new SHA (see Evidence).
expecting: At 1x, 25x and 100x on the dense tape: writes <= 12 per chart per step (FLAT, user
  decision this round), frame gap < 1500 ms, storeSeekMs < 5000 ms on forward60m, no page errors.
  chartShaking, realtimePlayback and sync stay green.
next_action: (1) User runs the harness pinned to the new SHA: --quick, then --ab (no --soak). The
  A/B verdict must read VALID and 9a must FAIL before any A/B result is quoted. (2) Confirm the
  5-min forward60m writes are <= 12. (3) User confirms the fix; only then archive to resolved/
  and add a knowledge-base entry.
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

- timestamp: 2026-10-08T11:03:17Z (maintainer's machine, real tick lake, Chromium, detached @ b9bef7b)
  checked: "Real-browser probe on the fix, 2 tapes (AAPL 2026-09-25 09:30 primary; NVDA densest) at 1x, 25x, 100x."
  found: |
    Canvas write fix CONFIRMED: 3-minute step = 2-4 writes/chart (was ~3,601); rewind
    futureBars = 0 on both tapes; backward seeks 20-68 ms; chartShaking/realtimePlayback/sync PASS.
    Main-thread fix INCOMPLETE: store-side seek forward60m = 4,480 ms (AAPL, 29.5k ticks) and
    8,142 ms (NVDA, 72.9k ticks); frame gaps 4.5-8.2 s. Forward 3-min step on the dense tape stalls
    2.3-2.8 s. Failing assertion: "frame stalled during forward60m, expected < 1500, received 4498".
  implication: "The residual stall is independent of the write count. Something per-tick still runs."
- timestamp: 2026-10-08T13:10:00Z
  checked: "Subscriber 6, 1D branch, per catch-up tick (src/hooks/useChartLifecycle.ts)"
  found: |
    (a) For timeframe 1D, each catch-up tick re-aggregates the whole day's bucket (~390 minute bars)
        even though that aggregate does not depend on the tick.
    (b) The forming-minute scan starts at symbolTicks.length - 1. symbolTicks is ticksBySymbol[sym],
        the ENTIRE buffered tape, future ticks included. Every call walks every future tick before it
        reaches the current minute. Cost per call is O(future ticks), so the batch is O(ticks x future).
  implication: "Explains the measured asymmetry: backward seeks process nothing (3-12 ms) and the
    end-of-tape jump takes the reachedEnd branch (57 ms). Forward seeks scale with ticks x tape."
- timestamp: 2026-10-08T13:40:00Z
  checked: "Synthetic benchmark, 72,935-tick tape, 60-minute catch-up of 9,370 ticks (sandbox, not browser)"
  found: |
    Memoised per bucket: NEW total 10.3 ms vs ORIGINAL per-tick ~3,129 ms (extrapolated).
    Forming scan alone: ORIGINAL from-end 21.2 ms per call; NEW binary-searched start 0.0099 ms per call.
  implication: "Both changes are needed. The memo removes ~9,000 calls; the binary search removes the
    future walk from each call that remains. Absolute numbers are sandbox-specific, not browser ground truth."
- timestamp: 2026-10-08T14:20:00Z
  checked: "Journey-suite default anchor (the 09:20-vs-09:10 defect from the first run)"
  found: |
    e57efe8 is titled 'default start time to 09:10'. The app is the intended side and the test
    fixtures are stale. The mock tape (ET_OPEN) and its consumers were moved to 09:10 together, so
    the default anchor has data. 53 occurrences in journey/ and mocks/ changed. replay/*.spec.ts and
    tickReplayDateReset.test.tsx were NOT changed (they are explicit-anchor or out of the approved scope).
  implication: "Journey results are NOT verified here (no browser). Lists 74 tests in 14 files."

- timestamp: 2026-10-08T16:19:37Z
  checked: "User's dense-tape probe run, stamp 20261008-190034, 2 charts (default layout), 1x, SPY 09:30 dense tape, detached at ccb2af0"
  found: |
    Fix side (steps 6, 6b, 6c, 6d PASS): forward60m storeSeekMs 6.9-9.6 ms on AAPL and 8.9-9.4 ms on
    NVDA, down from 4,480 and 8,142 ms. Frame gaps 17-32 ms, down from 4.5-8.2 s. fullTapeJump 17-32 ms.
    Writes within budget on 1x and 25x for steps. 100x: settled [50,38]. Journey 01-boot fails on
    the baseline expectation (09:20) and passes 5/5 on the fix.
    Write count on the 5-min chart: [14,2] at 1x and 25x, [15,3] at 100x for forward60m. That is above
    the acceptance target of <= 12 per chart per step. Not yet decided.
    A/B INVALID: step 9a ("baseline", expect FAIL) PASSED with fix-side numbers (storeSeekMs 9.6 ms, not
    4,480 ms). 9d and 9e match exactly. Cause: webServer reuseExistingServer on a hardcoded :3000 when
    CI is unset, so a leftover server served the fixed code. The harness's source check compared the
    worktree to its own ref and could never fail. Fixed in d8905cc (guards: src tree must equal the ref,
    port 3000 must be free, fail-closed on unknown ref; verdict VALID/INVALID). Guard self-tests passed.
    Sandbox note: the local branch had been reset to e57efe8 by a sandbox rollback. Every changed file was
    checked byte-for-byte against ccb2af0 and none was lost. The branch now points at the pushed tip.
  implication: |
    Cause 2 is supported by a browser-side measurement: the forward60m store cost dropped about 450x on
    AAPL and 900x on NVDA after the fix. CODE-INFERRED UNTIL PROFILED. The end-to-end timing cannot yet
    attribute the drop between cause 1 (seekEpoch rebuild) and cause 2 (1D memo and binary search).
    Next: a Chrome Performance profile of subscriber 6 on the 1D branch, or a before/after timing with
    one of the two changes reverted. The baseline must be re-measured with the fixed harness before
    "fails on baseline, passes on fix" is claimed.
    Journey staleness is resolved in c1d57b2 (09:20 -> 09:10, 53 occurrences in journey/ and mocks/).
    replay/dateReset.spec.ts still expects 09:20. Out of the approved scope. Decision open.
    chartIntegrity and randomDayReplay fail on a strict-mode locator on the step-size select. PlaybackBar.tsx
    is unchanged in this PR, so this PR does not cause it. Not yet checked against a clean baseline run.

- timestamp: 2026-10-08T16:26:05Z
  checked: "Write budget decision and SEEK-BULK-01 (user chose a flat <= 12 per chart per step)"
  found: |
    Root of the 14-15 writes: the per-bucket catch-up. Subscriber 6 calls queueUpdate once per bucket, and
    an incremental rebuild appends each new bar with update(). A 60-minute seek on the 5-min chart is 12
    buckets, so 12 update pairs plus the forming bar.
    Change: (1) subscriber 6 skips the catch-up when a seek (seekEpoch changed since it last ran) spans more
    than one bucket, and sets forceFullRebuildRef; (2) effect 3 honours that flag and takes the setData
    path (one setData per series). Playback frames without a seek are unchanged. seenSeekEpoch is read on
    every call, so a seek made while paused cannot leak into the next playing frame.
    Earlier "skip subscriber 6 on seekEpoch" attempt was abandoned because it broke DIAG 2. DIAG 2 is a
    single-bucket case, so the > 1 bucket rule keeps it intact (verified: diagnostic suite green).
    Budget: spec WRITES_PER_SEEK_BUDGET is flat 12. The bucket-scaled budget from 695d764 is removed. The
    brief (docs/reviews/...brief.md) already states the flat <= 12, so the code now matches it.
    Mutation: skip disabled -> test 1 fails; force flag ignored -> test 1 fails; seen-epoch never updated ->
    tests 2 and 3 fail. The hook was restored and verified with cmp after each mutant.
    Also: replay/dateReset.spec.ts moved 09:20 -> 09:10 (user-approved this round).
  implication: |
    In-sandbox only: the write count and bulk rebuild are proved on the mocked hook, not in a browser.
    The browser effect on the 5-min chart (expected about 2 setData writes plus forming-bar updates) is
    unverified until the user's probe runs on the new SHA. CODE-INFERRED UNTIL PROFILED, as for cause 2.
    Known non-run here: chartShaking, realtimePlayback, sync, journey, and the seek probe are browser-only.

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
  (C) RESIDUAL, found on the first real run after (A)/(B) were fixed: subscriber 6's 1D branch
  did per-tick work proportional to ticks x FUTURE ticks. The forming-minute scan started at the
  end of the full buffered tape (`ticksBySymbol` includes every future tick), and the daily-bucket
  aggregate was recomputed for every catch-up tick. Measured on the real machine: 4.5-8.2 s stall
  per 60-minute forward seek with writes already fixed. Sandbox bench attributes ~3.1 s to the
  per-tick aggregate and ~21 ms per call to the from-end scan, against ~9,370 calls.
  Contributing conditions, not causes: buffer sized at `limit: 100000` ticks/symbol, and the
  same per-tick write granularity also firing at high speed multipliers (18 writes for a
  900ms frame at 20 ticks/sec).

fix: >
  Five changes. (4) `src/hooks/useChartLifecycle.ts` (fixes cause C): the tick-independent 1D
  aggregate is `aggregateDailyBucket(...)`, memoised per (bucket, evalTime) within a batch. The
  forming-minute scan starts at `findFirstTickAfter(symbolTicks, evalTimeMs) - 1`, not the tape's
  end. The only per-tick piece is `applyDailyTickFallback(...)`, an O(1) pure function shared with
  the tests. (5) `tests/regression/chart/seekWhilePlayingFreeze.spec.ts`: the write budget is now
  12 slack + one write pair per 5-minute bucket the seek crosses. The stall budget is unchanged.
  Journey anchor 09:20 -> 09:10 across journey/ and mocks/ (see Evidence).
  Three changes from the first pass. (1) `src/store/usePlaybackStore.ts`: added `seekEpoch`, a monotonic counter
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
  mutation_check_cause_c: { result: pass, mutants_killed: "5/5 on tests/unit/dailyBucketAggregate.test.ts: M1 linear from-end scan (locality test); M2 drop lastBarClose fallback (synthetic fallback test); M3 forming boundary >= (boundary test + equivalence); M4 drop tick volume in fallback (equivalence); M5 drop fallback entirely (equivalence). Two survivors on the first pass were test gaps, not acceptable survivors, and were closed by moving the fallback into an exported pure function the test calls." }
  mutation_check: { result: skipped, reason_if_skipped: "Stryker not configured in this repo (no stryker.conf, not a dependency); performed manual mutation testing at the fix sites instead", mutant_killed: "5/5 — M1 drop seekEpoch from the useChartData refresh condition (killed by the integration guard, chartData stayed at 30 bars); M2 write per tick, defeating coalescing (killed 3x: 3602>6, 7259>270, 19>3); M3 never flush on bucket change (killed: buckets 1790343000/060/120 missing); M4 never flush at end of batch (killed: 0 writes on a frame delta); M5 never bump seekEpoch in the store (killed 2x: rewind leak + integration guard)" }
  no_op_deletion: { result: pass, deletion_justified_by_rca: false, note: "Diff adds behaviour (seekEpoch signal, snapshot refresh, write coalescing) and deletes none. The store's 274-line diff is a pure move: normalizing `set({...})` -> `return {...}` and stripping the epoch flag, the extracted `computeSeekPatch` body is line-for-line identical to HEAD's `seekTickTime` (100/100 lines)." }
  adjacent_tests: { result: pass, suites_run: ["vitest full suite: 95 files / 563 passed / 2 skipped / 0 failed (round 1)", "vitest full suite: 97 files / 591 passed / 2 skipped / 0 failed (round 2, after cause C)", "tsc --noEmit: clean (both rounds)", "vite build: clean (round 2, 463.99 kB)", "playwright --list: journey 74 tests / 14 files; probe 5 tests"] }
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
