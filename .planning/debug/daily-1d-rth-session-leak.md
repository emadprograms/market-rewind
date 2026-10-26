---
status: awaiting_human_verify
trigger: "1D daily chart construction is wrong: live/forming daily candle leaks premarket/postmarket OHLCV because candle rows carry no session and the client defaults them to REG"
created: 2026-10-25T16:05:00+03:00
updated: 2026-10-26T12:45:00+03:00
---

> Human verification REJECTED the first fix cycle (2026-10-26). Local testing on
> the real data-harvester lake shows the 1D chart is still built from the full
> 16-hour extended session. Cycle 1 fixed the live forming-candle path only;
> historical daily bars come straight from the backend 1d endpoint, whose
> session='REG' filter trusts labels that the harvester fabricates. Session
> reopened; see Evidence entries 8-10 and the new reasoning_checkpoint below.

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

status: investigating (cycle 2 — human verification of cycle 1 rejected against real lake data)

reasoning_checkpoint_cycle2:
  hypothesis: "Historical 1D bars bypass every frontend gate: useChartData loads timeframe-shaped daily bars directly from the backend 1d endpoint, whose only RTH enforcement is WHERE upper(session)='REG'. The data-harvester writes tick.get('session','REG'), so ALL real-lake ticks (04:00-20:00 ET) are labeled REG and the endpoint aggregates the full 16-hour day."
  confirming_evidence:
    - "User's real-lake inspection (TSLA 2026-10-22): all 70,920 ticks stored session='REG', zero PRE/POST; 1d candle O366.93/H388.65/L364.95/C373.20/V70920 vs RTH truth O374.05/H388.65/L373.53/C374.51/V56002."
    - "Open 366.93 is the 04:00 ET (08:00 UTC) premarket print; close 373.20 is the 19:59 ET (23:59 UTC) postmarket print; extended-hours volume delta = 14,918."
    - "tick_lake_reader L746-785: daily path adds session_filter REG but has no timestamp/wall-clock window; no backend symbol-timezone metadata exists."
    - "Cycle-1 backend tests passed only because tick_lake_factory writes truthful PRE/REG/POST tags — synthetic fixtures cannot reproduce label fabrication (evidence of test-harness blind spot)."
  falsification_test: "If labels are not the cause, a backend wall-clock RTH predicate (09:30 <= ET time < 16:00) applied to an all-REG 04:00-20:00 ET lake would NOT reduce the daily candle to O374.05/V56002-class RTH values; and a UTC symbol (EUR/USD, BTC) under the same predicate would lose ticks if the symbol classifier is wrong."
  fix_rationale: "Enforce RTH by wall-clock at the daily aggregation chokepoint for America/New_York session symbols, so correctness no longer depends on harvester label quality; UTC/24h symbols skip the gate (mirrors frontend getTzForTicker). Also flag the harvester default (separate repo, not in this sandbox) as the upstream data-quality fix."
  blind_spots: "Backend has no symbol metadata service — classifier must mirror the frontend heuristic (USD/'/'/crypto set/^/= prefixes); half-day holidays need no special handling (ticks simply stop early); explicit session='ALL' must remain a true opt-out; DST correctness relies on DuckDB's bundled tz database (verified 2026-10 EDT and 2026-11 EST conversions)."
  candidate_causes:
    - "data: data-harvester runner.py fabricates session='REG' for unlabeled Capital.com ticks (upstream, separate repository)"
    - "code: backend 1d query enforces RTH via a trusted label only, with no wall-clock backstop"
  and_gate: "yes — the wrong candle requires fabricated labels AND a label-only filter. Fixing either alone would make THIS lake correct; the wall-clock gate is the durable fix because it also repairs already-ingested partitions, while the harvester fix only protects future ingestion."

hypothesis: see reasoning_checkpoint_cycle2
test: TDD red — backend test on an all-REG 04:00-20:00 ET lake asserting 1d equals the RTH oracle, plus UTC-symbol no-gate and winter-DST cases; then implement the wall-clock predicate in query_candles.
expecting: RED first (current code returns full-day values), GREEN after the predicate; full backend suite stays at 235 passing.
next_action: Awaiting human re-verification of PR #8 on the real local lake (TSLA 2026-10-22 and neighbors). Upstream data-harvester runner.py session-label fix remains a separate-repo follow-up to communicate.

## Cycle 2 update (2026-10-26, after human rejection of cycle 1)

Cycle-1 resolution below remains valid for the LIVE forming-candle path but
was incomplete: historical 1D bars are served directly by the backend 1d
endpoint, whose label-only filter cannot resist fabricated REG labels.

fix_cycle2: >
  tick_lake_reader.query_candles daily branch now applies a wall-clock RTH
  predicate for America/New_York session symbols when the effective session
  filter is REG: CAST(timestamp AT TIME ZONE 'UTC' AT TIME ZONE
  'America/New_York' AS TIME) in [09:30, 16:00). New _is_utc_session_symbol()
  mirrors frontend getTzForTicker (USD substring, '/', crypto set, ^/=/ prefix)
  so forex/crypto keep 24/7 daily aggregation; explicit session='ALL' remains
  a full-day opt-out. DST is handled by DuckDB's tz database.
verification_cycle2:
  target_test: { result: pass, detail: "test_daily_rth_wallclock.py 6/6 green; RED before fix (3 equity cases failed, UTC/ALL/crypto pins already passed)" }
  faithful_repro: "All-REG lake with the user's exact TSLA prints returns O374.05/H388.65/L373.53/C374.51/V2500 (RTH truth); session=ALL still returns full-day O366.93/C373.20/V3100"
  mutation_check: { result: skipped, reason_if_skipped: "Stryker not configured; Python mutation tooling absent — revert-and-reconfirm plus metamorphic truthful-vs-mislabeled equivalence test substitute" }
  no_op_deletion: { result: pass, detail: "Purely additive: two module helpers + one conditional WHERE clause; no existing behavior removed (ALL opt-out and UTC instruments explicitly pinned)" }
  adjacent_tests: { result: pass, suites_run: ["pytest 241 passed / 2 skipped (235 + 6 new)", "vitest 630 passed / 2 skipped (unchanged, backend-only cycle)", "tsc --noEmit clean", "vite build success"] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, detail: "git stash of tick_lake_reader restored the 3 equity-test failures; pop restored all 9 backend candle tests green" }
  guardrail_verdict: accepted
files_changed_cycle2:
  - backend/streaming_service/tick_lake_reader.py
  - backend/streaming_service/tests/test_daily_rth_wallclock.py (new)

upstream_followup: >
  data-harvester (separate repository, not present in this sandbox): runner.py
  persists tick.get("session", "REG"), fabricating REG for every unlabeled
  Capital.com tick. Recommended change — derive the session from the tick's
  America/New_York wall time (PRE 04:00-09:30, REG 09:30-16:00, POST 16:00-20:00,
  matching getSessionType minute boundaries 240/570/960/1200) and only honor an
  explicit native tag when present. The backend wall-clock gate makes this
  non-blocking (it also corrects already-ingested partitions), but fixing the
  harvester restores truthful labels for every consumer.

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
- hypothesis: (cycle-1 elimination, REOPENED) "Backend 1d endpoint is RTH-correct because it filters session='REG'."
  evidence: 2026-10-26 real-lake verification refutes it: the harvester fabricates session='REG' for every tick, so the label filter passes all 70,920 ticks across 04:00-20:00 ET. The original elimination was an artifact of synthetic fixtures with truthful tags — fixture bias, not product proof. Replaced by the wall-clock hypothesis in reasoning_checkpoint_cycle2.
  timestamp: 2026-10-26

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
- timestamp: 2026-10-26
  checked: Human local verification on the real data-harvester lake (TSLA, date=2026-10-22)
  found: 1D chart shows O366.93/H388.65/L364.95/C373.20/V70920; true RTH is O374.05/H388.65/L373.53/C374.51/V56002. Open = 04:00 ET premarket print, low = 04:35 ET print, close = 19:59 ET postmarket print, +14,918 extended-hours volume.
  implication: Cycle-1 fixes are necessary but insufficient — the visible 1D history is still wrong end-to-end.
- timestamp: 2026-10-26
  checked: data-harvester runner.py ingestion path (user inspection; repository not present in this sandbox)
  found: Capital.com ticks carry no native session tag and are persisted with tick.get("session", "REG"); direct parquet inspection shows all 70,920 TSLA ticks for 2026-10-22 (04:00-20:00 ET) stored session='REG', zero PRE/POST.
  implication: Upstream data defect — the session column exists but its values are fabricated. Reopens the cycle-1 Eliminated hypothesis "backend 1d endpoint is REG-clean": that conclusion came from synthetic mini-lakes with truthful tags and does not generalize.
- timestamp: 2026-10-26
  checked: tick_lake_reader.py query_candles daily branch (L737-785) plus data flow from useChartData.load (timeframe-shaped 1D fetch)
  found: Historical daily bars are served directly by the backend 1d endpoint; the only RTH enforcement is WHERE upper(session)='REG' — there is no timestamp/wall-clock window. Frontend historical 1D rendering cannot re-gate an already-aggregated bar; cycle-1 gates only protect the live 1-minute-tape path.
  implication: The durable in-repo fix is a backend wall-clock RTH predicate for NY-session symbols on daily aggregation; DuckDB 2.0 AT TIME ZONE 'America/New_York' verified for EDT (13:30Z->09:30) and EST (14:30Z->09:30), 16:00 ET exclusive, 09:29:59 excluded.
- timestamp: 2026-10-26
  checked: backend symbol metadata availability
  found: No symbol/timezone inventory exists in the streaming service; the mini lake mixes equities (AAPL, NVDA, JPM, BRK.B) with UTC instrument EUR/USD. Frontend getTzForTicker (src/lib/timezones.ts) is the only classifier: UTC when symbol contains USD or '/', is in the crypto set, or starts with ^/=/; otherwise America/New_York.
  implication: Backend needs a mirrored, independently tested classifier so EUR/USD/crypto daily buckets remain 24/7 while equities get the 09:30-16:00 ET gate.

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
