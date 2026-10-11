# Round 5 verification — the fix is correct, not just fast (hardware-confirmed)

**Verified head:** `0ee45cf` · **Fix:** `6ca62c7` · **Branch:** `arena/bbbe0bc6-market-rewind`
**Hardware:** Apple Silicon M4, Chrome, 4 hydrated charts, TSLA 2026-09-08

Round 4 answered "does it still burn CPU?" Round 5 answered the opposite question, which
nothing had tested: **does anything that should paint still paint?** Six render paths lost a
repaint request; that fixed the loop, but it could equally have left a drawing that only
appears when some *other* event forces a redraw.

## Provenance note

Between the head verified in round 4 (`9710b08`) and this one (`0ee45cf`) **no `src/` file
changed** — the diff is two review-request documents, one verification record, and the
enumeration-guard test. Round 5 therefore measured behaviourally identical code to round 4.

## Run 1 — interaction pass (paint flashing OFF)

| Check | Result |
|---|---|
| Horizontal ray appears immediately on click (`J`) | yes |
| Ghost rectangle tracks the cursor live, zero lag (`Shift+R`) | yes |
| Rectangle completes cleanly on second click | yes |
| Double-click within ~10px deletes a ray | yes |
| Drawings glued to price/time through pan and zoom | yes |
| Session shading correct after 5m → 1H → 1D → 5m | yes — no ghosting, no stale coordinates, no offset |
| Volume profile renders correctly | yes |
| `Shift+E` ETH toggle updates bands and candles | yes |
| **Any glitch** | **none** |

The session-shading check was the one I flagged as most at risk: it is the only plugin that
cached coordinates projected against a previous viewport, so it was the most likely to hold
stale geometry. It redraws correctly across repeated timeframe changes.

This also confirms the static reading was right: every user-driven change routes through a
setter that requests its own repaint — including the ghost rectangle, which
`useChartLifecycle.ts:452` pushes via `setRects()` on every mousemove. The live drag feedback
never depended on the perpetual repaint.

## Run 2 — 5-minute idle soak (300 s, untouched)

| | start | end |
|---|---|---|
| Tab (Renderer) CPU | 20.8% | **0.3%** (periods at 0.0%) |
| GPU Process CPU | 19.5% | **0.0%** |
| Memory footprint | 542.7 MB | 278.9 MB (−263.8 MB reclaimed) |

**Nothing re-armed.** No flicker over five minutes; the loop is permanently gone.

Two things this settles beyond the original question:

- **The elevated start values are hydration, not residue.** 20.8% / 19.5% at t=0 collapsing
  to 0.3% / 0.0% is the tile-and-candle load finishing. This is also the explanation offered
  in round 4 for the unexplained paused *peaks* (61.0% GPU over a 20 s window) — now seen
  directly: they are the front of the curve, not a residual cost. That closes the last
  caveat from round 4.
- **The 250 ms chart interval is free.** It is still running every 250 ms across four charts
  and the floor is 0.0–0.3%, which exonerates it empirically rather than by argument. It was
  originally suspected and previously cleared only by reasoning.
- **No leak.** Memory fell by 48% rather than creeping up. The loop allocated per frame, so a
  leak would have been masked by it; this is the first run where that could be observed.

## Run 3 — tablet

Skipped (tablet not in daily use). The tablet shares the same bundle, and the loop was a
JavaScript-level defect, so the Mac result carries it; tablet idle warmth remains the one
thing not directly measured.

## Where this leaves the performance work

| | before the fix | after |
|---|---|---|
| Idle CPU, paused 4 charts, 5 min | 56.9% Chrome (38.5% GPU process), repainting every canvas every frame | **0.3% / 0.0%** |
| Idle behaviour | permanent repaint at display refresh rate | fully settled |

The paused floor was the loop — diagnosed, fixed, and now verified in both directions: it
stopped burning CPU it should not, and it still paints when the user asks it to.

The only remaining cost is **playback**, ~+30.8 points of Chrome CPU over idle at 25× with
4 charts (45.1%), with ~1.4% dropped frames at 74 FPS. That is genuine render work for
moving data. Reducing it means decoupling chart repaint rate from tick rate at a visible
smoothness cost — a product decision, not a defect.

## Verification loop status

**Converged.** Six review rounds on hardware; every hypothesis that survived was reproduced
as a failing test before being called fixed, and the two that were wrong were corrected
explicitly (the `autoScale`-based "not self-sustaining" claim, and the 2-of-6 plugin fix).
Nothing further is queued for review.
