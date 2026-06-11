---
status: testing
phase: 05-data-pipeline-resampling-hardening
source: [05-01-SUMMARY.md]
started: 2026-06-11T10:00:00.000Z
updated: 2026-06-11T10:00:00.000Z
---

## Current Test
number: 1
name: Session Boundary Splits
expected: |
  Switch between PRE, REG, and POST sessions. Verify that candles are split at these boundaries even if the timeframe would normally merge them (e.g., a 15m candle starting at 9:25 AM should split at 9:30 AM for Market Open).
awaiting: user response

## Tests

### 1. Session Boundary Splits
expected: Switch between PRE, REG, and POST sessions. Verify that candles are split at these boundaries even if the timeframe would normally merge them (e.g., a 15m candle starting at 9:25 AM should split at 9:30 AM for Market Open).
result: [pending]

### 2. Closed Candle Stability
expected: Run playback. Observe already formed (closed) candles. Verify that their OHLC values do not change or 'flicker' as the next candle develops.
result: [pending]

### 3. Cache Purge on Config Change
expected: During playback, change the timeframe (e.g., 5m to 15m). Verify the chart clears immediately and rebuilds with the new timeframe without showing stale data from the previous one.
result: [pending]

### 4. Playback Step Alignment
expected: Use the Step Forward button. Verify the playback time always lands on an exact multiple of the selected timeframe (e.g., 10:00, 10:05, 10:10 for 5m bars).
result: [pending]

### 5. Performance (Perceived Jitter)
expected: Run playback at high speed. Verify there is no visible stutter or lag in the chart rendering as new bars are added, confirming efficient tail resampling.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0

## Gaps

[none yet]
