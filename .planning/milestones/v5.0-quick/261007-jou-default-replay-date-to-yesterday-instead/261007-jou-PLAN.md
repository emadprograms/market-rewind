---
quick_id: 261007-jou
slug: default-replay-date-to-yesterday-instead
description: "Default replay date to yesterday's date dynamically instead of hardcoded 2026-09-25"
---

# Quick Task 261007-jou: Default Replay Date to Yesterday's Date

## Problem Statement
In `src/hooks/useSession.ts`, the default date was hardcoded to `const DEFAULT_DATE = '2026-09-25'`. Additionally, `useState` for `selectedDate` checked:
```ts
if (!saved || saved > DEFAULT_DATE) return DEFAULT_DATE;
```
Because `DEFAULT_DATE` was hardcoded to `2026-09-25`, any user opening the app without a saved date or with any date after September 25, 2026 (such as October 2026) was forcefully reset to `2026-09-25`. Furthermore, `localStorage` cached this static date, locking the date picker to September 25, 2026 across sessions.

Market Rewind is a replay simulator whose primary workflow is replaying recent market activity. The default date should always be yesterday's date (calculated dynamically relative to the US market trading timezone `America/New_York`), rather than an arbitrary historical date.

## Target Behavior
1. Implement a timezone-aware helper `getYesterdayDate(timeZone = 'America/New_York'): string` in `src/lib/timezones.ts` returning `YYYY-MM-DD`.
2. In `src/hooks/useSession.ts`:
   - Replace the hardcoded `DEFAULT_DATE = '2026-09-25'` with dynamic `getYesterdayDate()`.
   - Initialize `selectedDate` to `getYesterdayDate()` by default.
   - Clean up stale localStorage legacy default `2026-09-25` if encountered so users are never stuck on September 25.
3. Update tests in `tests/unit/redResetButton.test.tsx` to use dynamic `getYesterdayDate()` instead of hardcoded `2026-09-25`.
4. Add unit test coverage verifying `getYesterdayDate()` behavior across edge cases.
5. Verify all test suites pass and production build succeeds.

## Tasks
- **Task 1**: Add `getYesterdayDate` in `src/lib/timezones.ts`.
- **Task 2**: Update `src/hooks/useSession.ts` to use `getYesterdayDate()`.
- **Task 3**: Update `tests/unit/redResetButton.test.tsx` and add unit test in `tests/unit/dailyTimestampTz.test.ts`.
- **Task 4**: Run full test suite (`npm test`) and production build (`npm run build`).
- **Task 5**: Document in `261007-jou-SUMMARY.md` and update `.planning/STATE.md`.
