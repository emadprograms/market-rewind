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
SOAK_MS=0
for arg in "$@"; do
  case "$arg" in
    --ab) DO_AB=1 ;;
    --quick) DO_QUICK=1 ;;
    --soak) SOAK_MS=600000 ;;
    --soak=*) SOAK_MS="${arg#--soak=}" ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

FIX_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
FIX_SHA="$(git rev-parse --short HEAD)"
BASELINE_REF="e57efe8"   # main @ branch point
PROBE_SPEC="tests/regression/chart/seekWhilePlayingFreeze.spec.ts"

# ---------------------------------------------------------------- result tracking
STEP_RESULTS=()
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
  "$@" > "$log" 2>&1
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
note "branch: $FIX_BRANCH @ $FIX_SHA   (baseline for A/B: main @ $BASELINE_REF)"
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
if [ "$BACKEND_UP" = "up" ]; then
  if [ -n "${SEEK_SYMBOL:-}" ] || [ -n "${SEEK_DATE:-}" ]; then
    note "--- tape pinned by caller: ${SEEK_SYMBOL:-<default>} ${SEEK_DATE:-<default>} ${SEEK_ENTRY:-<default>} ---"
    curl -fsS --max-time 120 "http://localhost:8765/api/symbols" > "$LOGDIR/00-symbols.log" 2>&1 \
      || note "    could not fetch /api/symbols; see $LOGDIR/00-symbols.log"
  else
    python3 "$REPO_ROOT/tools/pick-densest-tape.py" --out "$TAPE_ENV" --report "$REPORT" \
      > "$LOGDIR/00-pick-tape.log" 2>&1
    if [ -s "$TAPE_ENV" ]; then
      # shellcheck disable=SC1090
      . "$TAPE_ENV"
      export SEEK_SYMBOL SEEK_DATE SEEK_ENTRY
    else
      note "    tape picker chose nothing; probe uses its built-in defaults (see $LOGDIR/00-pick-tape.log)"
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
note "tape: ${SEEK_SYMBOL:-AAPL} ${SEEK_DATE:-<SEED_DATE>} ${SEEK_ENTRY:-09:30}   speed runs: default + 25x + 100x   soak: ${SOAK_MS}ms"
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
  # Journey suite is fully mocked: needs a browser, not the DuckDB service.
  run_step "5 journey e2e (mocked)" "05-journey" npm run test:journey
  note "5 journey: $(pwsummary "$LOGDIR/05-journey.log")"
  note ""

  if [ "$BACKEND_UP" = "up" ]; then
    run_step "6 freeze probe (tape: ${SEEK_SYMBOL:-default} ${SEEK_DATE:-default})" "06-freeze-picked" \
      npx playwright test "$PROBE_SPEC"

    # Cross-check on the spec's built-in default tape, so the report carries both a dense session
    # and the thin one regardless of what the lake happened to contain.
    run_step "6b freeze probe (built-in default tape)" "06b-freeze-default" \
      env -u SEEK_SYMBOL -u SEEK_DATE -u SEEK_ENTRY npx playwright test "$PROBE_SPEC"

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
      run_step "8 full regression suite" "08-full-regression" npm run test:regression
      note "8 full regression: $(pwsummary "$LOGDIR/08-full-regression.log")"
    else
      skip_step "8 full regression suite" "--quick"
    fi
  else
    skip_step "6 freeze probe" "backend down — real tape unavailable"
    skip_step "7 neighbouring regressions" "backend down"
    skip_step "8 full regression suite" "backend down"
  fi
  note ""
fi

# ---------------------------------------------------------------- A/B against main
ab_probe() {
  local label="$1" logslug="$2"
  run_step "$label" "$logslug" npx playwright test "$PROBE_SPEC"
  grep -h 'FREEZE-REPORT' "$LOGDIR/$logslug.log" | sed "s/^/[$label] /" >> "$REPORT"
}

if [ "$DO_AB" -eq 1 ] && [ "$BROWSER_OK" = "yes" ] && [ "$BACKEND_UP" = "up" ]; then
  note "--- A/B: unfixed baseline vs fix ---"
  if [ "$DIRTY" = "yes" ]; then
    skip_step "9 A/B against main" "working tree is dirty; refusing to switch branches. Commit or stash first, then re-run with --ab"
  else
    git checkout -q main || { skip_step "9 A/B against main" "git checkout main failed"; }
    if [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ]; then
      git checkout -q "$FIX_BRANCH" -- "$PROBE_SPEC"   # probe only, NOT the source fix
      note "9 A/B baseline: main @ $(git rev-parse --short HEAD) + probe spec copied from $FIX_BRANCH"
      note "    source fix present on baseline? $(git diff --quiet "$BASELINE_REF" -- src/store/usePlaybackStore.ts src/hooks/useChartData.ts src/hooks/useChartLifecycle.ts && echo NO || echo YES-UNEXPECTED)"
      ab_probe "9a probe on main (expect FAIL)" "09a-ab-main"
      rm -f "$PROBE_SPEC"
      git checkout -q "$FIX_BRANCH"
      note "9 A/B fix: $FIX_BRANCH @ $(git rev-parse --short HEAD)"
      ab_probe "9b probe on fix (expect PASS)" "09b-ab-fix"
    fi
    note ""
  fi
elif [ "$DO_AB" -eq 1 ]; then
  skip_step "9 A/B against main" "needs both a browser and a running backend"
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
note "TAPE: ${SEEK_SYMBOL:-<spec default AAPL>} ${SEEK_DATE:-<spec default SEED_DATE>} entry ${SEEK_ENTRY:-<spec default 09:30>}   (auto-picked densest unless pinned)"
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
