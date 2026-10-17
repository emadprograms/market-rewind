#!/usr/bin/env bash
# Verification harness for the "wrong 1D candle" fix (.planning/debug/1d-canvas-forming-candle.md).
#
# Runs every check from docs/reviews/daily-candle-formation-verification-brief.md, keeps going after
# failures, and writes ONE report file to paste back verbatim.
#
#   bash tools/verify-daily-candle-fix.sh                          # frontend suites that cover the fix
#   bash tools/verify-daily-candle-fix.sh --full                   # + the entire vitest suite
#   bash tools/verify-daily-candle-fix.sh --backend                # + backend pytest (lake/resampling)
#   bash tools/verify-daily-candle-fix.sh --ab                     # + run the repro against pre-fix src
#   bash tools/verify-daily-candle-fix.sh --probe                  # + live data probe (needs backend)
#
# Env for --probe: PROBE_SYMBOL (default TSLA), PROBE_DATE (default 2026-10-14),
#                  PROBE_BASE (default http://127.0.0.1:8765)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

REPORT="${REPORT:-/tmp/daily-candle-verification.md}"
BASE_COMMIT="${BASE_COMMIT:-b5aaa213ece3308553d674b9407e1857c26ce0e2}"
WANT_FULL=0 WANT_BACKEND=0 WANT_AB=0 WANT_PROBE=0
for arg in "$@"; do
  case "$arg" in
    --full) WANT_FULL=1 ;; --backend) WANT_BACKEND=1 ;;
    --ab) WANT_AB=1 ;; --probe) WANT_PROBE=1 ;;
    --report=*) REPORT="${arg#*=}" ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
  esac
done

VITEST=./node_modules/.bin/vitest
[ -x "$VITEST" ] || { echo "node_modules missing — run: npm install --no-audit --no-fund" >&2; exit 1; }

SUITES=(
  tests/regression/chart/dailyCandleCanvasFormation.test.tsx
  tests/unit/dailyConstituentRth.test.ts
  tests/unit/streamingClientSession.test.ts
  tests/unit/dailyRthChart.test.ts
  tests/unit/timezones.test.ts
  tests/unit/resampling.test.ts
  tests/hooks/useChartLifecycle.test.ts
  tests/integration/multiChartWorkspaceReplay.test.tsx
  tests/regression/codex/chartRenderingIntegrity.test.ts
)

{
  echo "# Daily-candle fix verification"
  echo
  echo "- repo: $(basename "$PWD")  branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null)  head: $(git rev-parse --short HEAD 2>/dev/null)"
  echo "- date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')   node: $(node -v 2>/dev/null)"
  echo "- uncommitted src changes: $(git status --porcelain -- src | wc -l | tr -d ' ') file(s)"
} > "$REPORT"

run() { # run <label> <command...>
  local label="$1"; shift
  echo >> "$REPORT"; echo "## $label" >> "$REPORT"
  echo '```' >> "$REPORT"
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  printf '%s\n' "$out" | sed -e 's/\x1b\[[0-9;]*m//g' | grep -vE "resampleData took|^\[Performance\]" | tail -25 >> "$REPORT"
  echo '```' >> "$REPORT"
  if [ "$rc" -eq 0 ]; then echo "RESULT: PASS ($label)" >> "$REPORT"; else echo "RESULT: FAIL ($label, exit $rc)" >> "$REPORT"; fi
  echo "[$( [ "$rc" -eq 0 ] && echo PASS || echo FAIL )] $label"
  return $rc
}

FAILURES=0

run "frontend suites covering the fix" "$VITEST" run "${SUITES[@]}" || FAILURES=$((FAILURES+1))

if [ "$WANT_FULL" -eq 1 ]; then
  run "full vitest suite" "$VITEST" run || FAILURES=$((FAILURES+1))
fi

if [ "$WANT_BACKEND" -eq 1 ]; then
  if command -v pytest >/dev/null 2>&1; then
    run "backend pytest (lake + resampling + server)" pytest -q backend/streaming_service/tests || FAILURES=$((FAILURES+1))
  else
    echo >> "$REPORT"; echo "## backend pytest"; echo "SKIPPED — pytest not on PATH" >> "$REPORT"
    echo "[SKIP] backend pytest (pytest not on PATH)"
  fi
fi

if [ "$WANT_AB" -eq 1 ]; then
  WT="$(mktemp -d)/mr-base"
  echo "[..] A/B: checking out pre-fix src at ${BASE_COMMIT:0:7} into $WT"
  if git worktree add --detach "$WT" "$BASE_COMMIT" >/dev/null 2>&1; then
    # keep the NEW tests, restore the OLD src: that combination is the pre-fix behaviour
    cp -R tests/regression/chart "$WT/tests/regression/" 2>/dev/null
    cp tests/unit/dailyConstituentRth.test.ts tests/unit/streamingClientSession.test.ts "$WT/tests/unit/" 2>/dev/null
    ln -s "$PWD/node_modules" "$WT/node_modules" 2>/dev/null
    ( cd "$WT" && ./node_modules/.bin/vitest run tests/regression/chart/dailyCandleCanvasFormation.test.tsx 2>&1 \
        | sed -e 's/\x1b\[[0-9;]*m//g' | grep -vE "resampleData took|^\[Performance\]" | tail -30 ) > /tmp/ab-prefix.txt 2>&1
    {
      echo >> "$REPORT"; echo "## A/B — same repro against pre-fix src (${BASE_COMMIT:0:7})"
      echo "Expected: the RTH-contamination test FAILS here and PASSES on the fixed tree."
      echo '```'; cat /tmp/ab-prefix.txt; echo '```'
    } >> "$REPORT"
    if grep -qE "Tests +[0-9]+ failed|[0-9]+ failed" /tmp/ab-prefix.txt; then
      echo "RESULT: PASS (A/B reproduced the defect on pre-fix src)" >> "$REPORT"
      echo "[PASS] A/B — defect reproduces on pre-fix src"
    else
      echo "RESULT: INCONCLUSIVE (A/B did not reproduce; check /tmp/ab-prefix.txt)" >> "$REPORT"
      echo "[WARN] A/B inconclusive — see $REPORT"
    fi
    git worktree remove --force "$WT" >/dev/null 2>&1
  else
    echo >> "$REPORT"; echo "## A/B"; echo "SKIPPED — could not create a worktree at $BASE_COMMIT" >> "$REPORT"
    echo "[SKIP] A/B (worktree failed)"
  fi
fi

if [ "$WANT_PROBE" -eq 1 ]; then
  SYMBOL="${PROBE_SYMBOL:-TSLA}"; DATE="${PROBE_DATE:-2026-10-14}"; BASE_URL="${PROBE_BASE:-http://127.0.0.1:8765}"
  echo "[..] data probe: $SYMBOL $DATE against $BASE_URL"
  python3 tools/probe-daily-candle.py --symbol "$SYMBOL" --date "$DATE" --base "$BASE_URL" \
    --report /tmp/daily-probe.md >/dev/null 2>&1
  {
    echo >> "$REPORT"; echo "## live data probe ($SYMBOL $DATE @ $BASE_URL)"
    if [ -f /tmp/daily-probe.md ]; then cat /tmp/daily-probe.md; else echo "SKIPPED — probe produced no report (is the backend running?)"; fi
  } >> "$REPORT"
  grep -qE "^- FAIL" /tmp/daily-probe.md 2>/dev/null && { echo "[FAIL] data probe found FAIL verdicts"; FAILURES=$((FAILURES+1)); } || echo "[ok] data probe"
fi

{
  echo; echo "---"; echo "TOTALS: $FAILURES failing section(s). Report: $REPORT"
} >> "$REPORT"

echo; echo "Report written to $REPORT — paste it back verbatim."
[ "$FAILURES" -eq 0 ]
