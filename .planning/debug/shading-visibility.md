---
status: resolved
trigger: user_report
---

# Debug Session: shading-visibility

## Symptoms
- Pre-market and post-market background shading is too light.
- Volume profile shading for pre/post-market is too light.
- Needs to be made darker for better visibility.

## Current Focus
- **Hypothesis**: The colors are defined as constants or in a theme file with low opacity/light colors.
- **Next Action**: Search for "pre-market", "post-market", "shading", or "volume profile" in the codebase to find color definitions.

## Evidence
- Found color definitions in `src/lib/SessionShading.ts` (opacity 0.07) and `src/lib/VolumeProfilePlugin.ts` (opacity 0.25).

## Resolution
- **Root Cause**: Low alpha values in RGBA color definitions for session shading and volume profile.
- **Fix**: Increased alpha values in `src/lib/SessionShading.ts` (from 0.07 to 0.15 for pre/post market) and `src/lib/VolumeProfilePlugin.ts` (from 0.25 to 0.35 for standard bins).
