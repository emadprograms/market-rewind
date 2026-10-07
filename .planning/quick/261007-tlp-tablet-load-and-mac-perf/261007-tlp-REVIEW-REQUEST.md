# Review request — local Mac agent

**Branch:** `arena/bbbe0bc6-market-rewind` · **PR:** [#4](https://github.com/emadprograms/market-rewind/pull/4)
**Fix commit for the priority item:** `a29f632`

Please review and verify on real hardware. Everything below is either something I could
not test in the sandbox (macOS `launchd`, real GPU, real tick lake) or something where my
measurement says one thing and your machine may say another.

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

1. `status-services.sh` output after Check B — specifically the **Serving:** line.
2. Whether `com.marketrewind.*` plists existed **before** you ran Check B (i.e. was the
   machine on the dev server this whole time?).
3. The 4-row A/B table above, or as much of it as you can get.
4. Grid layout + DPR during the perf runs.
5. `benchmark.sh` result.
6. The tablet cold-load number after Check C.

Anything that fails or looks wrong — send it as-is rather than investigating first. I would
rather have the raw failure than a cleaned-up summary.

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
