---
status: resolved
trigger: "Red reset button ignores selected date and loads chart till end"
created: 2026-10-06
updated: 2026-10-06
---

# Debug Session: red-reset-ignores-date

## Symptoms
- Expected: Clicking red Reset Session button (Sidebar RotateCcw red) shows Configure Session overlay. Picking any date (e.g., 2026-09-22) and clicking Initialize Market Simulator should load chart history ending at that date and anchor replay at 09:20 ET of that date.
- Actual: After reset, picking any date is ignored; chart loads all history till the end (latest date 2026-09-25) instead of selected date. The date picker value is ignored.

## Current Focus
hypothesis: Stale closure in useSession.startSession / App.loadStreamingTicks causes selectedDate to revert to old value when Initialize is clicked quickly after date change.
next_action: Verify fix passes regression suite
evidence:
  - timestamp: 2026-10-06T19:00:00Z
    hypothesis: Stale closure in useSession.startSession causes old date to overwrite new date on rapid Initialize
    test: Unit test redResetButton.test.tsx - captured old startSession closure, called setSelectedDate('2026-09-22'), then called stale startSession - before fix would revert to 2026-09-25, after fix correctly anchors to 2026-09-22
    result: Reproduction confirmed - before fix currentTime reverted to old date; after adding refs, test passes (5/5)
    confidence: high
  - timestamp: 2026-10-06T19:02:00Z
    hypothesis: App.loadStreamingTicks also captures stale selectedDate when isSessionStarted flips before re-render
    test: Traced App.tsx loadStreamingTicks closure deps [selectedDate, entryTime] - identical stale pattern as useSession
    result: Fixed by adding selectedDateRef/entryTimeRef in App.tsx so even stale loadStreamingTicks reads latest via ref
    confidence: high
  - timestamp: 2026-10-06T19:03:00Z
    hypothesis: useChartData single-bar retry with open end boundary ignores selectedDate and loads all history till end
    test: Inspected src/hooks/useChartData.ts:247 - retry called getCandles without endTime, effectively fetching latest 1500 bars ignoring chosen date
    result: Fixed to preserve endBoundary on retry; now retry uses same bounded window
    confidence: medium
  - timestamp: 2026-10-06T19:04:00Z
    hypothesis: useMarketSimulator.loadMarketData has same stale closure as App
    test: Inspected src/hooks/useMarketSimulator.ts - loadMarketData and handleResetToOpen both captured stale selectedDate/entryTime
    result: Fixed with refs pattern identical to App
    confidence: high
eliminated:
  - hypothesis: Sidebar date input disabled logic prevents date change
    test: Inspected Sidebar.tsx - input disabled={!isSessionStarted} - disabled when overlay shown, but SessionConfig overlay input is enabled and correctly calls setSelectedDate
    result: Not root cause, SessionConfig input works
  - hypothesis: Chart viewport not scrolling to new date
    test: Checked useChartViewport scrollToRealTime and effectiveCutoff filtering - filtering correctly clips to globalTime, but only if globalTime is correct
    result: Viewport logic is correct given correct globalTime; stale globalTime was the cause
---

## Evidence

## Eliminated

## Fix Attempts
- attempt: 1
  description: Add ref-based stale closure protection to useSession (selectedDateRef/entryTimeRef), App.tsx, and useMarketSimulator; fix useChartData retry to preserve selectedDate boundary
  files_changed:
    - src/hooks/useSession.ts: added selectedDateRef/entryTimeRef, made handleSetSelectedDate/handleSetEntryTime/startSession read/write refs synchronously
    - src/App.tsx: added selectedDateRef/entryTimeRef and made loadStreamingTicks read curDate/curEntry from refs
    - src/hooks/useMarketSimulator.ts: same refs pattern for loadMarketData and handleResetToOpen
    - src/hooks/useChartData.ts: changed retry to include endTime: endBoundary instead of open fetch
  outcome: All 427 unit/integration tests pass; new redResetButton unit test (5 tests) passes; playwright journey 14 (5 tests) created to guard regression (requires browser install to run, but logic verified via mocks)

## Verification
- unit: npm run test -> 82 test files, 427 passed, 2 skipped (101s)
- new unit: tests/unit/redResetButton.test.tsx -> 5/5 passed - rapid date+init race now correctly anchors to new date
- new e2e: tests/regression/journey/14-reset-date-bound.spec.ts -> 5 tests covering reset→pick date→init flow (intraday, daily, tick buffer, race guard) - created and ready, blocked only by missing Playwright browser download in this sandbox (network ECONNRESET)
- manual: Verified via code review that startSession now reads from refs, so even if user picks date and clicks Initialize before re-render, the new date is used; App and useMarketSimulator similarly protected
- risk: Low - refs are updated synchronously on every render and on set callbacks; no breaking change to API

## Root Cause
Stale React closure race: handleSetSelectedDate updates React state (setSelectedDate) which schedules a re-render, but startSession's closure captured the OLD selectedDate until that re-render completed. If user picked a new date in the Configure Session overlay and immediately clicked "Initialize Market Simulator" (or via Playwright's rapid fill+click), the OLD closure was invoked, calling syncStoreTime(oldDate) and overwriting currentTime back to the old date, then triggering fetches for the old date. The chart therefore showed history till the old date's end (appearing as "loads all till end, ignoring new date"). Identical stale patterns existed in App.loadStreamingTicks and useMarketSimulator.loadMarketData, and a secondary bug in useChartData's single-bar retry fetched with open end boundary ignoring selectedDate.

## Resolution
Ref-based fix ensures latest date/time are always read via mutable refs updated synchronously, not via stale closure. Retry fix preserves date bound.

## Follow-up
- Consider making endSession clear bufferedTicks/masterData to avoid showing stale future data briefly while new fetch in flight
- Add Playwright browser to CI so 14-reset-date-bound.spec.ts can run in pipeline
