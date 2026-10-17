---
status: awaiting_human_verify
trigger: "For example, the chart for 14th October 2026 is not forming properly. Sometimes the 1D chart is not formed properly. There are multiple issues but all of them are related to the one day chart. (1) When I reset/load into 15th October, the 14th October candle is wrong. (2) When playback is playing the 1D chart, the latest day's candle (15th October) is not visible - the price is moving around - and only when I pause does the candle become visible. Fails in a 2-chart layout (5m left, 1D right, same symbol); a lone 1D chart works fine."
created: "2026-10-17T06:45:00.000Z"
updated: "2026-10-17T12:30:00.000Z"
---

## Current Focus

hypothesis: RESOLVED — one defect class explains both reported symptoms. The chart's *timeframe* was
  passed as the *bar's granularity* into the RTH filter, so `isRthBar(bar, ticker, '1D')` classified
  every constituent 1-minute bar as an already-aggregated daily bar and exempted it from the RTH
  test. The exemption was invisible while `streamingClient.getCandles` fabricated `session: 'REG'`
  on every candle (the service's candle projection returns no session column), because the session
  fast-path accepted everything anyway. Overnight (00:00 UTC = 20:00 ET), pre-market (12:00 UTC =
  08:00 ET) and post-market minutes therefore set the daily open/high/low and inflated daily volume
  to a 24h total on the canvas path — while the snapshot path, which filters by an explicit
  `bMs >= rthOpenMs` window, produced the correct RTH-only candle. Two answers for the same day,
  selected by whether the chart was playing: symptom (1) is the wrong value, symptom (2) is the
  visible snap when pausing swaps the snapshot in.
test: `tests/regression/chart/dailyCandleCanvasFormation.test.tsx` (8 tests) mounts the real
  `useChartData` + `useChartLifecycle` pair for the failing 2-chart layout and asserts on the bars
  actually written to the price/volume series, not on the React snapshot; `tests/unit/dailyConstituentRth.test.ts`
  (13) pins the predicate and the aggregate; `tests/unit/streamingClientSession.test.ts` (4) pins the
  client's session contract so fixtures cannot drift back.
expecting: All three suites pass, the full suite stays green (106 files / 639 tests), and the canvas
  forming candle for 2026-10-14 reads open 250 / low 249 / volume 3000 (RTH-only) instead of
  open 100 / low 99.5 / volume 21400 (24h).
next_action: Human verification on real data — run `bash tools/verify-daily-candle-fix.sh --full --ab --probe`
  per `docs/reviews/daily-candle-formation-verification-brief.md`. The data-side question this
  sandbox cannot answer (is the *backend's* 2026-10-14 `tf=1d` row itself RTH-correct, or is the same
  contamination baked into the lake?) is check C1–C6 of `tools/probe-daily-candle.py`.
bug_class: contract-confusion — a parameter describing the *series* ('1D') was consumed as a property
  of the *bar*, disabling a filter; plus a fabricated default (`|| 'REG'`) that masked it.
reasoning_checkpoint: Symptom (2) was reported as "the candle is missing while playing". That reading
  sent the first three hours after a hydration/empty-snapshot gate in subscriber 6. The repro harness
  disproved it: with `getCandles('1D') → []` the candle still forms while playing and survives the
  pause (see Eliminated). The accurate description of (2) is "the candle *changes* when I pause" —
  which is the same defect as (1) seen from the other side. Lesson recorded: when a symptom is
  "X only appears in state A", first test whether X is present-but-different in state B.
tdd_checkpoint: null

## Symptoms

expected: On the 1D chart the latest trading day's candle forms live while playback is running
  (identical to what is visible after pausing), and every completed day's candle matches the
  RTH-only daily aggregate served by the backend (`tf=1d&session=REG`). Layout (1 vs 2 charts) must
  not change either behaviour.
actual: (a) Loading into 2026-10-15 shows a wrong candle for 2026-10-14. (b) While playing, the
  1D chart shows no candle for the latest day (price line moves, no body); the candle only appears
  after pausing. (c) Reproduces with a 2-chart layout (5m + 1D, same symbol); a lone 1D chart is fine.
errors: None reported by the user. Candidate silent failures found in code:
  `streamingClient.getCandles` returns `[]` on timeout/abort (15s) with only a console.warn;
  `useChartLifecycle` swallows series errors with console.warn; `useChartData` logs
  "[useChartData N] Diagnostic: Filtered data severely reduced".
reproduction: Automated — `tests/regression/chart/dailyCandleCanvasFormation.test.tsx`, describe
  "1D forming candle while replaying ON 2026-10-14". Manual — 2-chart layout, same symbol both charts
  (5m left with ETH, 1D right), session date 2026-10-15, entry 09:10 ET, press play; then pause and
  watch the latest candle change shape.
started: Reported 2026-10-17. Unknown whether it ever worked in a multi-chart layout; the
  single-chart path is reported working.

## Eliminated

- hypothesis: Daily bucket timestamps are inconsistent between the snapshot path and the canvas path
    (midnight vs noon UTC), producing duplicate/out-of-order bars.
  evidence: All three producers agree on noon-UTC seconds for 1D: `resampleData` emits
    `YYYY-MM-DD 12:00:00`, `getBucketTimestamp` emits the same string, `dailyIndex.getBucketTime`
    emits `Date.UTC(y,m,d,12,0,0)/1000`, and `useChartLifecycle.formatBar` parses bar strings as UTC
    (`+'Z'`). Backend midnight-UTC daily bars are re-bucketed to noon by `resampleData`.
  timestamp: 2026-10-17T07:05:00.000Z

- hypothesis: A timezone suffix in the backend's ISO timestamps (`2026-10-14T00:00:00+00:00`) breaks
    `isRthBar`'s `endsWith(' 00:00:00')` daily detection and filters daily history out.
  evidence: `streamingClient.getCandles` normalises every row with
    `row.time.replace('T',' ').slice(0,19)`, so daily bars arrive as `2026-10-14 00:00:00` and
    survive both `isRthBar` and `resampleData`.
  timestamp: 2026-10-17T07:08:00.000Z

- hypothesis: (H1) The canvas path is permanently gated during playback — subscriber 6 returns early
    on `!isHydratedRef.current` or an empty `chartData` snapshot, so the forming daily candle can
    only ever come from a pause-triggered snapshot rebuild.
  evidence: Disproved by test. Harness diagnostics with `getCandles('1D') → []` (empty snapshot)
    report `isHydrated: true`, `renderedTimes: [1792065600]`, `priceLineCalls: 2` — the candle forms
    *while playing* and survives the pause. The empty-`chartData` branch of effect 3 does not
    permanently gate subscriber 6, because the `prevLoadingRef` effect hydrates when loading ends
    with 0 bars. Both empty-snapshot tests pass.
  timestamp: 2026-10-17T09:40:00.000Z

- hypothesis: The 2-chart layout is materially different from a lone 1D chart (shared series
    registry, chart-init ordering, or one chart starving the other), which is why only the 2-chart
    setup fails.
  evidence: Disproved by test. The lone-1D-chart case (R4) initially failed in the harness for an
    unrelated reason — a hydration race: jsdom's `requestAnimationFrame` never fires inside `act`, and
    hydration is completed in a rAF callback, so `playFrames` could run before `isHydrated` flipped.
    With an unconditional rAF shim plus `waitForHydration(id)` before playback, the single-chart and
    2-chart cases behave identically and both pass. No registry or init-ordering defect exists.
  timestamp: 2026-10-17T09:55:00.000Z

- hypothesis: The backend serves the daily bars in the wrong order or truncates them (DESC + LIMIT
    then reverse), so the 2026-10-14 row the frontend receives is already wrong.
  evidence: `query_candles` orders DESC, applies LIMIT, then reverses — ascending and correct. Test R2
    passes: given the backend-shaped `2026-10-14` row (open 250 / high 260 / low 249 / close 255 /
    volume 390000) the frontend renders exactly those values, so the frontend is faithful to whatever
    the service returns. Whether the *service's* row is itself RTH-correct needs real data: probe
    checks C1–C4.
  timestamp: 2026-10-17T10:10:00.000Z

- hypothesis: Making `RawBar.session` optional (so intraday candles can carry no session) breaks
    type-checking or the existing RTH contracts.
  evidence: `tsc --noEmit` reports 0 errors; `vite build` succeeds in 2.85s; the full suite is green.
    The two existing tests that document "session-less daily bars are preserved"
    (`tests/unit/dailyRthChart.test.ts`, `tests/unit/timezones.test.ts`) initially failed against a
    first attempt that tightened `isRthBar` itself. That attempt was reverted: `isRthBar` keeps its
    documented behaviour byte-for-byte and the new `isRthConstituentBar` carries the stricter rule,
    so no existing contract was weakened to make a test green.
  timestamp: 2026-10-17T12:10:00.000Z

## Evidence

- timestamp: 2026-10-17T06:50:00.000Z
  checked: package/deps and GSD wiring
  found: `@opengsd/gsd-core@1.17.0` resolves from `^1.16.0`; `node_modules` is not persisted in this
    sandbox, so `npm install` must be re-run each session. Baseline suite: 103 files / 618 tests
    passed, 2 skipped.
  implication: Green baseline exists; any new failing test is a genuine repro, not pre-existing noise.

- timestamp: 2026-10-17T06:58:00.000Z
  checked: src/lib/timezones.ts `isRthBar`
  found: `const isDaily = timeframe === '1D' || /^\d{4}-\d{2}-\d{2}$/ || endsWith(' 00:00:00' |
    ' 12:00:00' | ' 04:00:00' | ' 05:00:00')`, and the daily branch returns `true` when
    `bar.session` is absent or contains REG.
  implication: Passing `timeframe='1D'` disables RTH filtering for *constituent* 1-minute bars.
    `buildDailyIndex(masterData, sym, ticker, '1D')` and the CONV-VOL-01 loop both pass '1D', so ETH
    minutes enter the daily bucket. Separately, any intraday bar stamped 00/04/05/12:00:00 UTC is
    misclassified as a daily bar.

- timestamp: 2026-10-17T07:00:00.000Z
  checked: backend/streaming_service/tick_lake_reader.py `query_candles` transform
  found: Candle rows return time/symbol/open/high/low/close/volume/tick_count and **no `session`
    key**; `1d` forces `upper(session)='REG'` (need_session=True), and with no `start_time`
    `resolve_files` spans every partition up to `end_time`.
  implication: (a) `streamingClient` defaulted `session='REG'` for *all* candles including 1m ETH
    bars, which defeats every session-string-based RTH filter downstream. (b) One partition without a
    common `session` column raises `LakeIncompatibleSchema` for 1d only -> the frontend catches and
    returns `[]` -> empty 1D history while 1m/5m charts look fine. Data-side check required (probe C1).

- timestamp: 2026-10-17T07:12:00.000Z
  checked: src/hooks/useChartData.ts (PERF-01 subscription + 1D snapshot block)
  found: During playback (`isPaused === false`) React state (`globalTime`, `latestTick`,
    `symbolTicks`) is only refreshed on `ticksChanged`/`seekChanged`, so `chartData` is frozen; the
    forming daily candle is built from `candidateBars` (global 1m `masterData` when the symbol
    matches, else daily `localMasterData`) filtered by `bMs >= rthOpenMs`.
  implication: The snapshot path applies a real RTH time window; the canvas path relied on the
    session/timeframe filter that was disabled. That asymmetry is why pausing changed the candle.

- timestamp: 2026-10-17T07:15:00.000Z
  checked: src/hooks/useChartLifecycle.ts effect 3 + subscriber 6 + hydration
  found: The `chartData.length === 0` branch of effect 3 clears the series and never sets
    `isHydrated`; subscriber 6 returns early when `state.isPaused || !series || !isHydratedRef.current`,
    and again when `newlyElapsedTicks.length === 0`. `updateBidAskPriceLines` runs *before* those
    daily-path returns.
  implication: Explains the *reported* "price is moving but no candle" reading, and was the reason H1
    looked plausible. The bid/ask price lines moving proves the subscriber is alive, but it does not
    prove the daily path was reached — subsequently disproved as the cause (see Eliminated).

- timestamp: 2026-10-17T07:18:00.000Z
  checked: tests/integration/multiChartWorkspaceReplay.test.tsx
  found: The existing multi-chart 5m+1D test asserts only `useChartData().chartData` (the React
    snapshot). No test mounts `useChartLifecycle` with a stateful series to assert what is actually
    written to the canvas during playback.
  implication: Test-coverage gap explains why this defect survived a green suite; the new harness must
    assert on series writes (setData/update), not on the snapshot.

- timestamp: 2026-10-17T11:20:00.000Z
  checked: canvas state during playback, replaying ON 2026-10-14, 2-chart layout (pre-fix tree)
  found: |
    canvasForming:   { time: 1791979200, open: 100, high: 252.5, low: 99.5, close: 252 }
    volumeBar:       { time: 1791979200, value: 21400 }   // 4800 overnight + 6600 pre-market + 10000 RTH
    snapshotForming: null                                   // snapshot frozen by PERF-01 while playing
  implication: The drawn candle's open (100) is the overnight print and its low (99.5) the overnight
    low; volume is a 24h total, not RTH. Confirms the contamination is on the canvas path and that
    the snapshot path holds a different (correct) answer — the two paths disagreed for the same day.

- timestamp: 2026-10-17T11:50:00.000Z
  checked: same canvas state after the fix
  found: `canvasForming.open: 250` (first RTH print), `low: 250` at 13:40 UTC evaluation,
    `volumeBar.value: 10000` (10 RTH minutes x 1000). Diagnostics for the passing 2-chart playback
    case: `isPaused false, snapshotLen 8, snapshotTimes 2026-10-05..10-14 12:00:00, isHydrated true,
    priceLineCalls 2, latestTick 2026-10-15 13:31:05 price 252 session REG, latestIsRth true,
    symbolTickCount 67, masterDataLen 4320, priceWrites 11 (8 setData + 3 update), seriesErrors [],
    rafScheduled 3 / rafFired 3`.
  implication: Canvas and snapshot now agree, so nothing visibly changes when playback is paused.
    R3 confirms no duplicate or older-time series writes were introduced.

- timestamp: 2026-10-17T12:18:00.000Z
  checked: revert-and-reconfirm via `bash tools/verify-daily-candle-fix.sh --ab` (temporary worktree
    at b5aaa21 with the new tests copied in, i.e. pre-fix src + post-fix tests)
  found: `Test Files 1 failed (1) / Tests 1 failed | 7 passed (8)` —
    `AssertionError: daily open must be the first RTH print (250), never an overnight/pre-market bar:
    expected 100 to be 250`. On the fixed tree the same file is 8/8 green.
  implication: This change is what fixes it (Agans Rule 9). The failing assertion is the reported
    symptom, reproduced and then removed by the fix.

- timestamp: 2026-10-17T12:25:00.000Z
  checked: mutation signal — two hand-seeded mutants at the fix sites (no Stryker in this repo)
  found: Mutant A (`isRthConstituentBar` -> `return true`, i.e. delete the RTH test) killed by 7
    tests across `dailyConstituentRth` and the canvas repro. Mutant B (`streamingClient` intraday
    session back to `row.session || 'REG'`) killed by 2 tests in `streamingClientSession`. Both
    mutants reverted; tree restored green (21/21 across the three files).
  implication: The tests assert the root cause, not the symptom — neither hunk of the fix can be
    deleted without a test failing.

## Resolution

root_cause: |
  A parameter that describes the SERIES was consumed as a property of the BAR. `isRthBar(bar, ticker,
  timeframe)` treats `timeframe === '1D'` as "this bar is an already-aggregated daily bar" and returns
  true without any RTH test. Two callers pass the chart's timeframe while iterating the day's
  CONSTITUENT 1-minute bars — `buildDailyIndex(masterData, sym, ticker, '1D')` (src/lib/dailyIndex.ts)
  and the CONV-VOL-01 volume-reconstruction loop (src/hooks/useChartLifecycle.ts) — so on a 1D chart
  the RTH filter became a no-op and `getBucketTime('1D')` (UTC calendar day) put every minute of the
  UTC day into that day's bucket. Overnight, pre-market and post-market minutes therefore set the
  daily open/high/low and made daily volume a 24h total.
  Two things hid it. (1) `streamingClient.getCandles` defaulted `session: 'REG'` on every candle even
  though the service's candle projection returns no session column at all, so even a working
  session-string fast-path would have accepted ETH bars as RTH. (2) The React snapshot path
  (`useChartData`) filters constituents by an explicit `bMs >= rthOpenMs` window and was always
  correct — but PERF-01 freezes it during playback. The canvas path (wrong) therefore owned the
  picture while playing, and the snapshot path (right) took over on pause: the reported "the candle
  only appears when I pause" is the moment the two paths swapped, and the reported "the 14th October
  candle is wrong" is the canvas path's value.
fix: |
  1. src/lib/timezones.ts — new `isRthConstituentBar(bar, ticker?)`: the RTH test for the intraday
     bars a daily candle is aggregated FROM, sharing one `isIntradayRth` helper with `isRthBar`'s
     intraday branch. It never applies the daily-shape short-circuit, so a session-less constituent
     stamped 00/04/05/12:00 UTC is classified by timestamp (20:00/00:00/01:00/08:00 ET) instead of
     being waved through. `isRthBar` itself is unchanged — the documented "preserve session-less daily
     bars" contract still holds.
  2. src/lib/streamingClient.ts — stop fabricating a session on candles. `session` is asserted 'REG'
     only for daily candles (where the service enforces `upper(session)='REG'` in SQL) and left
     `undefined` for intraday candles, whose session the service does not report. `RawBar.session`
     is now optional, with the reason documented at the type.
  3. src/lib/dailyIndex.ts + src/hooks/useChartLifecycle.ts (CONV-VOL-01) + src/hooks/useChartData.ts
     (`todayBars`) — the three constituent-bar filters now call `isRthConstituentBar(bar, ticker)`
     instead of `isRthBar(bar, ticker, '1D')`.
  4. New `sessionLabelFor(timestampMs, ticker?)` / `sessionLabelForTime(timeStr, ticker?)` in
     src/lib/timezones.ts — the only sanctioned way to PRODUCE a session label. Adopted at every
     remaining `|| 'REG'` default: synthesized ticks (src/store/usePlaybackStore.ts x4,
     src/lib/tickSynthesizer.ts), live tape ticks (src/lib/streamingClient.ts x2), synthesized
     intraday candles (src/lib/candleSynthesizer.ts) and tick-built buckets (src/hooks/useChartData.ts
     x2). An overnight or pre-market minute can no longer fabricate an RTH print that leaks into an
     RTH-only aggregate or creates a wrong-day 1D candle.
verification:
  target_test: { result: pass, tests: "tests/regression/chart/dailyCandleCanvasFormation.test.tsx (8), tests/unit/dailyConstituentRth.test.ts (13), tests/unit/streamingClientSession.test.ts (4)" }
  mutation_check: { result: pass, reason_if_skipped: "Stryker is not configured in this repo — mutants seeded by hand at both fix sites instead", mutant_killed: true, mutants: "A: isRthConstituentBar -> return true (killed by 7 tests); B: streamingClient session -> row.session || 'REG' (killed by 2 tests)" }
  no_op_deletion: { result: pass, deletion_justified_by_rca: true, note: "The only removals are the fabricated `|| 'REG'` defaults and the `timeframe` argument at constituent-filter call sites — both ARE the defect per the RCA. The diff adds two exported predicates, two label producers, and 21 tests; no branch was short-circuited to suppress a symptom." }
  adjacent_tests: { result: pass, suites_run: ["full vitest suite: 106 files / 639 passed / 2 skipped (baseline was 103 / 618)", "tsc --noEmit: 0 errors", "vite build: success in 2.85s", "tools/verify-daily-candle-fix.sh: 9 targeted suites green"] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, note: "temporary git worktree at b5aaa21 with the new tests copied in -> 1 failed / 7 passed (expected 100 to be 250); fixed tree -> 8/8" }
  guardrail_verdict: accepted
  rejected_signal: null
  outstanding: |
    Data-side verification cannot run in this sandbox (no access to the user's tick lake). The
    frontend is now provably faithful to whatever the service returns (test R2), but whether the
    service's own 2026-10-14 `tf=1d` row is RTH-correct — or carries the same whole-UTC-day
    contamination from the lake's `session` column — is what `tools/probe-daily-candle.py` checks
    (C1 query shape and timing, C2 REG vs ALL, C3 tick-level ground truth, C4 session labelling,
    C5 whether 1m serves ETH minutes, C6 contention against the 15s client timeout).
oracle_type: specified
files_changed:
  - src/types/index.ts
  - src/lib/timezones.ts
  - src/lib/streamingClient.ts
  - src/lib/dailyIndex.ts
  - src/lib/candleSynthesizer.ts
  - src/lib/tickSynthesizer.ts
  - src/hooks/useChartLifecycle.ts
  - src/hooks/useChartData.ts
  - src/store/usePlaybackStore.ts
  - tests/regression/chart/dailyChartHarness.ts
  - tests/regression/chart/dailyCandleCanvasFormation.test.tsx
  - tests/unit/dailyConstituentRth.test.ts
  - tests/unit/streamingClientSession.test.ts
  - tools/probe-daily-candle.py
  - tools/verify-daily-candle-fix.sh
  - docs/reviews/daily-candle-formation-verification-brief.md

## Follow-ups (found, deliberately NOT fixed here)

- ETH toggle is inert for lake-sourced intraday bars. `useChartData.filteredData` keeps a bar when
  `!d.session`, which — now that intraday candles honestly carry no session — means every 1m/5m bar
  survives regardless of `showEth`. Pre-existing (the old fabricated 'REG' also passed that check),
  out of scope for the 1D cluster, and fixing it changes what intraday charts render. Probe check C5
  says whether the lake even serves ETH minutes.
- `tf=1d` with no `start_time` resolves every partition up to `end_time`. Correct but unbounded;
  combined with the client's 15s `AbortSignal.timeout` and a silent `return []` on abort, a slow lake
  under 2-chart load blanks the 1D history with only a console.warn. Probe check C1/C6 measures it.
- `streamingClient.getCandles` line ~558: `if (isDailyCandle && session === 'PRE') session = 'PRE, REG'`
  is unreachable while `tf=1d` forces `upper(session)='REG'` in SQL. Harmless; noted for the next
  reader.
- `tests/helpers/chart-simulation.ts` shares ONE `mockChart`/`mockSeries` across all charts, so it
  cannot distinguish a 5m chart from a 1D chart. `tests/regression/chart/dailyChartHarness.ts` exists
  because of that; other multi-chart tests still assert only the React snapshot.
