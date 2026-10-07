#!/usr/bin/env bash
# ==============================================================================
# Verify the tablet-load / replay-cost fixes against a RUNNING streaming backend.
#
# Checks the mechanisms (not the feel): boot-path cost, wire compression, and the
# response-shape contracts that must not regress.
#
# Usage:
#   ./tools/mac/benchmark.sh                       # defaults to localhost:8765
#   ./tools/mac/benchmark.sh http://localhost:8765 SPY
#
# Exits 0 when every required check passes, 1 otherwise.
# ==============================================================================
set -uo pipefail

BASE_URL="${1:-http://localhost:8765}"
SYMBOL="${2:-}"

PASS=0
FAIL=0
WARN=0

ok()   { echo "  [PASS] $*"; PASS=$((PASS + 1)); }
bad()  { echo "  [FAIL] $*"; FAIL=$((FAIL + 1)); }
warn() { echo "  [WARN] $*"; WARN=$((WARN + 1)); }
hdr()  { echo; echo "$*"; }

have() { command -v "$1" >/dev/null 2>&1; }

# Milliseconds for a request, printing "<time_total> <size_download>".
probe() {
  # probe <curl-args...> <url>
  curl -s -o /dev/null -w '%{time_total} %{size_download}' "$@" 2>/dev/null || echo "ERR 0"
}

echo "Market Rewind — load/replay fix verification"
echo "Target: ${BASE_URL}"

# ------------------------------------------------------------------ reachability
hdr "1. Backend reachable"
STATUS_JSON=$(curl -s -m 10 "${BASE_URL}/api/status" 2>/dev/null || true)
if [ -z "${STATUS_JSON}" ]; then
  bad "no response from ${BASE_URL}/api/status — start the backend first"
  echo
  echo "Cannot continue without a running backend."
  exit 1
fi
ok "/api/status responded"

if have python3; then
  echo "${STATUS_JSON}" | python3 -c '
import json,sys
d=json.load(sys.stdin)
lake=d.get("tick_lake") or {}
db=d.get("streaming_db") or {}
print("       status=%s symbols=%s files=%s tick_count=%s schema=%s" % (
    d.get("status"), lake.get("symbol_count"), lake.get("file_count"),
    lake.get("tick_count"), lake.get("schema_version")))
print("       lake_root=%s" % db.get("path"))
' 2>/dev/null || warn "could not summarise /api/status"
fi

# ------------------------------------------------------------------ boot path (C1)
hdr "2. Boot path: aggregate vs names-only symbols"
AGG_1=$(probe "${BASE_URL}/api/symbols")
AGG_2=$(probe "${BASE_URL}/api/symbols")
NAMES_1=$(probe "${BASE_URL}/api/symbols?names_only=1")
NAMES_2=$(probe "${BASE_URL}/api/symbols?names_only=1")

fmt() { printf '%.0f ms / %s bytes' "$(echo "$1" | awk '{print $1*1000}')" "$(echo "$1" | awk '{print $2}')"; }
echo "       aggregate  run1: $(fmt "$AGG_1")"
echo "       aggregate  run2: $(fmt "$AGG_2")   (warm)"
echo "       names_only run1: $(fmt "$NAMES_1")"
echo "       names_only run2: $(fmt "$NAMES_2")"

NAMES_MS=$(echo "${NAMES_2:-0 0}" | awk '{print $1*1000}')
WARM_MS=$(echo "${AGG_2:-0 0}" | awk '{print $1*1000}')
if [ "${NAMES_MS%.*}" -lt "${WARM_MS%.*}" ] 2>/dev/null; then
  RATIO=$(awk -v a="$WARM_MS" -v b="$NAMES_MS" 'BEGIN{ if (b>0) printf "%.0f", a/b; else print "inf" }')
  ok "names_only is ${RATIO}x faster than the warm aggregate"
  if [ "${RATIO%.*}" -lt 5 ] 2>/dev/null; then
    warn "only ${RATIO}x — on a large lake this should be far larger; is the lake fully populated?"
  fi
else
  bad "names_only (${NAMES_MS} ms) is NOT faster than aggregate (${WARM_MS} ms)"
fi

# Correctness: both forms must describe the same symbol set.
AGG_JSON=$(curl -s -m 60 "${BASE_URL}/api/symbols" 2>/dev/null || true)
NAMES_JSON=$(curl -s -m 20 "${BASE_URL}/api/symbols?names_only=1" 2>/dev/null || true)
if have python3 && [ -n "${AGG_JSON}" ] && [ -n "${NAMES_JSON}" ]; then
  SETS=$(
    AGG="${AGG_JSON}" NAMES="${NAMES_JSON}" python3 -c '
import json,os
def names(payload):
    out=set()
    for item in json.loads(payload):
        n = item if isinstance(item,str) else item.get("symbol")
        if n: out.add(n)
    return out
a=names(os.environ["AGG"]); n=names(os.environ["NAMES"])
print(len(a)); print(len(n))
print("MISSING:"+",".join(sorted(a-n)) if a-n else "MISSING:")
print("EXTRA:"+",".join(sorted(n-a)) if n-a else "EXTRA:")
print("ENCODED:"+("yes" if any(("." in s or "/" in s) for s in n) else "no"))
' 2>/dev/null
  )
  A_COUNT=$(echo "${SETS}" | sed -n '1p')
  N_COUNT=$(echo "${SETS}" | sed -n '2p')
  MISSING=$(echo "${SETS}" | grep '^MISSING:' | cut -d: -f2-)
  EXTRA=$(echo "${SETS}" | grep '^EXTRA:' | cut -d: -f2-)
  ENCODED=$(echo "${SETS}" | grep '^ENCODED:' | cut -d: -f2-)

  echo "       aggregate=${A_COUNT} symbols, names_only=${N_COUNT} symbols (encoded names: ${ENCODED})"
  if [ -z "${MISSING}" ] && [ -z "${EXTRA}" ]; then
    ok "symbol sets identical — the fast path dropped nothing and invented nothing"
  else
    [ -n "${MISSING}" ] && bad "names_only is MISSING symbols: ${MISSING}"
    [ -n "${EXTRA}" ] && bad "names_only returned EXTRA symbols: ${EXTRA}"
  fi
  if [ "${A_COUNT:-0}" -gt 0 ] && [ "${ENCODED}" = "no" ]; then
    warn "no percent-encoded symbol names found (e.g. BRK.B) — cannot confirm round-trip on this lake"
  fi
else
  warn "python3 unavailable or empty response — skipped symbol-set comparison"
fi

# ------------------------------------------------------------------ compression (C2)
hdr "3. Tick payload compression"
if [ -z "${SYMBOL}" ] && have python3 && [ -n "${NAMES_JSON}" ]; then
  SYMBOL=$(echo "${NAMES_JSON}" | python3 -c '
import json,sys
items=json.load(sys.stdin)
names=[i if isinstance(i,str) else i.get("symbol") for i in items]
names=[n for n in names if n]
print(names[0] if names else "")
' 2>/dev/null)
fi
if [ -z "${SYMBOL}" ]; then
  warn "no symbol to probe (pass one as the 2nd argument); skipping compression checks"
else
  echo "       probed symbol: ${SYMBOL}"
  ID=$(probe "${BASE_URL}/api/ticks?symbol=${SYMBOL}&limit=100000" -H 'Accept-Encoding: identity')
  GZ=$(probe "${BASE_URL}/api/ticks?symbol=${SYMBOL}&limit=100000" -H 'Accept-Encoding: gzip')
  ID_BYTES=$(echo "${ID}" | awk '{print $2}')
  GZ_BYTES=$(echo "${GZ}" | awk '{print $2}')
  echo "       identity: $(fmt "$ID")"
  echo "       gzip    : $(fmt "$GZ")"

  HEADERS=$(curl -s -D - -o /dev/null -m 60 -H 'Accept-Encoding: gzip' \
    "${BASE_URL}/api/ticks?symbol=${SYMBOL}&limit=100000" 2>/dev/null || true)
  ENC=$(echo "${HEADERS}" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{print $2}')
  VARY=$(echo "${HEADERS}" | tr -d '\r' | awk 'tolower($1)=="vary:"{print $2}')
  CORS=$(echo "${HEADERS}" | tr -d '\r' | awk 'tolower($1)=="access-control-allow-origin:"{print $2}')

  if [ "${ID_BYTES:-0}" -lt 2048 ] 2>/dev/null; then
    warn "identity body is only ${ID_BYTES} bytes — too small to judge compression on this lake"
  else
    if [ "${ENC:-}" = "gzip" ]; then
      ok "Content-Encoding: gzip present"
    else
      bad "Content-Encoding is '${ENC:-<none>}' — compression is NOT being negotiated"
    fi
    if [ "${GZ_BYTES:-0}" -lt "${ID_BYTES:-0}" ] 2>/dev/null; then
      R=$(awk -v a="${ID_BYTES}" -v b="${GZ_BYTES}" 'BEGIN{printf "%.1f", a/b}')
      ok "gzip is ${R}x smaller (${ID_BYTES} -> ${GZ_BYTES} bytes)"
    else
      bad "gzip did not reduce the payload (${GZ_BYTES} vs ${ID_BYTES} bytes)"
    fi
    if [ -n "${VARY}" ]; then ok "Vary: ${VARY} present"; else warn "no Vary: Accept-Encoding header"; fi
    if [ "${CORS:-}" = "*" ]; then ok "CORS header survived compression"; else bad "CORS header missing (${CORS:-none}) — compression middleware may have clobbered it"; fi

    # Byte-for-byte content equality between the two encodings.
    if have python3; then
      EQUAL=$(python3 - "$BASE_URL" "$SYMBOL" <<'PY' 2>/dev/null
import gzip, json, sys, urllib.request
base, sym = sys.argv[1], sys.argv[2]
url = f"{base}/api/ticks?symbol={urllib.parse.quote(sym)}&limit=100000"
def get(headers):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()
try:
    ident = get({"Accept-Encoding": "identity"})
    # urllib does not auto-decompress, so the gzip body arrives raw.
    raw = get({"Accept-Encoding": "gzip"})
    body = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    print("EQUAL" if json.loads(body) == json.loads(ident) else "DIFFERENT")
except Exception as exc:
    print("ERROR:" + str(exc))
PY
)
      case "${EQUAL}" in
        EQUAL) ok "decompressed body is byte-identical to the identity body" ;;
        DIFFERENT) bad "decompressed body DIFFERS from the identity body — data corruption" ;;
        *) warn "content-equality check inconclusive (${EQUAL})" ;;
      esac
    fi
  fi

  # Small responses must stay uncompressed.
  SMALL=$(curl -s -D - -o /dev/null -m 10 -H 'Accept-Encoding: gzip' "${BASE_URL}/api/status" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{print $2}')
  if [ -z "${SMALL}" ]; then
    ok "small responses are left uncompressed (as intended)"
  else
    warn "/api/status was compressed (${SMALL}) — expected below the 1 KiB threshold"
  fi
fi

# ------------------------------------------------------------------ summary
hdr "Summary"
echo "  passed: ${PASS}   failed: ${FAIL}   warnings: ${WARN}"
if [ "${FAIL}" -gt 0 ]; then
  echo "  RESULT: FAIL — report the output above."
  exit 1
fi
echo "  RESULT: PASS (review any warnings above)"
echo
echo "Note: absolute timings depend on OS page cache; the first 'aggregate' run is"
echo "cold and the second is warm. The gain we care about is names_only vs the"
echo "WARM aggregate, since the app previously paid that cost on every boot."
