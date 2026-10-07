# Review request — local Mac agent

**Branch:** `arena/bbbe0bc6-market-rewind` · **PR:** [#4](https://github.com/emadprograms/market-rewind/pull/4)
**Current head:** `de7eb03`

Please review and verify on real hardware. Everything below is either something I could
not test in the sandbox (macOS `launchd`, real GPU, real tick lake) or something where my
measurement says one thing and your machine may say another.

---

# Round 4 — FOUND IT. Please re-run the same diagnostic.

Your paint-flashing test was the one that cracked this. Thank you — it was decisive.

## What it was

All six chart plugins implemented the LWC primitive hook as:

```js
updateAllViews() { this._requestUpdate(); }
```

`updateAllViews()` is a notification **from** Lightweight Charts, not a request to it. LWC calls it **from inside its own draw path**:

```
drawImpl → updateGui → syncGuiWithModel → adjustSizeImpl
         → model._internal_setWidth() → _internal_updateAllSources()
         → primitive.updateAllViews()
```

`requestUpdate` resolves to `model._internal_fullUpdate()` → `invalidate(InvalidateMask.full())`. So **asking for a redraw from inside a redraw** schedules another draw, which calls `updateAllViews()` again. The chart repaints itself forever at display refresh rate — which is exactly the 75 Hz you measured, and exactly why it happened while paused.

Reproduced deterministically here by driving LWC's rAF queue by hand, real `lightweight-charts`:

| | rAF requested per frame |
|---|---|
| looping primitive | `1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1` — never stops (197 `updateAllViews` calls / 15 frames) |
| no-op primitive | `1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0` |
| no primitive | `1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0` |

And confirmed against the real plugins: reverting `SessionShading.ts` **alone** makes the "all six real plugins settle when idle" test fail with `expected [1,1,1,1,1] to deeply equal [0,0,0,0,0]`. One plugin is enough to pin an entire chart at continuous 100% repaint.

**Why this survived my previous fix:** `f6c016a` fixed two of the six plugins. All six attach to every chart, and `SessionShadingPlugin` was one of the four I missed — so the loop was still there the whole time you were measuring. That is my error, and it lines up exactly with your numbers: 4 charts, every canvas, every frame, paused.

## What I need: re-run the round 3 test — 2 minutes

On `6ca62c7`, 4-chart layout, hydrated, **paused**:

1. **Paint flashing → is there still any flashing?** Expect none.
2. **Chrome CPU / GPU% and M4 GPU% while paused**, same instruments as before.

| | before (your round 3) | now — please fill in |
|---|---|---|
| Tab (Renderer) | 18.4% | |
| GPU Process | 38.5% | |
| Total Chrome CPU | 56.9% | |
| M4 GPU Device Util | 80.3% | |

**Predicted:** flashing gone, GPU process collapses toward a few percent, M4 GPU back to roughly an idle compositor. If the GPU process drops but the **Tab** renderer stays high, there is a *second*, separate cost and I want to know — that would be the first thing I have not yet explained.

**If it still flashes**, that is important and I would like a 5-second paused Performance recording; it would mean a seventh invalidation source exists that I have not found.

## One honest correction to my last message

I said the loop was "not self-sustaining" and based that on checking the `autoScale` flag, which is only set on pane creation. That reasoning was wrong: the re-arming happens through `adjustSizeImpl` → `_internal_setWidth` → `_internal_updateAllSources`, which runs on every full invalidation and reaches the primitive unconditionally. The disproof above is the correction.

---

# Round 3 — one diagnostic, and an honest correction

Round 2 settled the important things. Production confirmed (`/assets/index-*.js`, `@vite/client` count 0),
so **the 65% CPU is real production CPU** — the dev-build theory is dead. The launchd rewrite in
`e6d1975` is verified working (`Serving: PRODUCTION bundle`, zero errors, respawn loop gone). Thank you.

**And your paused/playing table is the most valuable thing in the report**, because it isolates the
remaining cost precisely: **54.9% Chrome CPU and 40.8% M4 GPU while completely paused**, with playback
adding only +16.2% JS. A *static* page should cost approximately nothing. That is an anomaly, not a
budget, and it is now the only thing I want to chase.

## Correction: I chased it and my first answer was wrong

I found that both plugins implemented the LWC primitive hook as `updateAllViews() { this._requestUpdate(); }`.
Since LWC calls that hook *from inside its draw path*, and `requestUpdate` resolves to
`model._internal_fullUpdate()` → `invalidate(InvalidateMask.full())`, I thought I had an infinite repaint
loop and it explained your paused GPU exactly.

**Reading the LWC source disproved it.** `autoScale` is only ever set in an InvalidateMask on *pane
creation* (`lightweight-charts.development.mjs:7599`); a plain `full()` leaves the per-pane flag
`undefined`, so `_private__applyMomentaryAutoScale` never re-arms. The loop is not self-sustaining.

The hook was still wrong for a smaller reason — it escalated a *light* invalidation into a **full** one
(including `_private__updateGui()`: time axis, price-axis widgets, layout width) on every price-scale
recalculation. Fixed in `f6c016a`, with a regression test. **But that is a bounded efficiency fix, not
the explanation for the paused floor.** I did not ship it as a fix for the thing it does not fix.

One more thing worth knowing: `tests/unit/TradePlugin.test.ts` had a test named *"triggers update callback
when updateAllViews() is called"* — it was asserting the bug as intended behaviour. Corrected.

## The ONE test I need — 2 minutes, no code changes

**Chrome DevTools → open the three-dot menu → More tools → Rendering → tick "Paint flashing".**

Then: load the 4-chart layout, let it hydrate, **press pause**, and just watch for 20 seconds.

| what you see | what it means | what I do next |
|---|---|---|
| Chart areas **flash continuously** while paused | Something invalidates a chart every frame. The bug is ours and it is findable. | Hunt the invalidation source with the Performance panel; I have three candidates already (the 250 ms per-chart interval, the unguarded `ResizeObserver` → `applyOptions({width,height})`, and a price-scale recalculation path). |
| **No flashing** while paused, but GPU still ~40% | Nothing is repainting. The cost is **compositing/rasterisation**, not our code. | Stop looking at JS entirely; it becomes a CSS/layer/canvas-compositing question, and I will say so rather than keep patching. |
| Flashing **only while playing** | Expected and benign. | Nothing to do. |

If it does flash, a **Performance panel recording (~5 s, paused)** would let me finish this myself —
the flame chart names the function driving the invalidations. Feel free to send the raw JSON export
instead of a screenshot if that is easier.

### Two optional tie-breakers if the flashing result is ambiguous

1. **Same test in Safari** with the app paused. If Safari sits idle and Chrome does not, it is a
   Chrome compositing path rather than anything in our code.
2. **GPU% with the session-card removed**: in Elements, select `.session-card` (it carries the one
   remaining `backdrop-filter: blur(20px)` over a large area) and delete it, then watch GPU%.
   If the number collapses, the blur is the cost and I will remove it the same way as the others.

## Everything else from round 1 and 2 is closed

- Perf runs 1–5: production build confirmed — no re-run needed.
- DPR: dropped, per your measurement.
- 1D index: kept as insurance, acknowledged as not a CPU lever.
- `benchmark.sh`: 9 PASS / 0 FAIL confirmed.
- launchd: verified fixed on your M4.

---

# Round 2 — revised plan (answered; kept for the record)

Round 1 answered three questions decisively. Thank you — the paused/speed/chart axes were exactly
what was needed, and two of my assumptions died in the process.

**What your data settled:**

- **DPR capping is dead.** Your Run 4 shows ~2% GPU difference for a real sharpness cost on M4.
  Not doing it. Good call recommending against it.
- **The 1D index is not a CPU lever.** Run 5: 44.1% vs 44.0% between 1D and 1m. It stays as
  correctness-neutral insurance (it removes a genuine O(ticks × bars) blow-up that would bite on
  larger datasets), but I will stop counting it as a win.
- **The invalidation fix was real and is confirmed**: GPU peak 84% → 40% (4 charts), 66% → 35%
  (2v). That is a large, unambiguous win and I am not going to talk it down.

**Two corrections I owe you, one of them to your own conclusion:**

- **Chart-visibility culling is not the lever — I do not want you to build it.** The UI caps at 4
  charts and all 4 were visible on your 1440×900 viewport, so there is nothing off-screen to cull.
  Linear scaling in chart count means *per-chart per-frame work* is the cost, which is a different
  problem: reduce the work each chart does, not skip charts.
- **Run 5 answered the question that mattered most**: the 69.3% → 69.0% baseline was the default
  2v grid running 5m *and* 1D together. So the 1D index was applicable to that measurement — it
  simply is not where the CPU is.

---

## Round 2, question 1 (do this first): were the perf runs on a production build?

**This may invalidate runs 1–5, and it is a 2-minute check.**

Run 6 reported `Serving: DEV` for the LaunchAgent *before* the fix. If runs 1–5 were measured
against that agent, or against `npm run dev`, then every number was taken on a **development
build** — unminified React and Lightweight Charts, with dev-mode assertions and prop checking
active. That bundle is routinely 2–5× slower in React reconciliation, and crucially it would
produce *exactly* the signature you measured:

- flat across replay speeds (dev-mode render overhead is per-frame, not per-tick), and
- linear in chart count (each chart's render/commit path is proportionally more expensive).

That signature has another explanation too — so this is the first thing to rule out.

### Check R1 — confirm what was actually served

```bash
./tools/mac/status-services.sh          # expect: Serving: PRODUCTION bundle
curl -s http://127.0.0.1:3000/ | grep -c '@vite/client'    # expect: 0
```

Then open the app and confirm in DevTools → Console:

```js
// React dev builds expose these; production builds do not.
typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined' &&
  document.querySelector('script[src*="/assets/"]') !== null
```

Simplest reliable tell: **View Source and look for `/assets/index-*.js` vs `src/main.tsx`.**

### Check R2 — if runs 1–5 were on a dev build, re-run the two headline comparisons

Apply the launchd fix first (section 1), which now serves production properly, then:

| run | config | CPU avg | CPU peak | GPU avg | GPU peak | FPS | dropped |
|---|---|---|---|---|---|---|---|
| 1 chart | `de7eb03`, production | | | | | | |
| 4 charts | `de7eb03`, production | | | | | | |

That single pair tells me whether the remaining CPU is real or a build artifact. **If 4 charts on
a production build comes in near ~40% instead of 65%, the performance work is essentially done**
and what is left is the per-frame architecture below.

---

## Round 2, question 2: isolate where the per-frame CPU actually is

If production-vs-dev is not the explanation, these two measurements pin it. Both are quick.

### Check R3 — paused vs playing (the decisive one)

Same 4-chart layout, loaded and hydrated, then **pause and let it sit for 30 seconds**:

| state | CPU avg | GPU avg | notes |
|---|---|---|---|
| 4 charts, **paused** | | | rAF loop stopped, no tick processing |
| 4 charts, **playing 25×** | | | |

- **Paused ≈ 0%** → the entire cost is in the playback loop. Then the per-frame work is
  `advanceSimulationTime` + subscribers + chart updates, and I will instrument those directly.
- **Paused ≈ 40%+** → the cost is not the playback loop at all. It would be chart rendering,
  an interval, or the websocket path — and I have been looking in the wrong place entirely.
- **Paused scales with chart count** (try 1 vs 4 paused) → per-chart static rendering/repaint cost.

### Check R4 — Chrome's own Task Manager, not `ps`

`ps -eo %cpu` sums an uneven set of Chrome processes and made the breakdown unknowable. Chrome
ships a better instrument: **Shift+Esc** in the browser window. Report the CPU column for:

| Process | CPU |
|---|---|
| Browser | |
| GPU Process | |
| Tab: Market Rewind (renderer) | |
| any Utility/other | |

The **GPU Process** line is the one that distinguishes "our JS is slow" from "the compositor is
rasterising constantly". Those have completely different fixes, and `ps` cannot tell them apart.

---

## Round 2, question 3: the launchd fix is rewritten — please retest

You were right, and my previous attempt was wrong. `/bin/bash` under launchd cannot reach a script
in `~/Documents`, so `a29f632` turned a working dev-server agent into a crash loop. That is a bug I
introduced and it is reverted in `e6d1975`.

The plist is back to **direct binary execution**, which is not subject to the shell restriction —
with the one token that was actually missing:

```xml
<string>${NODE_BIN}</string>
<string>${REPO_ROOT}/node_modules/vite/bin/vite.js</string>
<string>preview</string>
<string>--host</string>
<string>0.0.0.0</string>
<string>--port</string>
<string>${FRONTEND_PORT}</string>
```

Because the agent cannot build, the bundle is now built before the agent loads — `build_frontend()`
in `common.sh`, called by `install-startup.sh` (which **refuses to load the agent** if the build
fails) and by `start-services.sh` (so `restart-services.sh` picks up code changes).

```bash
./tools/mac/uninstall-startup.sh
./tools/mac/install-startup.sh      # builds, then loads; fails loudly if the build fails
./tools/mac/status-services.sh      # expect: Serving: PRODUCTION bundle (/assets/index-*.js)
```

**Watch for:** any respawn loop (that was the TCC symptom — `getcwd ... Operation not permitted`
in `~/Library/Logs/MarketRewind/frontend.error.log`), and whether a **stale bundle** is served
after you edit code without re-running an install/start script. That staleness is the one real
cost of this design, and I would rather hear about it than have you work around it.

**Note the trade:** `--dev` is no longer reachable through the agent. For dev-server work, unload
the agent and run `./tools/mac/start-frontend.sh --dev` directly. Tell me if you would rather have
a plist that reads a mode file, and I will build that instead.

---

## Round 1 findings I am acting on (for the record)

- **Run 2 (linear in charts) + Run 3 (flat across speeds)** = the cost is per-frame and per-chart,
  and tick volume is nearly free. That redirects the whole effort away from tick processing.
- **The GPU peak reduction is the confirmed win of this round.** 84% → 40% is a real, large,
  reproducible improvement, and it came from a 65% cut in `applyOptions()` calls.

---

# Appendix — round 1 matrix (COMPLETED, do not re-run)

Everything from here down was the round 1 request. **You already ran it** — it is kept only so the
round-2 checks above can refer back to specific runs and tables. The only parts still live are:

- **section 1** (auto-start) — superseded by Round 2, question 3 above, which has the corrected fix.
- **section 3** (`benchmark.sh`) — still worth re-running if you have a moment.
- **section 4** report template — reuse it for the round-2 checks if that is easier than prose.

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

Revised after round 1 — see the Round 2 section at the top for what is current.

- **Production build is the explanation →** the remaining CPU is largely a build artifact; the
  perf work is effectively complete and I move to the architectural items below.
- **Check R3 paused ≈ 0% →** instrument the playback loop directly (per-frame timing around
  `advanceSimulationTime`, the subscribers, and each chart's update path) and fix what the
  numbers point at.
- **Check R3 paused is high →** I have been looking in the wrong place; go to the compositor /
  websocket / interval paths and start over with evidence.
- **Check R4 GPU Process dominates →** the fix is in what we invalidate and how often, not in JS.
- **Chart count still linear on a production build →** attack per-chart per-frame work. Note this
  is *not* culling: the UI caps at 4 charts and all were visible, so there is nothing off-screen
  to skip. The target is making each chart's per-frame work cheaper.
- **Run 1 still flat, all checks clean →** go to a profiler rather than ship another speculative
  fix. I would rather tell you "I do not know yet" than stack a fourth guess.

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
