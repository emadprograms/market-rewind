# Verification Brief — Seek While Playing Freeze

**Debug session:** `.planning/debug/seek-while-playing-freeze.md` (status: `awaiting_human_verify`)
**Under test:** branch `arena/22112ce1-market-rewind` — fix commit `4064b4b`
**Baseline for A/B:** `main` @ `e57efe8`

This brief is written to be handed to an agent verbatim. Everything in it is runnable on a
machine that has the real environment (tick lake + DuckDB backend + a Chromium browser), which
the sandbox that produced the fix does not have. **Do not fix anything you find — report it.**
Raw, verbatim output is more useful than a summary.

### Instructions to the agent receiving this brief

You are a **test executor**, not an author. Read this once, then:

1. **Execute** the commands. Do not restate, reformat, paraphrase or "continue" this document —
   a reply containing this text and no command output is a failed hand-off.
2. **One shot:** `bash tools/verify-seek-freeze-fix.sh --ab` runs steps 0–8 below for you,
   keeps going after failures, and writes a single report file. Paste that file back.
   Sections 1–8 exist so you can run any step by hand, or explain why one could not run.
3. **Report measurements, not impressions.** Every claim needs the number or the verbatim
   error line that produced it.
4. **Blocked ≠ passed.** If a step cannot run (no browser, no backend, no tick lake), record
   `BLOCKED: <exact reason>` — never omit it and never mark it green.
5. **Do not modify source.** Only the report/logs are yours to write. If you believe the fix is
   wrong, say so with the failing assertion attached.
6. Section 9 (manual UAT) needs a human at a real browser — flag it as such if you are headless.

---

## 0. Setup

```bash
git fetch origin
git checkout arena/22112ce1-market-rewind
git pull --ff-only
npm install
npx playwright install chromium          # only if the browser is missing

# Terminal B — leave running for every step that needs live data:
npm run backend                          # DuckDB streaming service on :8765
curl -s localhost:8765/api/status | head -c 400   # must answer, and report the tick lake root
```

If `npm run backend` cannot find the tick lake (`../data-harvester/data/tick_lake`), set
`TICK_LAKE_ROOT` and retry. **Record the answer to this in the report** — steps 5–8 depend on it.

---

## Preferred path: the harness

```bash
git fetch origin && git checkout arena/22112ce1-market-rewind && git pull --ff-only
npm install && npx playwright install chromium
npm run backend &                                  # another terminal; wait for :8765
bash tools/verify-seek-freeze-fix.sh --ab          # ~15-30 min; add --quick to skip the long suite
```

It prints the report to stdout and writes it to `/tmp/market-rewind-verify-<stamp>/report.txt`,
with every step's raw output in `/tmp/market-rewind-verify-<stamp>/logs/`. Paste back the
`=== PASTE THIS BACK ===` section plus the `FREEZE-REPORT` blocks. If it exits before finishing,
paste whatever it printed and say which step it stopped on.

Everything below is what the harness runs, spelled out for manual or partial execution.

## 1. Static gates (no backend needed)

```bash
npx tsc --noEmit -p tsconfig.json        # expect: no output, exit 0
npm run build                            # expect: "built in Ns", no errors
```

## 2. Full unit + integration suite

```bash
npx vitest run
```

Expected on the fix branch: **95 files passed, 563 passed, 2 skipped, 0 failed.**
The two guards written for this defect are:

```bash
npx vitest run tests/unit/seekWhilePlayingFreeze.test.ts tests/integration/seekTimelineCandles.test.tsx
```

Expected: **8 passed** (5 + 3). If anything fails, paste the full assertion output.

## 3. Backend suite (unchanged code — sanity only)

```bash
npm run backend:test
```

Expected: all passed (the fix touches no Python).

## 4. Journey suite (fully mocked, no backend needed)

```bash
npx playwright test -c playwright.journey.config.ts
```

Expected: all passed. Report per-spec results, especially `05-playback-transport`,
`06-live-replay`, `12-replay-convergence`.

## 5. The defect-specific E2E probe (needs backend + browser)

```bash
npx playwright test tests/regression/chart/seekWhilePlayingFreeze.spec.ts
```

Three tests, added by this fix:

| Test | What it proves |
|---|---|
| `stepping forward and backward while playing keeps the main thread responsive` | rAF heartbeat gap and click-dispatch latency stay under 1500 ms per seek; ≤12 chart-primitive writes per seek per chart; seeking does not force-pause |
| `rapid scrubbing while playing does not degrade into a per-tick replay` | 30 scrubber-sized seeks stay bounded in writes and never stall a frame |
| `rewinding while playing leaves no candle newer than the playhead` | zero future-data leakage after a rewind |

Each test always prints a `FREEZE-REPORT {...}` JSON block to stdout. **Copy every
`FREEZE-REPORT` block into the report, pass or fail.**

The default tape is `AAPL` on `2026-09-25`. On that date raw ticks start mid-afternoon, so if a
test skips with `tape too thin`, re-run against a denser session and report both:

```bash
SEEK_SYMBOL=SPY SEEK_DATE=2026-09-24 SEEK_ENTRY=09:30 \
  npx playwright test tests/regression/chart/seekWhilePlayingFreeze.spec.ts
```

(Use whichever symbol/date has the densest tape locally; report `totalTicks` from the
`FREEZE-REPORT` so the numbers can be interpreted.)

## 6. Pre-existing E2E regressions most related to seeking

```bash
npx playwright test tests/regression/chart/chartShaking.spec.ts
npx playwright test tests/regression/replay/realtimePlayback.spec.ts
npx playwright test tests/regression/sync/
```

Expected: all passed. `chartShaking.spec.ts` already contains "rapid slider scrubbing back and
forth", "seeking backward to earlier time" and three "seeking forward … pressing play" cases —
these are the closest pre-existing neighbours of this defect, so any failure there is a
regression from the fix and must be reported verbatim.

## 7. Full regression suite (long; run last)

```bash
npm run test:regression
```

Report the pass/fail count per spec file and the full error for any failure.

---

## 8. A/B: the same measurement on `main` (this is the important one)

The point of the exercise is to show the freeze existed and is gone. Run the E2E probe on the
unfixed baseline and on the fix, back to back, with the same tape:

If your working tree has uncommitted changes, commit or stash them first — these steps switch
branches. The probe spec exists only on the fix branch, so it is copied onto `main` for the
baseline run and deleted afterwards; the source fix is deliberately NOT carried over.

```bash
# --- baseline: unfixed source + the probe ---
git checkout main
git checkout arena/22112ce1-market-rewind -- tests/regression/chart/seekWhilePlayingFreeze.spec.ts
npx playwright test tests/regression/chart/chartShaking.spec.ts 2>&1 | tee /tmp/shaking-main.log
npx playwright test tests/regression/chart/seekWhilePlayingFreeze.spec.ts 2>&1 | tee /tmp/freeze-main.log
rm tests/regression/chart/seekWhilePlayingFreeze.spec.ts

# --- fix branch ---
git checkout arena/22112ce1-market-rewind
npx playwright test tests/regression/chart/chartShaking.spec.ts 2>&1 | tee /tmp/shaking-fix.log
npx playwright test tests/regression/chart/seekWhilePlayingFreeze.spec.ts 2>&1 | tee /tmp/freeze-fix.log
```

Expected: on `main` the probe **fails** with multi-second `heartbeatMaxGapMs` /
`dispatchLatencyMs` and thousands of writes per seek; on the fix branch it **passes** with
sub-100 ms gaps and single-digit writes. Report the four numbers from each side:
`heartbeatMaxGapMs`, `dispatchLatencyMs`, `writes` per chart, `longTasks.maxMs`.

## 9. Manual UAT in a real browser (the user-visible symptom)

`npm run dev`, open `http://localhost:3000`, initialize a session on the densest tape available,
keep 2 charts (default `5min` + `1D`) and open DevTools → Performance, recording.

While the replay is **PLAYING**:

1. Press STEP forward (3 m) ten times in a row, quickly.
2. Press STEP backward ten times.
3. Drag the scrubber slowly across the whole session, then flick it end to end.
4. Use the `HH:MM:SS` jump box to jump forward, then backward.
5. Repeat 1–3 at SPEED 25x and 100x.
6. Rewind ~30 minutes, then look at the chart: is any candle visible to the right of the
   playhead? (It must not be.)

Success criteria: no "Page unresponsive" dialog, no tab kill, the UI keeps responding during and
after every action, the chart and the Time & Sales tape keep following the playhead in both
directions, and no future candle survives a rewind.

Report: the longest task (ms) shown by the Performance panel during a single step-forward while
playing, total scripting time for one full scrubber drag, and any console error/warning text.

---

## Report format

Please return exactly this block, filled in (delete nothing; write `n/a` where unavailable):

```
BRANCH: <name> @ <sha>
BACKEND: up|down   TICK_LAKE_ROOT: <path>   TAPE: <symbol> <date> totalTicks=<n>

1  tsc:                PASS|FAIL  <verbatim output if FAIL>
2  vitest:             files=<n> passed=<n> skipped=<n> failed=<n>
                       failures: <test name + full assertion text>
2b seek guards:        passed=<n> failed=<n>
3  build:              PASS|FAIL  <bundle size / time>
4  backend pytest:     passed=<n> failed=<n>
5  journey e2e:        passed=<n> failed=<n>  failures: <spec › test + error>
6  freeze probe (fix): passed=<n> failed=<n> skipped=<n>
                       FREEZE-REPORT blocks: <paste all, verbatim>
7  chartShaking:       passed=<n> failed=<n>  failures: <verbatim>
7b realtimePlayback:   passed=<n> failed=<n>
7c sync/:              passed=<n> failed=<n>
8  full regression:    passed=<n> failed=<n>  per-spec: <list>
9  A/B on main:        freeze probe passed=<n> failed=<n>
                       main:  heartbeatMaxGapMs=<n> dispatchLatencyMs=<n> writes=<n> longTaskMaxMs=<n>
                       fix:   heartbeatMaxGapMs=<n> dispatchLatencyMs=<n> writes=<n> longTaskMaxMs=<n>
10 manual UAT:         froze=YES|NO  unresponsive_dialog=YES|NO
                       longest_task_ms=<n>  scrub_drag_scripting_ms=<n>
                       future_candle_after_rewind=YES|NO
                       console_errors: <verbatim or "none">
NOTES: <anything unexpected, flaky reruns, machine specs>
```

Anything that fails: include the **verbatim** error and, for Playwright, the trace/screenshot
path (`test-results/`, `playwright-report/`). Do not attempt a fix — the numbers are what matter.
