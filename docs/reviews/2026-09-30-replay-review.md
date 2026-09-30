# Replay review and regression test plan

Date: 2026-09-30  
Reviewed revision: `90e2fe9`  
Scope: diagnosis and proposed fixes/tests only. No application fixes or new repository tests were implemented during this review.

## Verdict and evidence

The changes resolve all seven previously failing diagnostic checks, but three additional hook-level checks reproduce remaining correctness problems. The replay should not yet be considered fixed.

Validation performed:

- All seven previous diagnostic checks passed.
- The repository suite initially returned 364 passes and two failures caused by sandbox-blocked network access. Rerunning the affected five-test file with network access passed all five. Together, these runs account for all 366 existing tests passing; this was not a single unrestricted full-suite run.
- `npm run build` passed.
- Three new diagnostic checks failed, as described below.
- These failures were reproduced with real application hooks/stores and mocked chart/network boundaries. A fresh browser verification was not performed.

## 1. [P1] Seek → play discards accumulated fallback volume

Location: `src/hooks/useChartLifecycle.ts`, especially the snapshot reset near line 515 and synthetic-volume accumulation at lines 696–709.

**Reproduction:** Use a 5-minute TSLA chart with no raw ticks, a 09:20 minute containing 1,000 shares, and a 09:21 minute containing 200 shares. Seek to 09:21 and hydrate a candle containing the completed minute's 1,000 shares. Resume and advance to 09:21:01. The rendered volume becomes **200**, losing the previously accumulated 1,000 shares.

**Cause:** Hydrating a snapshot clears `syntheticBucketVolumesRef`. The next synthetic tick creates a map containing only the current minute. Summing that map then replaces the candle's existing volume.

**Fix direction:** Reconstruct constituent-minute volume state when restoring a snapshot, or derive the entire bucket from a shared aggregation function. Do not simply add the snapshot total on every tick: the snapshot may already contain part of the current minute, which would create double counting.

## 2. [P1] A switched symbol can expose unfinished 5-minute prices

Location: `src/hooks/useChartData.ts`, candidate selection near line 619 and forming-bar protection at lines 637–654.

**Reproduction:** Keep AAPL in global minute history and display TSLA on a 5-minute chart, with no elapsed TSLA ticks. Supply a TSLA 09:20–09:25 candle with open 101, high 150, low 80, close 105, and volume 2,000. At 09:21, the chart exposes all those final values even though the source candle has not closed.

**Cause:** When matching global minute history is unavailable, `candidateBars` falls back to local history at the chart's own timeframe. The protection nevertheless assumes every source bar lasts 60 seconds. The five-minute bar is therefore treated as complete at 09:21.

**Fix direction:** Carry the actual source duration into completion checks, or fetch/cache minute history per symbol. For an unfinished source candle without finer data, show only information explicitly allowed by the replay policy; never expose its final high, low, close, or volume.

## 3. [P1] Daily candles include unfinished-minute results

Location: `src/hooks/useChartData.ts`, lines 451–474.

**Reproduction:** Provide a TSLA 09:30 minute with open 101, high 150, low 80, close 120, and volume 10,000. At 09:30:01, the forming daily candle already contains high 150, low 80, close 120, and all 10,000 shares.

**Cause:** Daily aggregation admits a source bar as soon as its start time is at or before the cursor, then consumes its entire OHLCV. The intraday forming-bar protection does not apply to this path. Adding the latest tick volume afterward also requires an explicit overlap rule to avoid double counting.

**Fix direction:** Build the daily candle from completed RTH source bars plus eligible elapsed events in the current minute. Apply the same temporal rules used for intraday candles, and exclude premarket/after-hours events from daily OHLCV.

## How to write proper regression tests

### Define the expected behavior independently

Use small, explicit UTC fixtures and manually calculated expected candles. On September 22, 2026, 09:20 ET is `2026-09-22T13:20:00Z`; 09:30 ET is `13:30:00Z`. Do not copy production resampling code into the test oracle.

Document these rules before implementing the fixes:

- A historical source candle is complete only when its end time is at or before the cursor. Its duration comes from the source resolution, not the displayed timeframe.
- A trade is eligible only when its timestamp is at or before the cursor and its symbol/session matches the chart.
- Historical aggregates and raw trades covering the same interval must not both contribute volume.
- For unfinished intervals without raw trades, choose and document a fallback policy. A conservative policy uses an opening-price placeholder with zero unfinished-interval volume. If interpolation remains supported, specify its exact formula and test it separately; it must not silently reveal final OHLCV.
- Reaching the same cursor by continuous play, direct seek, or seek followed by play must produce the same candle under the same data and fallback policy.

### Layer 1: focused hook regressions

Extend the existing patterns in `tests/codex/review/review.test.ts` and `tests/codex/review/data.test.ts`. Keep the real playback store and hooks; mock only API responses and the chart adapter. Reset both playback and workspace stores, clean up mounted hooks, and restore timers between tests.

| Case | Arrange and act | Required assertions |
| --- | --- | --- |
| Volume restoration | Supply minute volumes 1,000 and 200; seek into the second minute; hydrate; play one frame | Completed 1,000-share contribution survives; assert the exact total required by the chosen current-minute policy |
| Repeated frames | Advance several frames within that same minute | No repeated addition of cumulative synthetic volume |
| Pause/resume | Pause and resume twice within the bucket | OHLCV matches continuous playback at the same cursor |
| Rewind and replay | Advance, rewind inside the bucket, replay to the original cursor | Exact original OHLCV returns; later minute contributions do not survive the rewind |
| Bucket rollover | Advance across 09:25 | Prior bucket closes correctly; new bucket starts without inherited volume |
| Other-symbol fallback | Global minute history is AAPL; local 5-minute history is TSLA; TSLA ticks are empty | At 09:21, TSLA's future high 150, low 80, close 105, and volume 2,000 are absent |
| Source boundaries | Inspect immediately before, at, and after 09:25 | Full completed TSLA candle becomes eligible at the documented boundary |
| Daily opening minute | Use the 09:30 fixture above; inspect 09:30:01 and 09:30:59.999 | Final minute extrema and volume are not exposed |
| Daily minute close | Inspect 09:31:00 | Completed minute contributes exactly once |
| Daily event overlap | Include completed-minute history and ticks spanning both completed/current minutes | Exact expected OHLCV; no double-counted trades |
| Daily session filtering | Include conspicuous PRE and POST trades alongside REG trades | PRE/POST prices and volume do not enter daily OHLCV |

For the existing failure, `volume >= 1000` is a useful diagnostic assertion, but insufficient for the permanent regression: it would also accept erroneous totals such as 2,000 or 100,000. Use exact expected totals once the fallback policy is defined. Likewise, check all OHLCV fields, timestamp, and symbol—not only the high.

Control animation-frame scheduling explicitly and flush React work with `act`. Wait for a known hydration condition instead of relying on a fixed 35 ms sleep. Do not mock the aggregation or cursor logic that the test is intended to exercise.

### Layer 2: combined data-to-renderer transitions

Add a harness that connects real `useChartData` output to real `useChartLifecycle`, using the real playback store and a stateful fake chart series. The current volume diagnostic seeds a snapshot directly; the combined test must prove that the actual data hook produces and restores the correct snapshot.

The fake chart should maintain its rendered bar collection across `setData` and `update`, replacing the last same-time bar and appending later bars. It should reject unsupported backwards updates. Assert its final price and volume collections, not merely that `update` was called.

Run the same fixture and target cursor through:

1. Continuous playback from session start.
2. Direct seek while paused.
3. Seek, resume, and pause at the target.
4. Rewind and replay to the target.
5. Switch away from the symbol and back at the target.

Compare full rendered OHLCV across these paths. Use deferred API promises to exercise minute-history-before-ticks, ticks-before-history, and delayed old-symbol responses. Ensure late data cannot reset the current chart to another symbol or change already-known volume incorrectly.

### Layer 3: deterministic browser journeys

Extend `tests/regression/journey/11-review-e2e-hardening.spec.ts` or add a dedicated replay-convergence spec. Reuse `tests/regression/mocks/apiMock.ts` and `replayJourney.ts`, with explicit fixture overrides for these cases. Keep this suite offline and deterministic.

- Start a September 22 session at 09:20 with 5-minute and daily charts. Seek to an exact time using the time input, play, pause, rewind, and repeat. Assert the requested cursor was actually reached.
- Switch to a symbol without elapsed ticks and with a deliberately extreme future high. Verify that it does not appear before its source interval closes.
- Cross the RTH opening minute and verify the daily chart uses only eligible data.
- Open Time & Sales, advance into known trades, assert a nonzero exact row count and expected fixture prices/volumes, then compare the chart's resulting candle. Switch symbols and verify known symbol-specific trades disappear/appear. Merely checking an empty drawer for absence of another ticker cannot establish isolation.

Browser assertions must observe rendered chart state. The existing `readBarData` helper exposes count, timestamps, open, and close; it does not expose high, low, or volume. Extend test observability to the actual series data, including imperative playback updates, before relying on it for these regressions. React snapshot attributes alone can miss a frozen canvas or stale imperative series.

Use a controlled browser clock/frame scheduler and wait for specific cursor and rendered-data conditions. Do not approximate 09:34 by clicking halfway along the scrubber, use fixed sleeps as proof of completion, or accept only “no page errors”/“canvas exists.” Keep screenshots/traces as supporting evidence rather than the sole numeric assertion.

### Demonstrate that tests detect the defects

Each focused test should fail on `90e2fe9` for its intended numerical mismatch and pass after the corresponding fix. Check that temporarily removing the fix makes it fail again in an isolated test checkout. A test that passes before and after the change has not demonstrated protection against that defect.

After implementation, run the focused tests, offline browser journeys, full repository suite, and production build:

```sh
npx vitest run tests/codex/review
npm run test:journey
npm test
npm run build
```

If new tests live elsewhere, include those paths in the focused command. Report live-backend test failures separately from deterministic failures, identifying unavailable network/data dependencies rather than silently treating them as passes.

## Recommended implementation order and acceptance gate

1. Add the three failing focused regressions and agree on unfinished-interval fallback behavior.
2. Restore constituent volume state consistently across hydration, seek, and resume.
3. Share source-duration-aware completion rules across switched-symbol and daily aggregation.
4. Add combined-hook convergence tests, followed by the browser journeys above.
5. Require exact OHLCV agreement across equivalent transition paths, all prior regressions passing, and no future-data exposure before marking the replay fixed.

The prior passing checks remain valuable and should be retained. These additional checks cover gaps in their scenarios, rather than invalidating the improvements already made.

## Local diagnostic evidence

The three failing probes are preserved outside the repository at:

`/Users/emadarshadalam/.codex/visualizations/2026/09/29/01a0edac-fa3c-71c1-9d5a-2b6912a8726e/market-rewind-rereview-probes/`

- `review.test.ts`: seek/resume volume loss.
- `data.test.ts`: switched-symbol and daily future-data exposure.
- `vitest.config.mjs`: standalone diagnostic configuration.

These local probes are evidence and starting points, not a portable completed regression suite. They use absolute local imports and should be adapted to repository-relative imports, deterministic scheduling, and the stronger assertions above when incorporated into the project.
