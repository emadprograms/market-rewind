#!/usr/bin/env bash
# Verification harness for the "seek while playing freezes the page" fix.
#
# Runs every check from docs/reviews/seek-while-playing-freeze-verification-brief.md,
# keeps going after failures, and writes ONE report file to paste back verbatim.
#
#   bash tools/verify-seek-freeze-fix.sh            # everything the local env allows
#   bash tools/verify-seek-freeze-fix.sh --ab       # also A/B the probe against main
#   bash tools/verify-seek-freeze-fix.sh --quick    # skip the long full-regression run
#   bash tools/verify-seek-freeze-fix.sh --soak=600000   # add the 10-minute soak
#   bash tools/verify-seek-freeze-fix.sh --journey       # add all 74 mocked journey tests
#
# Env: SEEK_SYMBOL / SEEK_DATE / SEEK_ENTRY pick the tape (default AAPL / SEED_DATE / 09:30).
#      TICK_LAKE_ROOT overrides where the tick lake is expected.
#      VERIFY_OUTDIR overrides the /tmp output directory.
#
# Nothing here modifies tracked source. Logs and the report go to /tmp.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

STAMP="$(date +%Y%m%d-%H%M%S)"
OUTDIR="${VERIFY_OUTDIR:-/tmp/market-rewind-verify-$STAMP}"
LOGDIR="$OUTDIR/logs"
REPORT="$OUTDIR/report.txt"
mkdir -p "$LOGDIR"

DO_AB=0
DO_QUICK=0
DO_JOURNEY=0
SOAK_MS=0
for arg in "$@"; do
  case "$arg" in
    --ab) DO_AB=1 ;;
    --quick) DO_QUICK=1 ;;
    --journey) DO_JOURNEY=1 ;;
    --soak) SOAK_MS=600000 ;;
    --soak=*) SOAK_MS="${arg#--soak=}" ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

FIX_FULL_SHA="$(git rev-parse HEAD)"
FIX_SHA="$(git rev-parse --short HEAD)"
FIX_BRANCH_RAW="$(git rev-parse --abbrev-ref HEAD)"
if [ "$FIX_BRANCH_RAW" = "HEAD" ]; then
  FIX_BRANCH="(detached)"          # checked out by SHA, not by branch name
  ORIG_REF="$FIX_FULL_SHA"
else
  FIX_BRANCH="$FIX_BRANCH_RAW"
  ORIG_REF="$FIX_BRANCH_RAW"
fi

# The A/B step switches branches in somebody else's working copy. Always put it back, even if
# the harness is interrupted mid-run.
restore_ref() {
  if [ -n "${AB_DIR:-}" ] && [ -d "${AB_DIR:-}" ]; then
    rm -f "$AB_DIR/node_modules" 2> /dev/null || true
    git worktree remove --force "$AB_DIR" 2> /dev/null || true
    git worktree prune 2> /dev/null || true
  fi
  git rev-parse --verify -q HEAD > /dev/null 2>&1 || return 0
  [ "$(git rev-parse HEAD)" = "$FIX_FULL_SHA" ] && return 0
  git checkout -q "$ORIG_REF" 2> /dev/null || true
}
trap restore_ref EXIT INT TERM
BASELINE_REF="e57efe8"   # main @ branch point
PROBE_SPEC="tests/regression/chart/seekWhilePlayingFreeze.spec.ts"
PROBE_MODULE="tests/regression/chart/freezeProbeInPage.ts"
# Specs that failed in the full regression run for reasons not yet attributed. The A/B runs them on
# both sides so "pre-existing" is measured rather than assumed.
SUSPECT_SPECS="tests/regression/chart/chartIntegrity.spec.ts tests/regression/chart/randomDayReplay.spec.ts tests/regression/replay/dateReset.spec.ts"

# ---------------------------------------------------------------- result tracking
STEP_RESULTS=()
RUN_STEP_CWD=""
note() { printf '%s\n' "$*" >> "$REPORT"; }
say()  { printf '%s\n' "$*"; }

# Vitest and Playwright both colourise their summary lines, which defeats anchored greps.
plain() { sed -e 's/\x1b\[[0-9;]*m//g' "$1" 2>/dev/null; }
summary()   { plain "$1" | grep -E '^\s*(Test Files|Tests|Duration)\s' | tr -s ' ' | tr '\n' ' '; }
pwsummary() { plain "$1" | grep -E '^\s*[0-9]+ (passed|failed|skipped|flaky|did not run)' | tr -s ' ' | tr '\n' ' '; }

# run_step <label> <logfile-slug> <command...>
# Records PASS/FAIL from the exit code; never aborts the harness.
run_step() {
  local label="$1" slug="$2"; shift 2
  local log="$LOGDIR/$slug.log"
  say ""
  say "==> $label"
  say "    \$ $*"
  say "    log: $log"
  local started ended rc
  started=$(date +%s)
  if [ -n "${RUN_STEP_CWD:-}" ]; then
    ( cd "$RUN_STEP_CWD" && "$@" ) > "$log" 2>&1
  else
    "$@" > "$log" 2>&1
  fi
  rc=$?
  ended=$(date +%s)
  local secs=$(( ended - started ))
  local status="PASS"
  [ "$rc" -ne 0 ] && status="FAIL"
  STEP_RESULTS+=("$status|$label|exit=$rc|${secs}s")
  say "    -> $status (exit $rc) in ${secs}s"
  # Surface the tail so a human watching the terminal sees failures immediately.
  if [ "$rc" -ne 0 ]; then
    tail -n 40 "$log" | sed 's/^/    ! /'
  fi
  return 0
}

# skip_step <label> <reason>
skip_step() {
  STEP_RESULTS+=("BLOCKED|$1|$2")
  say ""
  say "==> $1"
  say "    -> BLOCKED: $2"
}

# ---------------------------------------------------------------- header
: > "$REPORT"
note "MARKET REWIND — seek-while-playing-freeze verification"
note "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
note "host: $(uname -srm)  node: $(node -v 2>/dev/null || echo n/a)  npm: $(npm -v 2>/dev/null || echo n/a)"
note "branch: $FIX_BRANCH @ $FIX_SHA"
note "A/B baseline ref: $BASELINE_REF = $(git rev-parse --short "$BASELINE_REF" 2>/dev/null || echo unresolved) (branch point of this fix; origin/main is not used)"
note "logs: $LOGDIR"
note ""

say "Report: $REPORT"
say "Logs:   $LOGDIR"

# ---------------------------------------------------------------- 0. environment probes
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  DIRTY="yes"
else
  DIRTY="no"
fi
note "working tree dirty: $DIRTY"
[ "$DIRTY" = "yes" ] && git status --porcelain | sed 's/^/    /' >> "$REPORT"

TICK_LAKE="${TICK_LAKE_ROOT:-../data-harvester/data/tick_lake}"
if [ -d "$TICK_LAKE" ]; then
  note "tick lake: PRESENT at $TICK_LAKE ($(find "$TICK_LAKE" -maxdepth 2 -name '*.parquet' 2>/dev/null | wc -l | tr -d ' ') parquet files within depth 2)"
else
  note "tick lake: ABSENT at $TICK_LAKE  (set TICK_LAKE_ROOT to override)"
fi

BACKEND_UP="down"
if curl -fsS --max-time 5 "http://localhost:8765/api/status" > "$LOGDIR/00-backend-status.log" 2>&1; then
  BACKEND_UP="up"
  note "backend :8765: UP"
  head -c 400 "$LOGDIR/00-backend-status.log" >> "$REPORT"; echo "" >> "$REPORT"
else
  note "backend :8765: DOWN — start it in another terminal with: npm run backend"
  note "  (npm run backend expects ../data-harvester/.venv/bin/python; see the brief §0)"
fi
note ""

# Which tape is "dense" depends entirely on what the local lake holds, so it is discovered
# through GET /api/symbols (already sorted by tick_count desc) rather than hard-coded. A caller
# can pin one with SEEK_SYMBOL / SEEK_DATE / SEEK_ENTRY.
TAPE_ENV="$OUTDIR/tape.env"
: > "$TAPE_ENV"
DENSE_SYMBOL=""
# The session date comes from the repo's own E2E convention, not from the lake: /api/symbols
# aggregates over every session, so its first_tick is the lake's oldest partition, not a dense day.
SEED_DATE="$(sed -n "s/^export const SEED_DATE = '\([0-9-]*\)'.*/\1/p" "$REPO_ROOT/tests/regression/e2e-utils.ts" | head -1)"
SEED_DATE="${SEED_DATE:-2026-09-25}"
if [ "$BACKEND_UP" = "up" ]; then
  if [ -n "${SEEK_SYMBOL:-}" ] || [ -n "${SEEK_DATE:-}" ]; then
    note "--- tape pinned by caller: ${SEEK_SYMBOL:-<spec default>} ${SEEK_DATE:-<spec default>} ${SEEK_ENTRY:-<spec default>} ---"
    curl -fsS --max-time 180 "http://localhost:8765/api/symbols" > "$LOGDIR/00-symbols.log" 2>&1 \
      || note "    could not fetch /api/symbols; see $LOGDIR/00-symbols.log"
  else
    python3 "$REPO_ROOT/tools/pick-densest-tape.py" --out "$TAPE_ENV" --report "$REPORT" \
      > "$LOGDIR/00-pick-tape.log" 2>&1
    if [ -s "$TAPE_ENV" ]; then
      # shellcheck disable=SC1090
      . "$TAPE_ENV"
    fi
    note "    probe tape 1 (primary): spec default AAPL $SEED_DATE 09:30 — the date the live regression suite already proves works"
    if [ -n "${DENSE_SYMBOL:-}" ] && [ "$DENSE_SYMBOL" != "AAPL" ]; then
      note "    probe tape 2 (denser):  $DENSE_SYMBOL $SEED_DATE 09:30"
    else
      note "    probe tape 2 (denser):  skipped — densest symbol is the default, or none was found"
    fi
  fi
else
  note "--- tape: backend down, lake inventory unavailable; probe uses built-in defaults ---"
fi
note ""

BROWSER_OK="yes"
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if ls "$PW_CACHE"/chromium* > /dev/null 2>&1; then
  note "chromium: installed ($PW_CACHE)"
else
  BROWSER_OK="no"
  note "chromium: NOT FOUND in $PW_CACHE — run: npx playwright install chromium"
fi
note ""

E2E_POSSIBLE="yes"
if [ "$BROWSER_OK" = "no" ]; then
  E2E_POSSIBLE="no (no browser)"
elif [ "$BACKEND_UP" = "down" ]; then
  E2E_POSSIBLE="journey-only (backend down; real-tape specs need it)"
fi
note "e2e capability: $E2E_POSSIBLE"
note "tape: ${SEEK_SYMBOL:-AAPL} ${SEEK_DATE:-$SEED_DATE} ${SEEK_ENTRY:-09:30}   densest symbol: ${DENSE_SYMBOL:-<none>}   speed runs: default + 25x + 100x   soak: ${SOAK_MS}ms   journey: $([ "$DO_JOURNEY" -eq 1 ] && echo full || echo 01-boot only)"
note ""

# ---------------------------------------------------------------- 1. static gates
run_step "1 tsc --noEmit" "01-tsc" npx tsc --noEmit -p tsconfig.json

# ---------------------------------------------------------------- 2. vitest
run_step "2 vitest full suite" "02-vitest-full" npx vitest run
VITEST_SUMMARY="$(summary "$LOGDIR/02-vitest-full.log")"
note "2 vitest summary: ${VITEST_SUMMARY:-<not found — see log>}"
FAILED_NAMES="$(grep -E '^\s*(FAIL|×)' "$LOGDIR/02-vitest-full.log" | head -40)"
if [ -n "$FAILED_NAMES" ]; then
  note "2 vitest failures:"
  printf '%s\n' "$FAILED_NAMES" | sed 's/^/    /' >> "$REPORT"
fi
note ""

run_step "2b seek guards (target tests)" "02b-vitest-seek" \
  npx vitest run tests/unit/seekWhilePlayingFreeze.test.ts tests/integration/seekTimelineCandles.test.tsx
GUARD_SUMMARY="$(summary "$LOGDIR/02b-vitest-seek.log")"
note "2b seek guards summary: ${GUARD_SUMMARY:-<not found — see log>}"
note ""

# ---------------------------------------------------------------- 3. build
run_step "3 vite build" "03-build" npm run build
BUILD_LINE="$(grep -E 'built in|dist/assets/index' "$LOGDIR/03-build.log" | tail -3 | tr '\n' ' ')"
note "3 build: ${BUILD_LINE:-<no summary line — see log>}"
note ""

# ---------------------------------------------------------------- 4. backend tests
if [ -x "../data-harvester/.venv/bin/pytest" ]; then
  run_step "4 backend pytest" "04-backend-pytest" npm run backend:test
  note "4 backend pytest: $(grep -E 'passed|failed|error' "$LOGDIR/04-backend-pytest.log" | tail -1)"
else
  skip_step "4 backend pytest" "no ../data-harvester/.venv/bin/pytest (Python env absent on this host)"
fi
note ""

# ---------------------------------------------------------------- 5+ E2E
if [ "$BROWSER_OK" = "no" ]; then
  skip_step "5 journey e2e (mocked)" "no chromium binary"
  skip_step "6 freeze probe" "no chromium binary"
  skip_step "7 neighbouring regressions" "no chromium binary"
  skip_step "8 full regression suite" "no chromium binary"
  skip_step "9 A/B against main" "no chromium binary"
else
  # The journey suite is fully mocked (browser only, no DuckDB). By default just 01-boot: it
  # carries the session-anchor expectations, and all 74 tests ran 500s+ last time and were still
  # going when the run was terminated.
  run_step "5 journey 01-boot (mocked anchor check)" "05-journey-boot" \
    npx playwright test -c playwright.journey.config.ts tests/regression/journey/01-boot.spec.ts
  note "5 journey 01-boot: $(pwsummary "$LOGDIR/05-journey-boot.log")"
  if [ "$DO_JOURNEY" -eq 1 ]; then
    run_step "5b journey full suite (mocked)" "05b-journey-full" npm run test:journey
    note "5b journey full: $(pwsummary "$LOGDIR/05b-journey-full.log")"
  else
    skip_step "5b journey full suite" "opt-in: re-run with --journey (74 tests, ~8 min or more)"
  fi
  note "    context: the app has defaulted the entry time to 09:10 since e57efe8 (already on main),"
  note "    while 11 journey specs and the marketSimulator mock still expect the 09:20 anchor, so"
  note "    failures here are expected to be PRE-EXISTING. --ab runs 01-boot on the baseline too."
  note ""

  if [ "$BACKEND_UP" = "up" ]; then
    run_step "6 freeze probe (primary tape)" "06-freeze-primary" \
      npx playwright test "$PROBE_SPEC"

    if [ -n "${DENSE_SYMBOL:-}" ] && [ "$DENSE_SYMBOL" != "AAPL" ]; then
      run_step "6b freeze probe (densest tape: $DENSE_SYMBOL $SEED_DATE)" "06b-freeze-dense" \
        env SEEK_SYMBOL="$DENSE_SYMBOL" SEEK_DATE="$SEED_DATE" SEEK_ENTRY="09:30" \
        npx playwright test "$PROBE_SPEC"
    else
      skip_step "6b freeze probe (densest tape)" "no distinct densest symbol to compare against"
    fi

    # The freeze cost scales with how many ticks elapse per unit of real time, so the same probe
    # runs at high speed multipliers too. SEEK_SOAK_MS stays unset here => the soak test skips.
    run_step "6c freeze probe @25x" "06c-freeze-25x" env SEEK_SPEED=25 npx playwright test "$PROBE_SPEC"
    run_step "6d freeze probe @100x" "06d-freeze-100x" env SEEK_SPEED=100 npx playwright test "$PROBE_SPEC"

    if [ "$SOAK_MS" -gt 0 ] 2>/dev/null; then
      run_step "6e soak (${SOAK_MS}ms) @25x" "06e-soak" \
        env SEEK_SOAK_MS="$SOAK_MS" SEEK_SPEED=25 npx playwright test "$PROBE_SPEC" -g "soak"
    else
      skip_step "6e soak" "opt-in: re-run with --soak=600000"
    fi

    run_step "7a chartShaking" "07a-chart-shaking" npx playwright test tests/regression/chart/chartShaking.spec.ts
    run_step "7b realtimePlayback" "07b-realtime" npx playwright test tests/regression/replay/realtimePlayback.spec.ts
    run_step "7c sync/" "07c-sync" npx playwright test tests/regression/sync/

    if [ "$DO_QUICK" -eq 0 ]; then
      # journey/ is deliberately excluded: it is written for playwright.journey.config.ts, where its
      # network mocks apply. Run under the live-backend config it produced 73 failures in 48.9 min,
      # almost all of them the pre-existing 09:20-vs-09:10 anchor staleness. Step 5 covers it.
      run_step "8 regression suite (chart/replay/sync/viewport)" "08-full-regression" \
        npx playwright test tests/regression/chart tests/regression/replay tests/regression/sync tests/regression/viewport
      note "8 regression: $(pwsummary "$LOGDIR/08-full-regression.log")"
      note "    journey/ excluded on purpose (own config, see step 5); run 'npm run test:regression' for everything"
    else
      skip_step "8 regression suite" "--quick"
    fi
  else
    skip_step "6 freeze probe" "backend down — real tape unavailable"
    skip_step "7 neighbouring regressions" "backend down"
    skip_step "8 full regression suite" "backend down"
  fi
  note ""
fi

# ---------------------------------------------------------------- A/B against main
# run_in <dir> <label> <slug> <command...> — run_step with a working directory. The cd happens
# inside run_step, around the command only, so the result is still recorded in the parent shell.
run_in() {
  local dir="$1" label="$2" slug="$3"; shift 3
  RUN_STEP_CWD="$dir"
  run_step "$label" "$slug" "$@"
  RUN_STEP_CWD=""
}

# Provenance guards for the A/B. The earlier run was invalid because Playwright's webServer uses
# reuseExistingServer (CI unset) on a hardcoded localhost:3000, so a leftover dev server silently
# served the fixed code to the "baseline" side. Each side now proves two things before it runs:
#   (a) its src/ tree equals the ref it claims to test, and
#   (b) nothing is already listening on :3000, so Playwright must start its own server in that tree.
AB_INVALID=0
src_matches_ref() {  # <dir> <ref>: src/ equals the ref and has no uncommitted changes
  # Fail closed: an unresolvable ref makes git diff error, which must never read as "equal".
  git -C "$1" rev-parse --verify -q "$2^{commit}" > /dev/null 2>&1 || return 1
  git -C "$1" diff --quiet "$2" -- src 2>/dev/null \
    && [ -z "$(git -C "$1" status --porcelain -- src)" ]
}
port_3000_busy() {
  (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null
}
ab_run() {  # <dir> <ref> <label> <logslug> <command...>
  local dir="$1" ref="$2" label="$3" slug="$4"; shift 4
  if ! src_matches_ref "$dir" "$ref"; then
    note "[$label] NOT RUN: $dir src/ does not equal $ref; this side would not test what it claims"
    AB_INVALID=1; return 0
  fi
  if port_3000_busy; then
    note "[$label] NOT RUN: port 3000 is already in use, so Playwright would reuse that server, not $dir"
    AB_INVALID=1; return 0
  fi
  run_in "$dir" "$label" "$slug" "$@"
}

ab_probe() {
  local dir="$1" ref="$2" label="$3" logslug="$4"
  ab_run "$dir" "$ref" "$label" "$logslug" npx playwright test "$PROBE_SPEC"
  grep -h 'FREEZE-REPORT' "$LOGDIR/$logslug.log" 2>/dev/null | sed "s/^/[$label] /" >> "$REPORT"
}

if [ "$DO_AB" -eq 1 ] && [ "$BROWSER_OK" = "yes" ] && [ "$BACKEND_UP" = "up" ]; then
  note "--- A/B: unfixed baseline vs fix ---"
  # A separate worktree, so this never touches the caller's checkout. The previous version switched
  # branches in place and then could not find the probe: it copied only the spec, not the module the
  # spec imports, so both sides errored with "Cannot find module freezeProbeInPage" / "No tests found".
  AB_DIR="${AB_WORKTREE:-/tmp/market-rewind-baseline-$STAMP}"
  rm -rf "$AB_DIR"
  if ! git worktree add -q --detach "$AB_DIR" "$BASELINE_REF" > "$LOGDIR/09-worktree.log" 2>&1; then
    skip_step "9 A/B against baseline" "git worktree add failed; see $LOGDIR/09-worktree.log"
    tail -5 "$LOGDIR/09-worktree.log" | sed 's/^/    /' >> "$REPORT"
  else
    ln -s "$REPO_ROOT/node_modules" "$AB_DIR/node_modules"
    git -C "$AB_DIR" checkout -q "$FIX_FULL_SHA" -- "$PROBE_SPEC" "$PROBE_MODULE"
    note "9 baseline: $(git -C "$AB_DIR" rev-parse --short HEAD) in $AB_DIR (your checkout stays at $FIX_SHA)"
    if src_matches_ref "$AB_DIR" "$BASELINE_REF"; then
      note "    baseline src/ == $BASELINE_REF: yes"
    else
      note "    baseline src/ == $BASELINE_REF: NO (A/B will be marked invalid)"; AB_INVALID=1
    fi

    ab_probe "$AB_DIR" "$BASELINE_REF" "9a probe on baseline (expect FAIL)" "09a-ab-main"
    ab_probe "$REPO_ROOT" "$FIX_FULL_SHA" "9b probe on fix (expect PASS)" "09b-ab-fix"

    ab_run "$AB_DIR" "$BASELINE_REF" "9c journey 01-boot on baseline" "09c-ab-journey-baseline" \
      npx playwright test -c playwright.journey.config.ts tests/regression/journey/01-boot.spec.ts
    note "9c journey 01-boot: baseline $(pwsummary "$LOGDIR/09c-ab-journey-baseline.log") vs fix $(pwsummary "$LOGDIR/05-journey-boot.log")"
    note "    identical failures on both sides => pre-existing, not this fix"

    # shellcheck disable=SC2086
    ab_run "$AB_DIR" "$BASELINE_REF" "9d suspect specs on baseline" "09d-ab-suspects-baseline" \
      npx playwright test $SUSPECT_SPECS
    # shellcheck disable=SC2086
    ab_run "$REPO_ROOT" "$FIX_FULL_SHA" "9e suspect specs on fix" "09e-ab-suspects-fix" \
      npx playwright test $SUSPECT_SPECS
    note "9d/9e suspect specs (chartIntegrity, randomDayReplay, dateReset):"
    note "    baseline: $(pwsummary "$LOGDIR/09d-ab-suspects-baseline.log")"
    note "    fix:      $(pwsummary "$LOGDIR/09e-ab-suspects-fix.log")"
    note "    any test failing on the fix but passing on the baseline is a regression from this change"
    if [ "$AB_INVALID" -eq 0 ]; then
      note "9 A/B verdict: VALID (each side ran its own tree on its own server). Read 9a: it must FAIL."
    else
      note "9 A/B verdict: INVALID. At least one side was not run or was not provably its own tree. Do not quote it."
    fi

    rm -f "$AB_DIR/node_modules"
    git worktree remove --force "$AB_DIR" 2> /dev/null || true
    git worktree prune 2> /dev/null || true
    AB_DIR=""
    note ""
  fi
elif [ "$DO_AB" -eq 1 ]; then
  skip_step "9 A/B against baseline" "needs both a browser and a running backend"
fi

# ---------------------------------------------------------------- freeze report extraction
note "--- FREEZE-REPORT blocks (paste-back payload) ---"
if grep -qh 'FREEZE-REPORT' "$LOGDIR"/*.log 2>/dev/null; then
  grep -h 'FREEZE-REPORT' "$LOGDIR"/*.log | sort -u | sed 's/^/    /' >> "$REPORT"
else
  note "    none produced — no browser run reached the probe. Reason recorded above."
fi
note ""

# ---------------------------------------------------------------- failure detail
FAIL_DETAIL=""
for f in "$LOGDIR"/*.log; do
  [ -e "$f" ] || continue
  FAIL_DETAIL+="$(plain "$f" | grep -E '^\s*(×|✘|[0-9]+\))' | head -20 | sed "s|^|    [$(basename "$f")] |")"$'\n'
done
if [ -n "$(printf '%s' "$FAIL_DETAIL" | tr -d '[:space:]')" ]; then
  note "--- failing test names (all logs) ---"
  printf '%s' "$FAIL_DETAIL" >> "$REPORT"
  note ""
fi

# ---------------------------------------------------------------- summary table
note "=== SUMMARY ==="
for row in "${STEP_RESULTS[@]}"; do
  status="${row%%|*}"; rest="${row#*|}"
  label="${rest%%|*}"; detail="${rest#*|}"
  printf '%-8s %-42s %s\n' "$status" "$label" "$detail" >> "$REPORT"
done
note ""
note "=== PASTE THIS BACK ==="
note "BRANCH: $FIX_BRANCH @ $FIX_SHA"
note "BACKEND: $BACKEND_UP   TICK_LAKE: $([ -d "$TICK_LAKE" ] && echo present || echo absent) ($TICK_LAKE)   CHROMIUM: $([ "$BROWSER_OK" = yes ] && echo installed || echo missing)"
note "TAPE primary: ${SEEK_SYMBOL:-AAPL} ${SEEK_DATE:-$SEED_DATE} entry ${SEEK_ENTRY:-09:30}   densest symbol: ${DENSE_SYMBOL:-<none>}"
for row in "${STEP_RESULTS[@]}"; do
  note "  $row"
done
note "FREEZE-REPORTS: see block above"
note "MANUAL UAT (browser, replay PLAYING): 10x STEP fwd, 10x STEP back, slow full scrub, flick end-to-end, HH:MM:SS jump both ways, repeat at 25x/100x, then rewind 30m and check for candles right of the playhead."
note "  froze=YES|NO  unresponsive_dialog=YES|NO  longest_task_ms=<n>  scrub_drag_scripting_ms=<n>  future_candle_after_rewind=YES|NO  console_errors=<verbatim|none>"
note "NOTES: <flakes, reruns, machine specs, anything unexpected>"

say ""
say "================= REPORT ================="
cat "$REPORT"
say "=========================================="
say "Report file: $REPORT"
say "Logs dir:    $LOGDIR"
say "Paste the section between '=== PASTE THIS BACK ===' and the end, plus any FREEZE-REPORT blocks."

# Exit non-zero if any real step failed, so CI-style callers notice.
for row in "${STEP_RESULTS[@]}"; do
  case "$row" in FAIL*) exit 1 ;; esac
done
exit 0
