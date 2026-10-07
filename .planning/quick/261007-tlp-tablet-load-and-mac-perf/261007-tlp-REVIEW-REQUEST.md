# Review request — local Mac agent

**Branch:** `arena/bbbe0bc6-market-rewind` · **PR:** [#4](https://github.com/emadprograms/market-rewind/pull/4)
**Current head:** `de7eb03`

Please review and verify on real hardware. Everything below is either something I could
not test in the sandbox (macOS `launchd`, real GPU, real tick lake) or something where my
measurement says one thing and your machine may say another.

---

# Test matrix — run these, in this order

Five perf runs plus two checks. The whole set is maybe 30–40 minutes. **Tier 1 is the
priority** — if you only do three things, do runs 1, 2 and 6.

**Hold every other variable constant across a comparison**: same symbol, same replay date,
same window size, same browser window, no other tabs. Change one axis at a time. Hard-reload
(Cmd+Shift+R) before each measurement.

| # | Tier | Run | Fix | Vary | Question it answers |
|---|---|---|---|---|---|
| 1 | **1** | Fix A/B | 25×, 12 charts, same timeframe | `7bd01d6` → `de7eb03` | Did the per-frame invalidation fix move CPU/GPU? |
| 2 | **1** | Chart scaling | 25×, `de7eb03` | 1, 2, 4, 12 charts | Does cost scale with chart count? → is off-screen culling the next lever? |
| 3 | **1** | Speed scaling | 12 charts, `de7eb03` | 1×, 5×, 25× | Is the cost frame-bound or tick-bound? → tells me what to attack next |
| 4 | 2 | DPR | 25×, 12 charts, `de7eb03` | DPR 1 vs native | How big is the "Performance Mode" lever? |
| 5 | 2 | Timeframe | 25×, `de7eb03` | 1D vs 1m | Does the 1D index fix apply to your workload at all? |
| 6 | **1** | Auto-start | — | — | Is the tablet fix actually active on your Mac? (section 1) |
| 7 | 2 | `benchmark.sh` | — | — | Do the load/compression mechanisms still pass? (section 3) |

### How to switch commits and re-measure

```bash
cd /path/to/market-rewind
git fetch origin
git checkout <sha>                 # e.g. 7bd01d6 (before) or de7eb03 (after)
./tools/mac/restart-services.sh
sleep 15                           # it rebuilds the bundle before serving
./tools/mac/status-services.sh     # confirm: Serving: PRODUCTION bundle
```

Then hard-reload the browser before measuring.

### How to record

**Use the same instruments as your earlier run** — comparability matters more than
sophistication. Whatever produced the 69.3% CPU / 68.0% GPU peak numbers, keep using it.

Add one thing if you can: **Chrome DevTools → Performance → record ~10 s at 25×** and report
**FPS** and **dropped frames**. CPU% alone cannot tell us whether frames are actually being
dropped, and dropped frames are what "performance" means here.

### Why these axes specifically

- **Run 2 is the important new one.** If cost scales roughly linearly with chart count, then
  per-chart work dominates and culling off-screen charts is the biggest remaining win — larger
  than anything in this PR so far. If it is flat, the cost is global and culling is pointless.
- **Run 3 separates "60 fps of overhead regardless of data" from "cost proportional to ticks".**
  Every fix so far targets the former. If CPU instead scales with replay speed, I have been
  aiming at the wrong term and should stop.
- **Run 4 prices the DPR trade before anyone makes it.** A DPR cap only makes sense if the
  number it buys is worth the softness.

---

## 1. Priority — the auto-start path was serving the dev server

**What was wrong.** `install-startup.sh` wrote a frontend LaunchAgent that ran
`node_modules/vite/bin/vite.js` **directly**. That is the unbundled dev server: no build,
no `vite preview`. It bypassed `SERVE_MODE` completely. Because both plists are
`RunAtLoad` + `KeepAlive`, and because `start-services.sh` prefers `launchd` whenever the
plists exist, **nothing in the normal boot path ever reached `start-frontend.sh`.**

So on any Mac with auto-startup installed, port 3000 was permanently the dev server, and
the tablet was paying the per-module request waterfall over Wi-Fi — the exact root cause
this PR claims to fix and measured as the dominant cold-load cost.

**Impact on earlier results.** Any tablet measurement taken while launchd was installed may
have been measuring the dev server, not the fix. Worth re-running the tablet load check.

### Check A — is auto-startup even installed?

```bash
ls -la ~/Library/LaunchAgents/com.marketrewind.* 2>/dev/null
./tools/mac/status-services.sh
```

`status-services.sh` now prints a **Serving:** line. Before the fix that line does not
exist, so on the old code use this instead:

```bash
curl -s http://127.0.0.1:3000/ | grep -c '@vite/client'
```

- `1` → dev server (the bug; slow tablet loads)
- `0` → bundled production build (correct)

### Check B — apply the fix and confirm

The plists are generated files, so **`install-startup.sh` must be re-run** for this to take
effect. Re-running it rewrites both plists and reloads the agents.

```bash
./tools/mac/uninstall-startup.sh     # optional: start clean
./tools/mac/install-startup.sh
sleep 15                             # the first launch now builds the bundle
./tools/mac/status-services.sh
```

**Expected:** `Serving: PRODUCTION bundle (/assets/index-*.js)`.

**Expected timing:** first launch is slower than before, because it now runs `vite build`
before serving (~10s here; the M4 should be faster). Subsequent relaunches only rebuild
when the agent restarts. This is the deliberate trade: correctness of what is served over
speed of coming up.

**Watch for:**
- A respawn loop. A failing build exits 1 and launchd retries on its default 10s
  `ThrottleInterval`. If you see the build log filling with repeated failures, that is
  the failure mode — check `~/Library/Logs/MarketRewind/frontend.build.log`.
- `KeepAlive` interaction: if you manually run `./tools/mac/start-frontend.sh --foreground`
  while launchd holds the port, the script kills the occupant and rebinds, then launchd
  re-takes it. It converges, but it is worth knowing if it looks like a fight.

**Rollback:** `./tools/mac/uninstall-startup.sh`, or re-point the plist at `vite.js`.

### Check C — the tablet, over the real network

From the tablet, with the fix in place:

```bash
# on the Mac
./tools/mac/status-services.sh
```

Then load from the tablet and confirm the cold load is still ~1–2s **and** that the
served asset is a hashed `/assets/index-*.js`. If the tablet got slower here rather than
faster, that is important — tell me.

---

## 1b. Per-frame chart invalidation (`a1c6023`) — perf run 1, the main event

**This is the most likely candidate for the missing CPU**, and it is newer code than the
69% measurement it is being judged against (`main`'s bid/ask work, merged at `4c84258`).

Two unconditional things ran on every animation frame for the whole replay:

1. **`updateBidAskPriceLines()` pushed a value into `applyOptions()` on every call.** That
   marks the chart dirty and schedules a repaint whether or not the price changed. At 25×
   with 12 charts: ~24 invalidations/frame, **1,440/second**, for the entire replay.
   Measured over one full replay: **1,351,032 → 469,512 calls, −65%** (881,520 needless
   invalidations removed). Each line now caches the last price it pushed.
2. **`advanceSimulationTime()` rebuilt and republished `latestTickBySymbol` every frame**,
   so identity-keyed subscribers re-rendered 2.9× more often than there was new data.
   Now only republished when a tick actually elapses: **100% of frames → 35%**, matching
   the real tick rate.

### Check D — does this move the CPU?

Same 25× replay, **12-chart grid if you can**, `git checkout a1c6023` vs `7bd01d6`:

| | CPU avg | CPU peak | GPU avg | GPU peak |
|---|---|---|---|---|
| before `7bd01d6` | | | | |
| after `a1c6023` | | | | |

The mechanism predicts CPU drops and GPU drops (fewer invalidations → fewer repaints).
**If CPU is still flat here, that is the most informative result you can give me** — it
would mean the core is going somewhere I have not looked, and I would rather know that
than keep stacking fixes.

Also please note the **chart count** and whether any charts were off-screen or in an
inactive tab. If off-screen charts keep processing, that is my next target and it would
explain a flat reading here.

---

## 2. The 1D bucket index — needs a hardware A/B

**What changed** (`88468a0`). The 1D branch of `useChartLifecycle` rescanned all of
`masterData` **once per elapsed tick**, recomputing tick-invariant facts (symbol filter,
RTH classification, ISO string parse, bucket derivation) every time. It is now a map
lookup against an index built once per session load.

Measured here, best-of-5 with the real helpers, 16.67 ms = one 60fps frame:

| bars × ticks/frame | before | after | speedup | index build |
|---|---|---|---|---|
| 5000 × 50 | **190.61 ms** (1143% of budget) | 0.09 ms | ~2200× | 4.3 ms once |
| 2000 × 50 | **76.26 ms** (457%) | 0.09 ms | ~860× | 1.7 ms once |
| 960 × 50 | **36.55 ms** (219%) | 0.08 ms | ~460× | 0.8 ms once |
| 390 × 50 | **14.73 ms** (88%) | 0.06 ms | ~230× | 0.3 ms once |

There is a correctness oracle (`tests/unit/dailyIndex.test.ts`, 24 tests) that runs the new
index and the **original nested loop** over identical input and asserts equal output,
including at the partial-bar boundary second by second. That part I trust.

### The important question for you

**This fix only affects `timeframe === '1D'`.**

The previous Mac A/B measured CPU flat at 69.3% → 69.0%. **If that run was on a 1-minute
or 5-minute chart, the 1D fix cannot possibly show up there** — and that would explain the
flat number independently of anything else.

So please A/B **both** timeframes and tell me which was which:

| Run | Timeframe | Replay speed | Symbol | Bars loaded | CPU avg | CPU peak | GPU avg | GPU peak |
|---|---|---|---|---|---|---|---|---|
| baseline `9e08148` | **1D** | 25× | | | | | | |
| fix `a29f632` | **1D** | 25× | | | | | | |
| baseline `9e08148` | **1m or 5m** | 25× | | | | | | |
| fix `a29f632` | **1m or 5m** | 25× | | | | | | |

Keep everything else identical to the earlier run (M4, 25× replay, TSLA, 19,563 ticks) so
the numbers are comparable. Earlier baseline for reference: GPU avg **51.4% → 45.2%**,
peak **68.0% → 51.0%**, CPU avg **69.3% → 69.0%**, system CPU 30.0% → 31.9%.

**If the 1D row still shows flat CPU, that is a finding, not a failure** — it would mean
the loop is not on the critical path for your data shape and I should stop optimising it
and look elsewhere. Please do not tune the test to make it move.

### Also worth capturing

- **How many charts in the grid during the run.** If it was a multi-chart layout, I have a
  specific follow-up: whether off-screen or inactive charts keep processing ticks and
  repainting. Please note the grid layout.
- **Display scaling / `devicePixelRatio`** (`system_profiler SPDisplaysDataType | grep -i resolution`
  or just the Scaled setting in Displays). The GPU is still at ~45% average after the blur
  fix, and canvas fill cost scales with DPR². This is the most likely remaining GPU lever,
  but it is a visual-quality trade, so I want the number before proposing it.

---

## 3. Re-run the mechanism checks (should still pass)

```bash
./tools/mac/benchmark.sh
```

Expected: **9 PASS, 0 FAIL, exit 0**. This covers the boot path (`names_only`) and wire
compression, which are unchanged by this round but sit in the same PR.

---

## 4. What to send back

You can paste this template back filled in — that is genuinely all I need. Leave a cell
**blank** if you could not measure it; blank is fine, guessed is not.

```
### Machine
Mac model / chip:            M4?
  display + DPR:             (e.g. 3024x1964 scaled, DPR 2)
  Chrome version:
  Instrument used for CPU%:  (whatever produced the earlier numbers)
  Instrument used for GPU%:

### Run 6 — auto-start (do this FIRST, it changes how much the rest matters)
Plists present before Check B?   yes / no
Serving line before fix:         PRODUCTION / DEV / n/a
Serving line after Check B:      PRODUCTION / DEV
First-launch time after fix:     ___ s   (it now builds before serving)
Any respawn loop?                yes / no
frontend.build.log errors:       none / (paste)

### Run 1 — fix A/B          25x, 12 charts, tf: ____
                    CPU avg   CPU peak   GPU avg   GPU peak   FPS   dropped
7bd01d6 (#1)        ______    ______     ______    ______     ___   ______
de7eb03 (#2)        ______    ______     ______    ______     ___   ______

Chart count actually used:       ____
Any charts off-screen/inactive:  yes / no

### Run 2 — chart scaling     25x, de7eb03, tf: ____
charts   CPU avg   CPU peak   GPU avg   GPU peak   FPS
1        ______    ______     ______    ______     ___
2        ______    ______     ______    ______     ___
4        ______    ______     ______    ______     ___
12       ______    ______     ______    ______     ___

### Run 3 — speed scaling     12 charts, de7eb03, tf: ____
speed    CPU avg   CPU peak   GPU avg   GPU peak   FPS
1x       ______    ______     ______    ______     ___
5x       ______    ______     ______    ______     ___
25x      ______    ______     ______    ______     ___

### Run 4 — DPR               25x, 12 charts, de7eb03
DPR      CPU avg   GPU avg   GPU peak   FPS   dropped
1        ______    ______    ______     ___   ______
native   ______    ______    ______     ___   ______

(If native is not 2, tell me what it is.)

### Run 5 — timeframe         25x, de7eb03
tf       CPU avg   CPU peak   GPU avg   GPU peak   FPS
1D       ______    ______     ______    ______     ___
1m       ______    ______     ______    ______     ___

**Critical question:** the original 69.3% -> 69.0% measurement — which timeframe was that
taken on?   1D / 1m / 5m / other: ____

### Run 7 — benchmark.sh
Result:      9 PASS / 0 FAIL?   yes / no
Raw tail:    (paste)

### Anything else
Visual regressions (bid/ask lines, tape, price lines):  none / (describe)
Anything that looked or felt wrong:  (describe)
```

**Please send failures raw, not cleaned up.** A half-filled template with a
"this didn't move" note is more useful to me than a tidy summary that rounds off the
interesting part. If something looks wrong, tell me rather than investigating it first.

---

## What I will do with the numbers

So you know it is going somewhere:

- **Run 2 linear →** implement chart-visibility culling (skip tick processing and repaints
  for charts not in the viewport). That would dwarf the rest of this PR.
- **Run 2 flat →** stop looking at per-chart cost; the remaining cost is global.
- **Run 3 flat across speeds →** confirm the frame-bound theory; keep reducing per-frame work.
- **Run 3 scaling with speed →** I have been optimising the wrong term; switch to per-tick.
- **Run 1 still flat →** the invalidation fix is not the CPU. That would be the most useful
  negative result available, and it sends me to a profiler rather than more guessing.
- **Run 4 shows a large DPR delta →** bring you a Performance Mode proposal with the trade
  quantified, for you to decide rather than me.
- **Run 5 confirms 1D is not your workload →** the 1D index stays as correctness-neutral
  insurance and I stop counting it as a CPU win.

---

## What I could not verify here

- **`launchd` behaviour.** No macOS in this environment. The plist change is verified only
  by `bash -n` and by reading it — Check B is the real test.
- **Real hardware perf.** All the 1D numbers above are isolated loop measurements in Node,
  not your M4 with your lake and your GPU. They establish that the work was being done, not
  that removing it moves your frame pacing.
- **The tablet path.** No LAN, no device here.

## Not in this round (parked, with reasons)

- **Per-tick `series.update()` coalescing.** Real CPU, but the third-party claim that it
  causes "~200 canvas repaints per frame" is wrong — Lightweight Charts merges
  invalidations and paints at most once per chart per animation frame
  (`_private__invalidateHandler` / `_private__drawPlanned`,
  `lightweight-charts.development.mjs:11501`). Worth doing for the CPU, not for draw calls.
- **DPR cap / "Performance Mode".** Plausible and probably the biggest remaining GPU lever,
  but unmeasured and a visual trade. Waiting on the DPR number above.
- **Web Worker offload.** Premature until the cheap measured fixes are re-measured.
- **Build-time pre-compression.** Only helps the local `vite preview` path; Vercel already
  compresses in production. Built output is 463 kB → 143 kB gzip, CSS 12.83 kB → 2.96 kB.
