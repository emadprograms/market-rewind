# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## daily-1d-rth-session-leak — live 1D daily candle leaks pre/post-market OHLCV via sessionless candle rows
- **Date:** 2026-10-25
- **Error patterns:** 1D daily wrong OHLCV, extended-hours leak, RTH isolation, sessionless candles, missing session column, live-vs-paused divergence, LAKE-RESAMPLE-04
- **Root cause(s):** TickLakeReader.query_candles selected no session column (query_ticks did) while streamingClient.getCandles relabeled every sessionless row session='REG', erasing PRE/POST identity on the 1-minute replay tape; AND the live 1D aggregation (buildDailyIndex/aggregateDailyBucket + CONV-VOL-01 reconstruction) filtered on labels alone with no RTH wall-clock window, unlike the paused snapshot memo. Secondary isRthBar suffix trap: any 12:00:00-UTC timestamp was treated as an anchored daily bar.
- **Fix:** Backend candle SQL emits truthful per-bucket session (array_to_string(array_sort(array_agg(DISTINCT upper(session_expr))), ', '), null when the lake lacks the column); new isRthIntradayBar() wall-clock gate (equity 09:30-16:00 ET, UTC assets always RTH) applied in buildDailyIndex and the CONV-VOL-01 loop; streamingClient maps missing session to '' instead of fabricated REG; isRthBar anchor-suffix shortcuts now require timeframe === undefined.
- **Files changed:** backend/streaming_service/tick_lake_reader.py, src/lib/timezones.ts, src/lib/dailyIndex.ts, src/hooks/useChartLifecycle.ts, src/lib/streamingClient.ts, tests/unit/dailyRthSessionGuard.test.ts, backend/streaming_service/tests/test_candle_session_labels.py
- **Why not caught:** No gate existed for the real backend row shape — all frontend fixtures and the Playwright mock hand-label sessions (and the mock only builds minute bars from 09:30 ET), so 618 green tests never exercised sessionless candles; the backend daily (1d) endpoint was already REG-filtered, hiding that the 1-minute candle feed was not.
- **Recurrence guard:** tests/unit/dailyRthSessionGuard.test.ts (12 tests, real sessionless + mislabeled-REG row shapes, exact RTH-oracle OHLCV, boundary neighbors 09:29/09:30 and 15:59/16:00 ET, UTC asset case, client mapping) and backend/streaming_service/tests/test_candle_session_labels.py (3 tests, truthful/composite/daily-REG labels).
---
