# Final live-browser verification — 96ca478

Date: September 30, 2026  
Revision: `96ca478`  
Application: `http://localhost:3000/`  
Backend: configured Streaming DuckDB service, `http://100.72.128.22:8420`  
Method: interactive browser testing against real service data, screenshots, DOM observations, console inspection, and supporting source review. No API mocks or synthetic market fixtures were used in this browser session.

## Verdict: not ready for live-app sign-off

The previously reviewed synthetic daily-candle fixes pass their focused tests. However, live verification reproduces material problems in real-data playback and chart transitions:

1. Daily volume changes substantially when playback is paused, without a corresponding change in executed ticks.
2. Switching from TSLA to AAPL can leave TSLA historical candles on a chart labeled AAPL, while its tape and newest candle use AAPL prices.
3. Timeframe changes and rewind/seek transitions produce rejected chart updates because candle timestamps are out of order.
4. The daily “Live” price switches to a different price when paused.

The earlier code-review approval was explicitly limited to the tested fixes. These live results supersede it for overall application readiness. No application code was changed during this verification. Only this report and its evidence files were added.

## What was exercised

| Workflow | Observed result |
| --- | --- |
| Connect to the configured service | Connected successfully; service advertised 40 symbols |
| TSLA, September 22, default 09:20 start | Loaded 12,199 buffered TSLA ticks and multiple historical candles |
| Premarket play/pause | Clock and price advanced; the earlier explosive per-frame volume increase was not reproduced in the short observed interval |
| Open/close Time & Sales | Drawer opened without the earlier React hook crash; correctly empty before the first recorded trade, populated after seeking forward |
| Exact seek to 09:34 | Reached 09:34:00 and paused; tape populated with eligible trades |
| Resume and cross a minute boundary | Charts and tape updated, but subsequent pause changed daily volume materially |
| TSLA, September 15, default 09:20 start | Loaded 14,566 TSLA ticks and multiple premarket candles; the original single-premarket-candle issue was not reproduced |
| Reload September 15, then reinitialize | Session loaded again with multiple candles; no reload-only repair was required in this run |
| Seek to 09:29:59 and play across the open | Reached 09:30:05 with 98 ticks consumed and a daily candle present |
| Switch left chart TSLA → AAPL after the open | Tape changed to AAPL, but old TSLA history remained visibly rendered |
| Change left chart 5m → 1m → 5m | Different price ranges appeared, followed by ordering errors and an incorrect/stale chart view; this is not a reliable workaround |
| Scrubber keyboard Home and ArrowRight | Returned to 09:20:00, then advanced to 09:20:01 |
| Exact seek after rewind | Reached 09:34:00; slider minimum remained `1789478400000` (September 15, 09:20 ET) |

Mouse-based scrub precision was not conclusively verified. A pointer attempt did not change the cursor, so it is not counted as a pass or an application defect. Some semantic mouse actions and screenshot scaling were inconsistent in the browser automation surface; keyboard activation and screenshot-grounded coordinates were used where necessary. Those tool limitations are not classified as application bugs.

## Finding 1 — [P1] Daily volume is not stable across play/pause with real data

### Reproduction and evidence

1. Initialize TSLA for September 22 at 09:20.
2. Seek to 09:34:00.
3. Resume, advance into 09:35, and return playback speed to 1x.
4. Capture the playing chart, then pause and capture again.

| Observation | Playing screenshot | Paused screenshot |
| --- | --- | --- |
| Replay clock | 09:35:56.463 | 09:35:56.629 |
| Tick counter | 523 / 12,199 | 523 / 12,199 |
| Latest trade | 373.60 | 373.60 |
| Daily volume label | About 1.20M | About 1.41M |
| Current 5m volume label | 4.01K | 4.01K |

The approximately 210,000-share daily-volume change cannot be attributed to newly consumed ticks in this comparison: the tick counter and latest trade are unchanged. The labels are rounded UI values, not exact raw volume measurements.

Evidence: `live-96ca478/06-before-pause.png` and `live-96ca478/07-after-pause.png`.

### Diagnosis and fix direction

Source review suggests differing data-source policies: `useChartData.ts:451–494` reconstructs the paused daily candle from completed minute aggregates plus current-minute ticks, while live raw-tick processing in `useChartLifecycle.ts` adds elapsed trades to the existing candle. When the minute aggregates and captured tick stream do not represent identical coverage, the two paths diverge. This is a source-supported diagnosis; the backend datasets' exact coverage difference was not independently measured in this session.

Define a single source/coverage policy for daily aggregation and apply it to both snapshot and live playback. The synthetic-only fix does not address real ticks combined with aggregate history.

### Required regression

Use a fixture in which completed minute aggregate volume differs from the sum of available raw trades. Seek before a minute boundary, play across it, and pause without consuming another trade. Assert exact daily OHLCV equality across live and paused paths. Repeat with a real chart instance and a captured representative backend fixture; do not rely only on perfectly consistent synthetic fixtures.

## Finding 2 — [P1] AAPL chart retains TSLA historical candles after symbol switch

### Reproduction and evidence

1. Initialize TSLA for September 15 at 09:20, using the default 5m/1D layout.
2. Seek to 09:29:59, play across the open, then pause around 09:30:05.
3. Change the left chart from TSLA to AAPL.
4. Open Time & Sales and resume, then pause.

The left chart header and tape identify AAPL. Tape prices and the newest candle are around 328–330, but the historical candles remain around 357–359 and visually match the preceding TSLA chart. This persists after the history request completes and after pausing at 09:30:17.

The browser log confirms AAPL history loaded: 1,500 bars from `2026-09-03 10:55:00` through `2026-09-15 23:55:00`. At inspection, the DOM reports AAPL, first-bar open 324.38, last-bar open 330.445, and last-bar close 329.84. The canvas still shows the old high-price history. This is a concrete example of why DOM snapshot attributes alone are insufficient to verify the rendered chart.

Evidence: `live-96ca478/11-aapl-switch.png` and `live-96ca478/12-aapl-paused.png`.

### Diagnosis and fix direction

Investigate the context transition together with the incremental-update shortcut at `useChartLifecycle.ts:374–388`. Its `isPrefixUnchanged` test compares the matching bar index with a count; it does not establish that preceding OHLCV belongs to the same dataset. A late replacement with the same structure can leave old candles rendered. The exact asynchronous sequence was not instrumented, so this remains the leading source-supported explanation rather than a proven complete root cause.

Treat symbol/date/timeframe/dataset-generation changes as explicit render-context changes. Do not render old-symbol history as a new symbol while its request is pending. Replace the full series when the historical prefix changes, even when its bar count and ending timestamp match.

### Required regression

Use equal-length TSLA and AAPL fixtures with matching timestamps and deliberately different prices. Delay AAPL history, deliver AAPL ticks first, then finish history loading. Connect real data and lifecycle hooks to a stateful chart adapter, and separately test with the real chart library. Assert every rendered candle belongs to AAPL, not merely the header, last candle, or number of bars.

## Finding 3 — [P1] Timeframe/rewind sequence supplies unsorted data to the chart

### Reproduction and evidence

Continuing the AAPL session above, change 5m → 1m → 5m, rewind with the scrubber's Home key, advance one step, and seek to 09:34. The browser console records repeated price and volume failures:

```text
Assertion failed: data must be asc ordered by time,
index=5000, time=1788432900, prev time=1789387500

Cannot update oldest data, last time=[object Object], new time=[object Object]
```

The first ordering warnings were captured at `2026-09-30T14:27:37.343Z`, with repeated failures around `14:27:55Z`. The errors are caught and logged as warnings, so the page can stay alive while the chart remains incorrect. The resulting left chart view is visibly incomplete/stale.

Evidence: `live-96ca478/browser-console.json`, `live-96ca478/13-aapl-1m.png`, and `live-96ca478/14-aapl-after-timeframe-reset.png`.

### Diagnosis and fix direction

Investigate history pagination at `useChartData.ts:310–329`: the awaited chunk is filtered against an earlier boundary and then concatenated with the latest `localMasterDataRef.current`, without a request-generation check. A symbol/timeframe/date change while that request is in flight can invalidate both the context and merge boundary. The failure at index 5,000 is consistent with the 5,000-bar pagination chunk, but the exact race was not directly traced.

Bind every history response to its symbol, timeframe, date/session, and generation. Discard obsolete responses. Merge valid responses by timestamp with a defined duplicate policy, and validate strict ordering before rendering. Preserve the last valid chart state on a rejected update and expose a meaningful loading/error state rather than silently continuing with a stale chart.

### Required regression

Hold a 5,000-bar pagination response pending, switch timeframe or symbol, complete the new initial load, then resolve the old response. Assert it cannot contaminate the new dataset. Check strict timestamp ordering and uniqueness. Use the real lightweight-charts adapter, or a fake that enforces its ordering rules; a `vi.fn()` accepting arbitrary arrays will not catch this failure.

## Finding 4 — [P2] Pausing changes the daily “Live” price to a different value

In the same September 22 before/after pair, the yellow daily line changes from 373.60 while playing to 379.15 when paused, although the tape still ends at 373.60. September 15 also shows the paused daily line at 355.85 while the current tape/transport price differs.

The paused subscriber at `useChartLifecycle.ts:895–899` reads a historical bar's close, while the active subscriber uses the latest tick. The line therefore has different semantics across play/pause. Because daily history may include completed-day information, using its close as an intraday “Live” value also needs a temporal-isolation check.

Use the latest eligible price for the chart's own symbol at the cursor in both states. Test the line value separately from candle OHLCV, including premarket, RTH, and symbol changes. A stale or unavailable value should not be presented as current.

## Additional observations, not established root causes

- Initial September 22 data attributes extended to the correct replay cursor, but the visible 5m viewport was on September 15. Reset View moved it to September 22. This was observed after changing the saved session date; it is not evidence that every clean load starts incorrectly.
- The global tick count rose from 26,241 after adding AAPL to 40,807 later in the timeframe/rewind sequence. Repeated-looking tape rows were visible. Overlapping loads or duplicate ingestion warrant investigation, especially because `addSymbolTicks` concatenates arrays, but event identities and backend responses were not compared. This is not presented as a separately proven duplicate-ingestion bug.
- The original single-premarket-candle symptom and explosive per-frame volume growth were not reproduced in the tested windows. Their absence in this session is not proof that every loading order is safe.

## Why the previous tests passed

The preceding review accounted for all 404 repository tests passing, including a network-enabled rerun of the affected historical-data file, and a passing production build. Those checks were not rerun during this browser session because application code did not change.

The passing tests established the reviewed synthetic fallback behavior. They did not establish equal coverage between backend aggregates and real ticks, full-prefix replacement after a delayed symbol response, or real-library ordering correctness after asynchronous pagination. Browser evidence now demonstrates failures in those paths.

## Prioritized plan and acceptance gate

1. Preserve representative API fixtures and these failing browser sequences before implementing more fixes.
2. Unify daily aggregation and live-price rules across play, pause, seek, and minute rollover.
3. Make symbol/date/timeframe changes invalidate old rendering context and pending history responses.
4. Enforce ordering and uniqueness at the history merge boundary, and test renderer failures explicitly.
5. Investigate repeated tick loads using stable event identities and request-generation logging.
6. Rerun the live sequence for both September 15 and 22, including repeated symbol changes, timeframe changes, rewind, and reload.

Sign-off requires stable OHLCV and live price at an unchanged cursor, correct symbol history throughout transitions, no ordering errors, and agreement between visible chart state and tape/data context. Existing focused tests should remain green, but passing them alone is not the acceptance gate.

## Evidence and limits

All screenshots, final DOM text, and console warnings are in `docs/reviews/live-96ca478/`. The before/after screenshots use rounded chart labels; no hidden application state was modified to drive the browser. UI actions included session setup, play/pause, exact-time input, keyboard scrubbing, symbol selection, timeframe buttons, and reload.

No real orders were placed. No source fixes, commits, or deployments were made. This is a bounded verification of the named workflows, not an exhaustive test of all symbols, dates, network-failure modes, or trading features.
