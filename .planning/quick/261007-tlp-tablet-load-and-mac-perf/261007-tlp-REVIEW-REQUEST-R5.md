# Round 5 — correctness of the fix, not more speed

**Head:** `8c0ab6e` · **PR:** [#4](https://github.com/emadprograms/market-rewind/pull/4)

Round 4 settled the performance question: the repaint loop was the paused floor, and it is
gone. **I do not need those numbers again.** What I want now is the one thing I have *not*
measured — whether removing that repaint request broke anything visually. I changed six
render paths; on hardware we have only confirmed they no longer paint *too much*. Nobody has
checked the opposite: that they still paint when they should.

This matters because this is the second time I have reasoned my way to a conclusion in this
exact code and been wrong. Every user-driven change does route through a setter that
requests a repaint (checked statically), but I would rather have it observed than argued.

## Run 1 — interaction pass, paint flashing OFF (5 minutes)

Hydrated, 4 charts, **paused**. Watch the drawings, not the meters. Nothing needs measuring.

**Does the drawing tool still work live?**

1. Select a chart, press **`J`** (ray mode), then click somewhere in the price area.
   A horizontal ray should appear **immediately** on click.
2. Press **`Shift+R`** (rectangle mode), then click twice to place two corners.
   A rectangle should appear. **Between the first and second click**, move the mouse
   around — a ghost rectangle should follow the cursor **live**, without lag or stutter.
3. Double-click exactly on an existing ray (within ~10px vertically) — it should disappear.
4. Pan and zoom while drawings are on screen — every drawing must stay glued to its price
   and time, no drifting, no lagging one frame behind.

**Do the always-on overlays still update?**

5. Session shading: switch timeframe (e.g. 1H → 5m → 1D). The shaded session bands must
   redraw correctly for the new range. This plugin is the one that had a *cache* of
   coordinates, so it is the most likely to still hold stale geometry — this is the single
   most important check in this run.
6. Volume profile: should be present and redraw correctly after the timeframe switch too.
7. Press **`Shift+E`** — ETH overlay on/off should still work.

**Failure signatures — these are what I care about:**

- A drawing that only appears after you move the mouse, pan, or zoom (i.e. it waits for some
  *other* event to trigger a repaint).
- The ghost rectangle lagging behind the cursor, or not appearing at all.
- Session shading bands offset, stale, or absent after a timeframe switch.
- Drawings drifting out of alignment after pan/zoom.

## Run 2 — 5-minute idle soak (walk away, come back)

Why: the loop is fixed, but I want to know nothing *re-arms* it over time. A 20-second test
cannot see that — the 250 ms chart interval and the network polling are still running in the
background. Also, the loop allocated per frame, so if something now leaks it would have been
masked before.

Leave the page hydrated, 4 charts, **paused**, untouched, for **5 minutes**. Then:

- Chrome Task Manager → **CPU** for the tab and the GPU process. Should still be at the
  idle floor, not crept upward.
- Chrome Task Manager → **Memory footprint** for the tab. Compare the value at the start and
  the end. A gentle rise is normal; a large climb means a leak.
- Anything flash on screen during the 5 minutes? (`Esc` clears the paint-flashing overlay
  state; if the page visibly flickers or the fans spin up, say so.)

## Run 3 — tablet, only if you actually use it

No tooling, no numbers needed. The loop would have been running on the tablet too, so the
fix should mean it no longer warms up or drains while sitting idle on a loaded page.

- Leave it on the hydrated page, paused, for 10 minutes on battery.
- Does the back of the device **still get warm**? Did it get warm before this fix?
- Battery percentage before and after.
- Everything above still works (drawings, playback, timeframe switching).

Skip this entirely if the tablet is not part of your daily use — the Mac result already
answers the performance question.

## What I am NOT asking for

- **No more CPU/GPU measurements.** The round-4 numbers are the answer; re-measuring adds
  nothing.
- **No more paint-flashing runs.** Settled.
- **Nothing about merging.** PR #4 stays open. A merge decision is separate and is the
  human's call.

## Report back — blanks fine, guesses not

```
HEAD: ____

RUN 1 — interaction (paint flashing OFF)
  ray appears immediately on click?          yes/no: ____
  ghost rectangle follows cursor live?       yes/no: ____
  rectangle completes correctly?             yes/no: ____
  double-click deletes a ray?                yes/no: ____
  drawings stay glued through pan/zoom?      yes/no: ____
  session shading correct after timeframe switch? yes/no: ____
  volume profile correct after switch?       yes/no: ____
  Shift+E ETH toggle works?                  yes/no: ____
  ANY glitch seen (describe):                ____

RUN 2 — 5-minute idle soak
  tab CPU % at start / end:                  ____ / ____
  GPU process CPU % at start / end:          ____ / ____
  tab memory footprint at start / end:       ____ / ____
  anything flash or flicker?                 yes/no: ____

RUN 3 — tablet (only if used; otherwise write "skipped")
  gets warm while idle?                      yes/no: ____
  battery before / after:                    ____ / ____
  worked normally?                           yes/no: ____
```

If Run 1 turns up a glitch, that is the most valuable thing you could send me — describe
what you did, what you expected, and what you saw instead. Do not summarise it away.
