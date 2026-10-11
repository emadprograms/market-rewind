---
status: complete
date: 2026-10-07
task: 261007-jou
title: Default replay date to yesterday's date
---

# Quick Task Summary: Default Replay Date to Yesterday's Date

## Overview
Replaced the hardcoded default date (`DEFAULT_DATE = '2026-09-25'`) with a dynamic, timezone-aware helper `getYesterdayDate()` so that the replay simulator defaults to yesterday's trading day relative to `America/New_York` instead of remaining locked to September 25, 2026.

## Changes Made
1. **`src/lib/timezones.ts`**:
   - Implemented and exported `getYesterdayDate(timeZone = 'America/New_York', referenceDate?: Date): string`.
   - Uses `Intl.DateTimeFormat` and UTC date arithmetic to ensure accurate calendar subtraction across month boundaries, year rolls, leap days, and daylight saving transitions.
2. **`src/hooks/useSession.ts`**:
   - Replaced static `const DEFAULT_DATE = '2026-09-25'` with dynamic `getYesterdayDate()`.
   - Updated `selectedDate` initial state to call `getYesterdayDate()`.
   - Added auto-purge logic to clear the legacy `'2026-09-25'` date from `localStorage` if present.
   - Removed `localStorage` persistence of `selectedDate` so each new session defaults to yesterday's date without getting stuck on past historical dates.
3. **`tests/unit/dailyTimestampTz.test.ts`**:
   - Added unit test suite for `getYesterdayDate` verifying standard dates, month boundaries (Oct 1 -> Sep 30), year boundaries (Jan 1 -> Dec 31), leap day handling (Mar 1 -> Feb 29), and timezone defaults.
4. **`tests/unit/redResetButton.test.tsx`**:
   - Updated tests to dynamically use `getYesterdayDate()` instead of hardcoded `'2026-09-25'`.

## Verification
- Production build succeeded (`npm run build` in 910ms).
- Full Vitest suite passed cleanly (`npm test`: 84 test files passed, 449 tests passed, 2 skipped, 0 failed).
