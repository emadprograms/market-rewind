---
phase: 01-viewport-stabilization
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tests/integration/viewport.test.ts
  - tests/hooks/useChartLifecycle.test.ts
  - src/hooks/useChartLifecycle.ts
autonomous: true
requirements: [STAB-01, STAB-02, STAB-03, STAB-04]
must_haves:
  truths:
    - "Ticker or timeframe changes occur without 'single candle' snaps"
    - "Infinite scroll data prepending preserves the visual anchor without viewport shifts"
    - "Viewport remains stationary during replay ticks unless the user is at the right edge (Auto-Reveal)"
    - "scrollToRealTime executes only after data is fully hydrated and the initialization lock is released"
  artifacts:
    - path: "src/hooks/useChartLifecycle.ts"
      provides: "Hydration locking and deterministic viewport control"
    - path: "tests/integration/viewport.test.ts"
      provides: "Integration tests for viewport stability"
    - path: "tests/hooks/useChartLifecycle.test.ts"
      provides: "Unit tests for hydration lock mechanism"
  key_links:
    - from: "src/hooks/useChartLifecycle.ts"
      to: "lightweight-charts API"
      via: "timeScale().scrollToRealTime() triggered by isHydrated state"
---

<objective>
Eliminate violent viewport jumps and ensure deterministic chart loading by replacing non-deterministic timers with a robust hydration lock and refining anchor logic.

Purpose: Resolve race conditions during data loading that cause "single candle snaps" and visual drift during infinite scroll.
Output: A stabilized viewport experience with verifiable test coverage.
</objective>

<execution_context>
@C:/Users/Emad/Documents/GitHub/market-rewind/.gemini/get-shit-done/workflows/execute-plan.md
@C:/Users/Emad/Documents/GitHub/market-rewind/.gemini/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/01-viewport-stabilization/01-RESEARCH.md
@.planning/phases/01-viewport-stabilization/01-VALIDATION.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Stability Test Scaffolding</name>
  <files>tests/integration/viewport.test.ts, tests/hooks/useChartLifecycle.test.ts</files>
  <action>
    Create the test files to provide a verifiable baseline.
    1. In `tests/hooks/useChartLifecycle.test.ts`, implement unit tests for the (yet to be created) `isHydrated` state transition.
    2. In `tests/integration/viewport.test.ts`, implement a mock for `lightweight-charts` to track calls to `setData` and `scrollToRealTime`.
    3. Create a test case that simulates a symbol change and asserts that `scrollToRealTime` is NOT called before the data is processed and a render cycle occurs.
    4. Ensure tests fail initially to prove they catch the race condition.
  </action>
  <verify>
    <automated>npm test tests/integration/viewport.test.ts tests/hooks/useChartLifecycle.test.ts</automated>
  </verify>
  <done>Test files created and failing as expected for STAB-01, STAB-02, STAB-03, and STAB-04.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement the Hydration Lock</name>
  <files>src/hooks/useChartLifecycle.ts</files>
  <behavior>
    - When ticker or timeframe changes, isHydrated must become false.
    - After setData is called and the browser renders the first frame, isHydrated must become true.
  </behavior>
  <action>
    Integrate a `HydrationState` (LOCK/UNLOCK) within `src/hooks/useChartLifecycle.ts`:
    1. Add `const [isHydrated, setIsHydrated] = useState(false);`.
    2. Call `setIsHydrated(false)` immediately upon ticker or timeframe changes.
    3. Use `requestAnimationFrame` after the first successful `setData` call to set `setIsHydrated(true)`, ensuring the rendering engine has processed the dataset.
  </action>
  <verify>
    <automated>npm test tests/hooks/useChartLifecycle.test.ts</automated>
  </verify>
  <done>isHydrated state correctly tracks chart loading/rendering cycle.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Remove Non-Deterministic Timers</name>
  <files>src/hooks/useChartLifecycle.ts</files>
  <behavior>
    - scrollToRealTime must NOT be triggered by a setTimeout.
    - scrollToRealTime must only trigger when isHydrated is true and chartData has length > 0.
  </behavior>
  <action>
    1. Search `src/hooks/useChartLifecycle.ts` for `setTimeout` calls (specifically the ~80ms ones) related to `scrollToRealTime`.
    2. Replace these with a `useEffect` that monitors `[isHydrated, chartData]`.
    3. Execute `chartRef.current?.timeScale().scrollToRealTime()` only when `isHydrated === true` and `chartData.length > 0`.
  </action>
  <verify>
    <automated>npm test tests/integration/viewport.test.ts</automated>
  </verify>
  <done>Non-deterministic timers removed; STAB-01 and STAB-03 verified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Stabilize Infinite Scroll Anchor</name>
  <files>src/hooks/useChartLifecycle.ts</files>
  <behavior>
    - When data is prepended to the start, the current visual candle must remain stationary.
  </behavior>
  <action>
    Refine the logical range adjustment during data prepending in `src/hooks/useChartLifecycle.ts`:
    1. Capture the `oldLogicalRange` immediately before the prepend update occurs.
    2. Calculate the exact number of new candles added to the start of the series.
    3. Apply `setVisibleLogicalRange` using the shifted indices (old indices + number of new candles) to lock the visual anchor.
  </action>
  <verify>
    <automated>npm test tests/integration/viewport.test.ts</automated>
  </verify>
  <done>Visual anchor preserved during infinite scroll; STAB-02 verified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Deterministic Auto-Reveal Logic</name>
  <files>src/hooks/useChartLifecycle.ts</files>
  <behavior>
    - During replay, the viewport stays stationary unless the right edge is within 10 candles of the end of the data.
  </behavior>
  <action>
    Implement a configurable `AUTO_REVEAL_THRESHOLD` for replay ticks:
    1. Define `const AUTO_REVEAL_THRESHOLD = 10;` (candles).
    2. In the replay tick handler, compare the current viewport's right edge to the total number of candles in the dataset.
    3. Only trigger a viewport update or `scrollToRealTime` if the difference is ≤ `AUTO_REVEAL_THRESHOLD`.
  </action>
  <verify>
    <automated>npm test tests/integration/viewport.test.ts</automated>
  </verify>
  <done>Viewport remains stable during replay except at the edge; STAB-04 verified.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Internal State → Chart API | untrusted timing of LWC rendering creates race conditions |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Tampering | npm installs | mitigate | slopcheck + blocking human checkpoint for [ASSUMED] packages |
| T-01-02 | DoS | `useChartLifecycle` | mitigate | Use hydration lock to prevent rapid, redundant scroll/scale calls during symbol bursts |
</threat_model>

<verification>
Run full stability suite: `npm test tests/integration/viewport.test.ts tests/hooks/useChartLifecycle.test.ts`
All tests must pass.
</verification>

<success_criteria>
1. Ticker/TF change: No single candle snap (STAB-01).
2. Prepend data: Visual anchor preserved (STAB-02).
3. Hydration: `scrollToRealTime` occurs after lock release (STAB-03).
4. Replay: Viewport stable unless at right edge (STAB-04).
</success_criteria>

<output>
Create `.planning/phases/01-viewport-stabilization/01-01-SUMMARY.md` when done
</output>
