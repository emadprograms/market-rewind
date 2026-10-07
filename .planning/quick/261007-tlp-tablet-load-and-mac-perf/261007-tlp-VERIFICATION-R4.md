# Round 4 verification — the paused repaint loop is gone (hardware-confirmed)

**Fix:** `6ca62c7` (`arena/bbbe0bc6-market-rewind`) · **Verified head:** `9710b08`
**Hardware:** Apple Silicon M4, Chrome, 4 hydrated charts, TSLA 2026-09-08, paint flashing ON
**Method:** `IOAccelerator` counters + Chrome process breakdown, 20 s paused / 20 s playing at 25×

This closes the paused-state anomaly. It was a prediction-then-measurement result: the
prediction written before the run was *"flashing gone, GPU process collapses toward a few
percent, M4 GPU near idle"*, and that is the branch the measurement landed on.

## Build provenance (checked before measuring)

```
HEAD:            9710b08
bundle:          dist/assets/index-CMw0wGVn.js
no-op plugins:   5
cache-drop:      1
BUGGY remaining: 0
```

5 + 1 = all six primitives, 0 buggy. `dist/` is gitignored, so the agent rebuilt via
`tools/mac/start-services.sh` before measuring; the bundle hash differs from the sandbox
build (`index-BbXSU_UC.js`), which reflects different dependency resolution on the two
machines. The grep markers are what establish that the fix is in the served artifact.

## Result

| Metric (PAUSED, 20 s) | Before — `e400755` | After — `9710b08` | |
|---|---|---|---|
| Paint flashing | **solid neon green, all 4 charts** | **zero pixels** | loop gone |
| GPU Process CPU | 38.5% | **5.5%** (floor 0.9%) | −85.7% |
| Total Chrome CPU | 56.9% | **14.3%** (floor 2.6%) | −74.9% |
| Tab (Renderer) CPU | 18.4% | **6.1%** (floor 1.7%) | −66.8% |
| M4 GPU Device Util | 80.3% | **28.4%** (floor 5.0%) | −64.6% |

| Metric (PLAYING 25×, 20 s) | Before | After | |
|---|---|---|---|
| Total Chrome CPU | 67.6% | 45.1% | −33.3% |
| Tab (Renderer) CPU | 33.3% | 26.4% | |
| GPU Process CPU | 33.9% | 18.0% | |
| M4 GPU Device Util | 35.9% | 45.2% | confounded, see below |
| Dropped frames / FPS | 20–21 @ 74 | 21 @ 74 | unchanged |

## Two caveats, stated rather than smoothed over

1. **M4 GPU device-util numbers are not comparable across rounds.** The "before" paused
   figure (80.3%) was measured *with paint flashing on*, and the flashing overlay is itself
   GPU work — DevTools is drawing a green rectangle over every repaint. The same is true of
   the 28.4% "after". The unpolluted number is the **floor: 5.0%**, which is the compositor
   at rest. That is why the CPU figures (GPU Process 38.5% → 5.5%) and the flashing result
   carry the verdict, not the GPU%.
2. **The paused peaks are not explained by the measurement window.** Average 28.4% GPU with
   a 61.0% peak over a 20 s paused window means something happened during that window —
   almost certainly chart hydration and tile loading at the start, since the floors are
   0.9 / 2.6 / 5.0. This does not affect the verdict (a permanent loop cannot produce a
   0.9% floor), but if a *sustained* spike is ever seen on an already-idle page it would be
   worth a profile.

## What this reframes

The loop was running *during playback too*. So the previously-reported "+16.2% JS over
idle" was measured against an inflated baseline. Playback is now the dominant remaining
cost — roughly **+30.8 points** of Chrome CPU over idle (14.3% → 45.1%) — not the ~16
implied earlier. At 25× with 4 charts that is 4 canvases repainting at 74 Hz; 21 dropped
frames out of ~1,480 is 1.4%.

## Regression guard added

`tests/unit/primitiveUpdateContract.test.ts` now ends with an **enumeration guard**: it
scans `src/` for `implements ISeriesPrimitive<` and fails if the set is not exactly the six
covered plugins. The original fix failed because it covered 2 of 6; every list in that file
is hand-written, so a seventh plugin would otherwise reopen the bug silently — the
behavioural test would still pass, because it only attaches the six it knows about.

Non-vacuity confirmed: adding a fake seventh plugin to `src/lib/` fails the guard with
`expected [ 'BoundaryLinePlugin', …(6) ] to deeply equal [ 'BoundaryLinePlugin', …(5) ]`,
and removing it restores green. Suite: **93 files, 538 passed, 2 skipped**; `tsc --noEmit` clean.
