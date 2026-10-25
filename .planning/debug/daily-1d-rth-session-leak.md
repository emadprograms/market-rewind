---
status: awaiting_human_verify
trigger: "1D daily chart construction is wrong: live/forming daily candle leaks premarket/postmarket OHLCV because candle rows carry no session and the client defaults them to REG"
created: 2026-10-25T16:05:00+03:00
updated: 2026-10-25T16:45:00+03:00
---

> Human verification PENDING (2026-10-25): user has NOT accepted the fix. PR #8
> was opened so the branch can be pulled and tested on the user's local machine.
> Do not archive to resolved/ or treat the KB entry as confirmed until the user
> reports end-to-end verification. Self-verification guardrail signals below
> remain valid but are not a substitute for human acceptance.

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

status: fixing (RED phase complete — 10 frontend + 3 backend regression tests fail as predicted)

reasoning_checkpoint:
  hypothesis: "PRE/POST 1-minute tape bars enter the live 1D daily bucket because candle rows lose session identity at the backend SELECT and the client relabels them REG, while the live aggregation has no wall-clock RTH gate."
  confirming_evidence:
    - "Backend probe: query_candles 1m rows return keys [time,symbol,ohlcv,tick_count] with no session while query_ticks rows include session; SQL at tick_lake_reader L797-817 never selects projection.session_expr."
    - "streamingClient L546 maps row.session || 'REG'; probe tests/probe-1d-session-leak.test.ts shows all four PRE/REG/POST bars then pass isRthBar and aggregate to O10/L5/V1102 vs RTH oracle O100/L100/V3."
    - "Snapshot memo useChartData L503-513 stays clean thanks to its explicit rthOpenMs..rthCloseMs window, proving the missing gate in buildDailyIndex is the live-path differentiator."
    - "RED tests: tests/unit/dailyRthSessionGuard.test.ts 10 failing; backend test_candle_session_labels.py 3 failing with KeyError 'session'."
  falsification_test: "If the hypothesis is wrong, adding a truthful session column to candles plus a wall-clock RTH gate on tape bars would NOT make the RTH-oracle assertions pass; if PRE/POST bars still appear in the daily bucket after both changes, the mechanism is elsewhere."
  fix_rationale: "Backend fix restores the lost data contract (truthful per-bucket session) at the source; the frontend wall-clock gate makes daily RTH isolation independent of label quality and aligns the live path with the already-correct snapshot window; the mapping fix removes fabricated REG; the suffix narrowing prevents 12:00Z intraday bars from hijacking daily-bar preservation. Each targets a confirmed link in the causal chain, not the symptom."
  blind_spots: "Anchored daily history bars (UTC midnight/noon) must never hit the wall-clock gate — verified by data-flow audit that buildDailyIndex only indexes 1-minute playback tape; full existing suites will re-confirm. Crypto/UTC assets must remain 24/7 — getSessionType early-returns RTH for UTC tickers."
  candidate_causes:
    - "code: backend candle SELECT/transform omits session; client defaults missing session to REG"
    - "data: real lake partitions contain PRE/POST ticks while frontend fixtures and Playwright mocks only ever contain REG-session minute bars"
  and_gate: "yes — contamination requires BOTH the missing session contract AND the label-only live filter; either fix alone closes the main vector (backend truth + existing label logic, or wall-clock gate alone), but both are needed for defense-in-depth and for legacy/sessionless sources."

hypothesis: see reasoning_checkpoint
test: GREEN phase — implement four targeted fixes, rerun new tests then full suites
expecting: New tests pass; full vitest (618 baseline) and pytest (232 baseline) remain green; tsc clean
next_action: Apply backend session projection first, then timezones helper + suffix narrowing, dailyIndex gate, useChartLifecycle volume-reconstruction gate, streamingClient mapping.

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: 1D daily candle for an equity contains only regular-session (09:30-16:00 ET) OHLCV, identical whether rendered live (playing) or from the paused/snapshot path; requirement LAKE-RESAMPLE-04 (daily RTH session isolation, session='REG').
actual: Live/forming daily candle includes premarket open/low and postmarket close/low plus extended-hours volume. Oracle RTH O100 H110 L100 C110 V3 vs observed mid-RTH O10 H110 L10 C110 V103 and post-close O10 H110 L5 C5 V1102. Live and paused renders of identical data diverge; daily candle "snaps" on pause/seek.
errors: No runtime errors — silent data-contamination defect.
reproduction: Build a mini tick lake with PRE (12:00Z @10 v100), REG (13:30Z @100 v1; 13:31Z @110 v2), POST (20:30Z @5 v999) ticks; reader.query_candles(timeframe='1m') returns rows with NO session key; streamingClient.getCandles stamps session='REG'; feed through buildDailyIndex/aggregateDailyBucket — all four bars enter the daily bucket. Probe: tests/probe-1d-session-leak.test.ts (9 passing, documents buggy behavior).
started: Always broken against the real tick-lake backend; invisible in frontend suites because all fixtures hand-label sessions and the Playwright mock only builds minute bars from 09:30 ET onward (marketSimulator.ts L238 comment).

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: Backend daily (1d) endpoint itself includes PRE/POST ticks.
  evidence: Reader probe on two-day SPY lake shows 1d query enforces session='REG' (day1 volume 3, not 1102); tick_lake_reader L746-785 adds the REG filter for DAILY_TIMEFRAMES and need_session hard-fails when the column is missing.
  timestamp: 2026-10-25
- hypothesis: Live tick subscriber merges non-RTH ticks into the forming candle.
  evidence: query_ticks rows carry a truthful session column; isRthTick() filters every tick path including aggregateDailyBucket's forming-minute scan (useChartLifecycle L113-121).
  timestamp: 2026-10-25
- hypothesis: Mid-replay 5min->1D timeframe switch rebuilds buckets incorrectly.
  evidence: tests/probe-1d-switch.test.ts passes once hydration rAF frames are flushed; subscriber keeps updating the same noon bucket correctly.
  timestamp: 2026-10-25
- hypothesis: Paused/snapshot 1D path shares the leak.
  evidence: useChartData L503-513 applies an explicit rthOpenMs..rthCloseMs window in addition to isRthBar — snapshot stays RTH-clean; the defect is live-path-only.
  timestamp: 2026-10-25
- hypothesis: direction='desc' backend ordering anomaly contributes.
  evidence: Server honors ORDER BY but streamingClient L563 force-sorts every response ascending; benign, no semantic effect.
  timestamp: 2026-10-25

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-10-25
  checked: backend/streaming_service/tick_lake_reader.py query_candles SQL (L797-817) and transform (L822-837)
  found: Candle SELECT emits only bucket_time, symbol, OHLCV, tick_count — no session; transform dict keys are [time, symbol, open, high, low, close, volume, tick_count]. query_ticks (L893-901) DOES project session. Projection already builds session_expr ('session' when column exists, else NULL) but candles never select it.
  implication: Session identity exists in the lake and in the projection; candle rows simply discard it — root data-contract gap.
- timestamp: 2026-10-25
  checked: src/lib/streamingClient.ts L546-559
  found: `let session = row.session || 'REG'` stamps every sessionless candle row as REG; a daily-only PRE->'PRE, REG' heuristic exists but never fires for intraday rows.
  implication: Mislabeled PRE/POST 1m bars pass every label-based isRthBar check.
- timestamp: 2026-10-25
  checked: src/hooks/useMarketSimulator.ts L39-52
  found: Replay tape fetch (timeframe 1min, no session param) is pushed into playback masterData unfiltered.
  implication: No intermediate layer removes extended-hours bars before chart aggregation.
- timestamp: 2026-10-25
  checked: src/lib/dailyIndex.ts L82-104 + src/hooks/useChartLifecycle.ts L70-123, L985-1010
  found: buildDailyIndex eligibility is isRthBar-only; aggregateDailyBucket (live subscriber 6) consumes that index with only a barMs<=evalTime cutoff. No RTH time window. A second 1m-tape consumer at useChartLifecycle L756 (CONV-VOL-01 volume reconstruction) has the same gap.
  implication: This is the live-side mechanism; fixing isRthBar labels alone is insufficient because sessionless 1D bars are "preserved" (return true) by design.
- timestamp: 2026-10-25
  checked: src/lib/timezones.ts isRthBar L92-128
  found: (1) 1D branch returns true for any bar without explicit session; (2) isDaily suffix heuristic fires on any ' 12:00:00'/' 00:00:00'/etc. timestamp even for genuine intraday 1m bars (a 08:00 ET premarket 1m bar at 12:00Z is mis-preserved). Existing tests only pin the no-timeframe call shape, so narrowing the suffix shortcut to non-intraday calls is safe.
  implication: Wall-clock guard must live at the 1-minute-tape aggregation chokepoints, independent of labels and suffixes.
- timestamp: 2026-10-25
  checked: data flow audit (useChartData load L237-249, resampleData call sites)
  found: localMasterData holds timeframe-shaped history (anchored daily bars when tf=1D) and must keep going through isRthBar's daily branch; playback masterData is always the 1-minute tape and is the only input to buildDailyIndex. The L728 resample path explicitly excludes 1D.
  implication: The wall-clock gate applies only to intraday constituent/tape paths; anchored daily history bars are untouched.
- timestamp: 2026-10-25
  checked: tests/regression/mocks/marketSimulator.ts L238
  found: Mock minute bars are built from 09:30 ET onward only — fixtures can never reproduce the leak; explains 618 green tests despite the defect.
  implication: Regression test must use sessionless real-backend row shapes explicitly.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: >
  AND-gate of two conditions: (1) data/code — TickLakeReader.query_candles
  selected no session column (unlike query_ticks), and streamingClient.getCandles
  relabeled every sessionless candle row session='REG', erasing extended-hours
  identity on the 1-minute replay tape; (2) code — the live 1D aggregation
  (buildDailyIndex/aggregateDailyBucket and the CONV-VOL-01 reconstruction loop)
  filtered on labels alone with no RTH wall-clock window, unlike the paused
  snapshot memo, so PRE/POST minute bars entered daily OHLCV. A secondary
  isRthBar suffix trap treated any 12:00:00-UTC timestamp as an anchored daily
  bar. Fixtures could not see it because mock minute bars are REG-only.
fix: >
  Five targeted changes. (1) backend tick_lake_reader: candle SQL now selects
  array_to_string(array_sort(array_agg(DISTINCT upper(session_expr))), ', ') AS
  session and transform emits it (None when the lake lacks the column); daily
  REG filtering unchanged. (2) timezones: new isRthIntradayBar() wall-clock gate
  (equity 09:30-16:00 ET; UTC assets always RTH, matching isRthTick). (3)
  dailyIndex.buildDailyIndex applies the gate to every 1-minute tape bar. (4)
  useChartLifecycle CONV-VOL-01 loop applies the same gate for 1D. (5)
  streamingClient preserves truthful labels ('PRE, REG' composite kept) and
  maps missing labels to '' instead of fabricated REG; isRthBar anchor-suffix
  shortcuts now require timeframe === undefined (explicit intraday tf uses label
  / wall-clock classification). Anchored daily history bars never touch the new
  gate (data-flow audit: buildDailyIndex only indexes the 1-minute tape).
verification:
  target_test:
    result: pass
    detail: "tests/unit/dailyRthSessionGuard.test.ts 12/12 green; backend test_candle_session_labels.py 3/3 green (both RED before fix: 10 FE + 3 BE failures)"
  mutation_check:
    result: skipped
    reason_if_skipped: "Stryker not installed/configured in this repository (no @stryker-mutator dependency); guardrail graceful-degradation row applies. Mutation-equivalent protection: driving tests assert exact RTH-oracle OHLCV values through both sessionless and mislabeled-REG row shapes, and revert-and-reconfirm proves causation."
    mutant_killed: n/a
  no_op_deletion:
    result: pass
    deletion_justified_by_rca: true
    detail: "git diff 5 files, +69/-12; net-additive (new SQL expression, new exported helper, two new gates). The two removed lines (REG default, unconditional suffix shortcut) are RCA-justified replacements, not behavior deletion; the suffix contract for no-timeframe callers is pinned by pre-existing dailyRthChart tests."
  adjacent_tests:
    result: pass
    suites_run:
      - "npx vitest run: 630 passed / 2 skipped (baseline 618/2 + 12 new), 104 files, zero regressions"
      - "pytest backend/streaming_service/tests: 235 passed / 2 skipped (baseline 232/2 + 3 new)"
      - "npx tsc --noEmit: exit 0"
      - "npm run build (vite production): success"
      - "Playwright journeys not executable in sandbox (Chromium download blocked by network policy); mock layer already emits session and only builds REG minute bars"
  revert_and_reconfirm:
    result: pass
    bug_returned_on_revert: true
    fixed_on_reapply: true
    detail: "git stash of the five product files restored exact RED state (FE 10 failed, BE 3 failed); stash pop restored 12/12 + 3/3 green."
  oracle_type: "derived (LAKE-RESAMPLE-04 contract RTH session='REG' + independent wall-clock session windows) plus specified exact-value assertions; boundary neighbors included (09:29/09:30 ET, 15:59/16:00 ET, mid-RTH and post-close cutoffs)"
  guardrail_verdict: accepted
  rejected_signal: none
files_changed:
  - backend/streaming_service/tick_lake_reader.py
  - src/lib/timezones.ts
  - src/lib/dailyIndex.ts
  - src/hooks/useChartLifecycle.ts
  - src/lib/streamingClient.ts
  - tests/unit/dailyRthSessionGuard.test.ts (new)
  - backend/streaming_service/tests/test_candle_session_labels.py (new)
