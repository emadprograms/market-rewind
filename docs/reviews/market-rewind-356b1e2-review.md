# Review of 356b1e2

Reviewed September 30, 2026. Review only; no repository files changed.

## Verdict

The two previously failing daily-chart checks now pass. Premarket filtering and the paused daily snapshot are improved. One combined-hook regression still fails: live playback and pausing at the same cursor produce different daily OHLCV. The tests have improved but still do not establish full data-to-renderer convergence.

## P1: Daily playback still applies synthetic data rejected by paused snapshots

Locations: `src/hooks/useChartData.ts:496` and `src/hooks/useChartLifecycle.ts:651–654, 720–741`.

The new `isSynthesized` exclusion protects the daily React snapshot. The imperative playback subscriber still falls back to `latestTick`, then applies its synthetic price and complete source-minute volume to the daily candle.

Reproduced using real `useChartData`, real `useChartLifecycle`, and the real playback store connected in one hook harness. Only API and chart boundaries are mocked. The fixture is a TSLA 09:30 minute with open 101, high 150, low 80, close 120, and volume 10,000, with no raw ticks.

1. Seek to 09:30:00 and allow the daily chart to hydrate.
2. Play and advance to 09:30:01.
3. Read actual price/volume series update calls.
4. Pause without advancing time and read the data hook's resulting daily snapshot.

| State at 09:30:01 | Open | High | Low | Close | Volume |
| --- | ---: | ---: | ---: | ---: | ---: |
| Playing, actual series update | 101 | 101 | 99.6 | 99.6 | 10,000 |
| Paused snapshot | 101 | 101 | 101 | 101 | 0 |

Pausing changes the candle despite an unchanged cursor and unchanged available data. The unfinished-minute protection therefore remains incomplete in the live path.

### Fix direction and meaningful tests

Use the same eligibility and fallback policy for daily snapshot generation and live playback. Avoid treating synthesized source-bar values as actual elapsed trades. Do not simply stop all synthetic updates: the daily chart must still incorporate a source minute once it completes when no raw ticks exist.

Retain a combined-hook regression with real snapshot generation. Compare exact OHLCV for direct seek, play, pause, resume, and rewind at the same cursor. Check both 09:30:01 and the 09:31:00 completion boundary. Include empty raw ticks, only future raw ticks, and sparse elapsed raw ticks. Assert actual rendered series state as well as snapshot output.

The failing combined diagnostic is saved in `market-rewind-356b1e2-probes/review.test.ts` beside this report. Its configuration is in the same directory. The harness uses local absolute imports and should be adapted before incorporation into the repository.

## P2: Claimed convergence coverage still skips snapshot construction

Location: `tests/unit/followupReviewProbes.test.ts:248–259`, with the same pattern in `tests/unit/rereviewProbes.test.ts`.

The test now reads actual chart calls and unmounts between pathways, which fixes two weaknesses. However, direct seek still passes a manually assembled correct candle into `mountLifecycle`. It tests whether the lifecycle renders that supplied candle; it does not verify that the real data hook constructs the same candle as live playback. The combined failure above demonstrates why that distinction matters.

Connect real data-hook output to the lifecycle, feed raw fixtures at the API/store boundaries, and compare independently calculated expected candles against a stateful series adapter. Include the daily synthetic fallback case, not only a five-minute raw-trade fixture.

The browser test now requires a successful NVDA switch, which is an improvement. Its containment assertion at `tests/regression/journey/12-replay-convergence.spec.ts:54–57` only requires the last bar to precede **23:59:59**, despite a replay cursor of **09:20**. It cannot detect future prices inside a correctly timestamped forming candle, either. Assert the actual cursor boundary and exact rendered OHLCV from a fixture containing recognizable future extrema. This suite was inspected, not executed in this review.

## Validation

- All nine previous standalone diagnostic checks passed, including the two previously failing daily checks.
- The new combined-hook check failed: live volume 10,000 versus paused volume 0 at the same cursor.
- Repository suite initially returned 387 passes and two failures caused by sandbox-blocked network access. Rerunning the affected five-test file with network access passed all five; together these runs account for all 389 existing tests passing.
- Production build passed.
- Working tree was clean. No application fixes were made.
