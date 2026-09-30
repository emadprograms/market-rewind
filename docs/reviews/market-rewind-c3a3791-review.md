# Follow-up review: c3a3791

Reviewed September 30, 2026. Review only; repository files were not changed.

## Verdict

The three previous diagnostic failures now pass. Two additional checks still reproduce daily-chart correctness problems, and the newly added transition/browser tests do not establish the claimed convergence. The replay is improved but not ready for a clean approval.

## Findings

### P1: Synthetic ticks bypass daily forming-minute protection

Location: `src/hooks/useChartData.ts:496–501`; synthesized ticks originate in `src/store/usePlaybackStore.ts`.

The daily aggregation now zeroes unfinished-minute volume, but its fallback immediately adds `latestTick.volume`. A real `seekTickTime` call creates a synthesized tick carrying the entire source minute's final volume. With no raw symbol ticks, that synthetic tick bypasses the protection.

Reproduced with a September 22 TSLA 09:30 minute: open 101, high 150, low 80, close 120, volume 10,000. After calling the real seek action for 09:30:01, the daily candle has volume **10,000**, low **99.6**, and close **99.6**. The price is synthetic and derived from the completed source candle; it is not an elapsed trade.

The existing passing test directly assigns `currentTime`, leaving no synthesized latest tick. It therefore misses this real transition.

Fix direction: distinguish synthetic fallback values from actual trades throughout daily aggregation and playback. Define one consistent policy for unavailable intraminute data; do not re-add completed source volume through the synthetic-tick branch after protecting the source bar.

Regression: call the real seek action, then render the data hook. Assert all OHLCV fields under the chosen fallback policy. Repeat through play/pause, with no raw ticks and with only future raw ticks. Directly assigning the clock is not sufficient to cover seek behavior.

### P1: Volume reconstruction imports premarket into the RTH-only daily candle

Location: `src/hooks/useChartLifecycle.ts:505–510`.

The new snapshot reconstruction filters by symbol, bucket, and timestamp, but not session. For `1D`, both PRE and REG bars map to the same daily bucket. The next synthetic update sums that reconstructed map and writes it into daily volume.

Reproduced with 1,000 PRE shares at 09:20 and 200 REG shares at 09:30. Hydrate a daily candle at 09:30, resume, and advance to 09:30:01: daily volume becomes **1,200**. Even allowing the full 200-share regular minute as synthetic fallback, the additional 1,000 premarket shares cannot belong in an RTH-only daily candle.

Fix direction: apply the chart's eligibility rules while reconstructing constituents, including strict RTH filtering for daily charts. Share those rules with snapshot generation and live aggregation.

Regression: include distinctive PRE/REG/POST prices and volumes; hydrate and resume the real lifecycle, then inspect the volume series. Add a combined data-hook/lifecycle test to establish that pause/resume and direct seek give the same RTH-only result. Assert exact totals once the fallback policy is fixed.

### P2: Added convergence tests can pass without verifying the intended behavior

Locations: `tests/unit/rereviewProbes.test.ts:280–284` and `tests/regression/journey/12-replay-convergence.spec.ts:43–56`.

The direct-seek path seeds the expected candle into the lifecycle and then constructs the expected result as a literal whenever the hook result is truthy. It never reads actual rendered OHLCV. Multiple mounted lifecycle hooks also remain subscribed to the shared store and write into shared mocks during later paths.

The browser symbol-switch test conditionally skips the switch if selectors are absent, then checks only canvas visibility and absence of page errors. It does not assert that AAPL was selected or inspect any prices/volume. Despite its file header, the suite does not test the three stated numerical failure modes.

Fix direction: use real data-hook output connected to the real lifecycle, and a stateful fake chart series. Unmount/reset between transition paths. Read actual rendered bars and compare exact OHLCV against an independent fixture. In browser tests, require the switch to succeed and assert known symbol, cursor, and rendered OHLCV; a visible canvas is insufficient.

## Validation

- All seven checks in the previous standalone rereview harness pass, including its three formerly failing checks.
- Two new diagnostic checks fail for the numerical mismatches above.
- Repository suite: 375 passed and two network-blocked tests failed initially. Rerunning the affected five-test file with network access passed all five. Together these runs account for all **377** existing tests passing.
- Production build passes.
- Browser suite was inspected, not executed in this review.
- Working tree remains clean.

## Diagnostic files

The standalone probes are saved beside this report in `market-rewind-v42-review-probes/`:

- `data.test.ts`: real-seek daily fallback failure.
- `review.test.ts`: daily PRE-volume contamination.
- `vitest.config.mjs`: standalone test configuration.

These probes include earlier passing checks and use local absolute imports. They are reproducible diagnostic evidence, not a replacement for the integrated and browser tests described above.
