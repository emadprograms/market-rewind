# Verification Brief — 1D Daily Candle Formation

**Debug session:** `.planning/debug/1d-canvas-forming-candle.md` (status: `awaiting_human_verify`)
**Under test:** branch `arena/e1206655-market-rewind` @ the SHA you were given (pinned in the hand-off)
**Baseline for A/B:** `b5aaa213ece3308553d674b9407e1857c26ce0e2` (the branch point of this fix, the ref the harness uses). Do not use `origin/main`.

This brief is written to be handed to an agent verbatim. Everything in it is runnable on a machine
that has the real environment (tick lake + DuckDB backend + a Chromium browser), which the sandbox
that produced the fix does not have. **Do not fix anything you find — report it.** Raw, verbatim
output is more useful than a summary.

### What was fixed, in one paragraph

The chart's *timeframe* was being passed as the *bar's granularity* into the RTH filter, so on a 1D
chart every constituent 1-minute bar was treated as an already-aggregated daily bar and exempted from
the RTH test. Overnight (00:00 UTC = 20:00 ET), pre-market (12:00 UTC = 08:00 ET) and post-market
minutes then set the daily open/high/low and inflated daily volume to a 24h total — on the canvas
path only. The React snapshot path filtered by a real RTH window and was correct, but it is frozen
during playback (PERF-01), so the wrong candle owned the screen while playing and the right one took
over on pause. `streamingClient` also fabricated `session: 'REG'` on every candle even though the
service's candle projection returns no session column, which masked the whole thing.

### Instructions to the agent receiving this brief

You are a **test executor**, not an author. Read this once, then:

1. **Execute** the commands. Do not restate, reformat, paraphrase or "continue" this document — a
   reply containing this text and no command output is a failed hand-off.
2. **One shot:** `bash tools/verify-daily-candle-fix.sh --full --ab --probe` runs steps 1–5 below for
   you, keeps going after failures, and writes a single report file. Paste that file back.
   Sections 1–6 exist so you can run any step by hand, or explain why one could not run.
3. **Report measurements, not impressions.** Every claim needs the number or the verbatim error line
   that produced it. In particular: paste the probe's `VERDICTS` block and the daily bar's OHLCV.
4. **Blocked ≠ passed.** If a step cannot run (no browser, no backend, no tick lake), record
   `BLOCKED: <exact reason>` — never omit it and never mark it green.
5. **Do not modify source.** Only the report/logs are yours to write. If you believe the fix is
   wrong, say so with the failing assertion attached.
6. Section 6 (manual UAT) needs a human at a real browser — flag it as such if you are headless.

---

## 0. Setup

```bash
git fetch origin
git checkout arena/e1206655-market-rewind
git pull --ff-only
npm install --no-audit --no-fund

# Terminal B — leave running for every step that needs live data:
npm run backend                                        # DuckDB streaming service on :8765
curl -s localhost:8765/api/status | head -c 400        # must answer, and report the tick lake root
```

Pick the tape you actually reproduce the defect with and export it — every later step uses it:

```bash
export PROBE_SYMBOL=TSLA          # the symbol in your 2-chart layout
export PROBE_DATE=2026-10-14      # the day whose candle is wrong
export PROBE_BASE=http://127.0.0.1:8765
```

If `npm run backend` cannot find the tick lake (`../data-harvester/data/tick_lake`), set
`TICK_LAKE_ROOT` and retry. **Record the answer in the report** — steps 5–6 depend on it.

---

## Preferred path: the harness

```bash
npm install --no-audit --no-fund
npm run backend &                                       # another terminal; wait for :8765
export PROBE_SYMBOL=TSLA PROBE_DATE=2026-10-14
bash tools/verify-daily-candle-fix.sh --full --ab --probe
```

It prints a progress line per section and writes ONE report to `/tmp/daily-candle-verification.md`
(override with `REPORT=/path/...`), with the live-data probe also at `/tmp/daily-probe.md`.
**Paste both back verbatim.** If it exits before finishing, paste whatever it printed and say which
step it stopped on. Flags: `--full` (entire vitest suite), `--backend` (pytest), `--ab` (pre-fix
worktree), `--probe` (live data). Everything below is what the harness runs, spelled out for manual
or partial execution.

---

## 1. Static gates (no backend needed)

```bash
npx tsc --noEmit            # expected: 0 errors
npm run build               # expected: vite build succeeds (~3s, ~470 kB bundle)
```

`RawBar.session` became optional in this fix, so `tsc` is a real gate here, not a formality.
Sandbox result: **0 errors**, build succeeded in 2.85s.

## 2. Frontend suites covering the fix

```bash
npx vitest run \
  tests/regression/chart/dailyCandleCanvasFormation.test.tsx \
  tests/unit/dailyConstituentRth.test.ts \
  tests/unit/streamingClientSession.test.ts \
  tests/unit/dailyRthChart.test.ts \
  tests/unit/timezones.test.ts \
  tests/unit/resampling.test.ts \
  tests/hooks/useChartLifecycle.test.ts \
  tests/integration/multiChartWorkspaceReplay.test.tsx \
  tests/regression/codex/chartRenderingIntegrity.test.ts
```

Expected: **all pass**. Sandbox result: 21 new tests across the first three files, all green.

Then the whole suite (this is the regression gate — the fix touches session classification, which
many tests depend on):

```bash
npx vitest run
```

Expected: **106 files / 639 passed / 2 skipped** (the pre-fix baseline was 103 / 618 / 2; the delta
is the 3 new test files). Any failure here is a real neighbour broken by the fix — paste the full
assertion text, do not "fix" it.

## 3. Backend suite (backend code is unchanged — sanity only)

```bash
npm run backend:test        # or: PYTHONPATH=. pytest -q backend/streaming_service/tests
```

Expected: unchanged from your local baseline. No backend file was touched by this fix; a failure here
means something else moved.

## 4. A/B — the same repro against pre-fix source (the important one)

```bash
bash tools/verify-daily-candle-fix.sh --ab
```

This creates a throwaway `git worktree` at `b5aaa21`, copies the NEW tests into it, symlinks
`node_modules`, runs the canvas repro against the OLD `src/`, then removes the worktree. Your working
tree is never touched.

Expected on pre-fix source (**the defect must come back**):

```
FAIL tests/regression/chart/dailyCandleCanvasFormation.test.tsx > 1D forming candle while replaying
     ON 2026-10-14 > builds the forming 2026-10-14 candle from RTH bars only (open 250, not the
     overnight 100)
AssertionError: daily open must be the first RTH print (250), never an overnight/pre-market bar:
     expected 100 to be 250
Test Files  1 failed (1)      Tests  1 failed | 7 passed (8)
RESULT: PASS (A/B reproduced the defect on pre-fix src)
```

Sandbox result: exactly the above, and 8/8 green on the fixed tree. If the A/B does **not** fail on
pre-fix source, the regression test is not actually exercising the defect — report that loudly.

Manual equivalent, if you prefer git by hand:

```bash
git stash push -- src            # keep the new tests, revert the fix
npx vitest run tests/regression/chart/dailyCandleCanvasFormation.test.tsx   # expect 1 failure
git stash pop                    # reapply; expect 8/8
```

## 5. Live data probe (needs the backend) — the question the sandbox could not answer

```bash
python3 tools/probe-daily-candle.py --symbol "$PROBE_SYMBOL" --date "$PROBE_DATE" \
  --base "$PROBE_BASE" --report /tmp/daily-probe.md
```

Stdlib only, read-only, always exits 0. It answers whether the *backend's* daily bar for that date is
RTH-correct, or whether the same whole-UTC-day contamination is baked into the lake:

| Check | Question | FAIL means |
|---|---|---|
| C1 | The exact query the frontend issues (`tf=1d`, no `start_time`, `limit=1500`): status, timing, and that date's bar | No bar for that date, or `LakeIncompatibleSchema` (a resolved parquet partition has no `session` column), or slower than the client's 15s `AbortSignal.timeout` → the 1D chart silently gets `[]` |
| C2 | Bounded `tf=1d` for that day, `session=REG` vs `session=ALL` | `WARN` if identical: the lake's `session` column is not discriminating, so the server's daily bar includes extended hours |
| C3 | Tick-level RTH ground truth (09:30–16:00 ET) aggregated by the probe, compared with C2 | The backend's own daily bar disagrees with its ticks, or its volume is >1.05x the RTH tick volume → **the wrong candle is in the lake, not (only) the frontend** |
| C4 | The lake's `session` labelling: per-session tick counts and UTC time ranges | Ticks labelled `REG` outside the RTH window → mislabelled session column poisons every RTH-only aggregate downstream |
| C5 | Whether `tf=1m` serves extended-hours minutes at all, and whether 1m rows carry a `session` key | `WARN` if ETH minutes are served: before the fix these set the daily open/high/low/volume |
| C6 | Contention: the `1d` query while a `1m` query and a 100k-tick query run concurrently | `1d` > 15s under load → the two-chart layout blanks the 1D history. A real second defect; report it |

Paste the whole probe output including the `VERDICTS` block. If C3 or C4 FAILs, also paste the raw
row:

```bash
curl -s "$PROBE_BASE/api/streaming/candles?symbol=$PROBE_SYMBOL&tf=1d&session=REG&start_time=$PROBE_DATE%2000:00:00&end_time=$PROBE_DATE%2023:59:59&limit=5"
```

## 6. Manual UAT in a real browser (the user-visible symptoms)

Needs a human. `npm run dev`, open the app, and reproduce the reported setup exactly:

1. **2-chart layout, same symbol both charts** — 5m left (ETH on), 1D right. This is the layout that
   failed; also repeat with a lone 1D chart to confirm parity.
2. Load/reset into the day AFTER `$PROBE_DATE` (e.g. 2026-10-15), entry ~09:10 ET.

**Symptom A — the completed candle.** Read the `$PROBE_DATE` candle's OHLC off the chart (hover the
candle / use the legend readout) and compare with the probe's C3 RTH aggregate:

- `open` must equal the first RTH print (~09:30 ET), **not** a lower overnight/pre-market price.
- `low` must not be below the RTH low; `volume` must match the RTH tick volume within a few percent,
  **not** a multiple of it.
- The values must be identical whether you read them right after loading, or after playing and pausing.

**Symptom B — the forming candle.** Press play and watch the latest day's candle on the 1D chart:

- It must be **visible and growing while playing** (body + wick, not just the moving bid/ask price
  lines).
- **Pausing must not change its shape.** Before the fix, pausing visibly snapped the candle to
  different open/low/volume values — that snap is the defect. If you still see a snap, record the
  OHLCV before and after the pause (this is the single most useful measurement in this section).
- Change playback speed (1x → 25x → 100x) and seek backwards/forwards; the candle must stay
  consistent, with no duplicate or out-of-order daily bar appearing.

**Console diagnostics.** Open DevTools and paste anything matching:

- `Diagnostic: Filtered data severely reduced`
- any `lightweight-charts` warning/error, or `series` update error
- any `console.warn` from `getCandles` (abort/timeout) — this is the C1/C6 silent-empty path

Then paste the output of this snippet, which recomputes the RTH-only aggregate from the store's own
1-minute `masterData` so you can compare it against what is drawn:

```js
(() => {
  const ET = { timeZone: 'America/New_York', hourCycle: 'h23' };
  const etOf = ms => new Date(ms).toLocaleString('en-CA', ET);          // "2026-10-14, 09:30:00"
  const barEt = t => etOf(new Date(String(t).replace(' ', 'T') + 'Z').getTime());
  const s = window.usePlaybackStore.getState();
  if (!s.currentTime) return console.warn('no currentTime — is a session loaded?');
  const sym = s.currentTick?.symbol || Object.keys(s.latestTickBySymbol || {})[0];
  const day = etOf(s.currentTime).split(',')[0];
  const mins = (s.masterData || []).filter(b => barEt(b.time).split(',')[0] === day);
  const isRth = b => { const [h, m] = barEt(b.time).split(', ')[1].split(':').map(Number);
                       return h * 60 + m >= 570 && h * 60 + m < 960; };  // 09:30..16:00 ET
  const agg = bars => bars.length ? {
    n: bars.length, open: bars[0].open,
    high: Math.max(...bars.map(b => b.high)), low: Math.min(...bars.map(b => b.low)),
    close: bars[bars.length - 1].close,
    volume: bars.reduce((a, b) => a + (b.volume || 0), 0),
    first: barEt(bars[0].time).split(', ')[1], last: barEt(bars[bars.length - 1].time).split(', ')[1],
  } : { n: 0 };
  const rth = mins.filter(isRth);
  console.table({ symbol: sym, sessionDay: day, isPaused: s.isPaused,
    masterDataLen: (s.masterData || []).length, dayMinutes: mins.length,
    ALL_24h: agg(mins), RTH_only: agg(rth) });
})();
```

The drawn 1D candle must match the **RTH_only** column. If it matches **ALL_24h**, the fix is not
active in the bundle you are running (check the branch/SHA and hard-reload).

---

## Report format

Please return exactly this block, filled in (delete nothing; write `n/a` where unavailable):

```
BRANCH: <name> @ <sha>
BACKEND: up|down   TICK_LAKE_ROOT: <path>   TAPE: <symbol> <date>
LAYOUT TESTED: 2-chart (5m+1D, same symbol)|1-chart|both

1  tsc --noEmit:        PASS|FAIL  <verbatim output if FAIL>
1b vite build:          PASS|FAIL  <time / bundle size>
2  targeted suites:     files=<n> passed=<n> failed=<n>
                       failures: <test name + full assertion text>
2b full vitest:         files=<n> passed=<n> skipped=<n> failed=<n>   (expected 106/639/2/0)
3  backend pytest:      passed=<n> failed=<n>
4  A/B on b5aaa21:      REPRODUCED|NOT-REPRODUCED
                       pre-fix: passed=<n> failed=<n>   assertion: <verbatim>
                       fixed:   passed=<n> failed=<n>
5  data probe:          <paste the whole VERDICTS block>
   C1 daily bar:        time=<t> open=<n> high=<n> low=<n> close=<n> volume=<n> session=<s>  in <n>s
   C3 RTH truth:        ticks=<n> open=<n> high=<n> low=<n> close=<n> volume=<n>   volumeRatio=<n>x
   C4 session counts:   REG=<n> (range <hh:mm>-<hh:mm> UTC)  PRE=<n>  POST=<n>  OTHER=<n>
   C5 1m bars:          total=<n> inRTH=<n> outsideRTH=<n>  sessionKeyPresent=yes|no
   C6 1d under load:    <n>s   (client timeout is 15s)
6  manual UAT:
   symptom A:           FIXED|STILL-WRONG   chart open/low/volume=<n>/<n>/<n>  vs probe C3=<n>/<n>/<n>
   symptom B (playing): candle visible yes|no   grows yes|no
   symptom B (pause):   shape unchanged yes|no   OHLCV before=<...> after=<...>
   speed/seek changes:  consistent yes|no   duplicates/out-of-order: <describe>
   console snippet:     ALL_24h=<...>  RTH_only=<...>  drawn candle matches: RTH_only|ALL_24h|neither
   console errors:      <verbatim, or "none">
```
