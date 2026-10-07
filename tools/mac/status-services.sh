#!/usr/bin/env bash
# ==============================================================================
# Status Report for Market Rewind Services
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

echo -e "${BOLD}${CYAN}======================================================${NC}"
echo -e "${BOLD}${CYAN}       Market Rewind Service Status on macOS          ${NC}"
echo -e "${BOLD}${CYAN}======================================================${NC}"

# Check Auto-Startup & launchd Supervision
BACKEND_LOADED=false
FRONTEND_LOADED=false
if launchctl list 2>/dev/null | grep "com.marketrewind.backend" >/dev/null 2>&1; then
  BACKEND_LOADED=true
fi
if launchctl list 2>/dev/null | grep "com.marketrewind.frontend" >/dev/null 2>&1; then
  FRONTEND_LOADED=true
fi

echo -e "${BOLD}[System Supervision & Auto-Startup (launchd)]${NC}"
if [ "${BACKEND_LOADED}" = true ]; then
  echo -e "  Backend Daemon:   ${GREEN}ACTIVE${NC} (KeepAlive: enabled, 24/7 persistent)"
else
  echo -e "  Backend Daemon:   ${YELLOW}NOT LOADED${NC} (Run ./tools/mac/install-startup.sh to enable)"
fi
if [ "${FRONTEND_LOADED}" = true ]; then
  echo -e "  Frontend Daemon:  ${GREEN}ACTIVE${NC} (KeepAlive: enabled, 24/7 persistent)"
else
  echo -e "  Frontend Daemon:  ${YELLOW}NOT LOADED${NC} (Run ./tools/mac/install-startup.sh to enable)"
fi
echo ""

# Check Backend
echo -e "${BOLD}[Backend Streaming Service (Port ${BACKEND_PORT})]${NC}"
if check_backend_health; then
  BPID=$(lsof -ti :${BACKEND_PORT} | head -n 1 2>/dev/null || echo "")
  echo -e "  Health:  ${GREEN}HEALTHY / ONLINE${NC}"
  echo -e "  PID:     ${BPID}"
  if [ -n "${BPID}" ]; then
    MEM=$(ps -o rss= -p "${BPID}" 2>/dev/null | awk '{print int($1/1024) " MB"}' || echo "N/A")
    UPTIME=$(ps -o etime= -p "${BPID}" 2>/dev/null | xargs || echo "N/A")
    echo -e "  Memory:  ${MEM}"
    echo -e "  Uptime:  ${UPTIME}"
  fi
  # Fetch tick lake summary
  STATUS_JSON=$(curl -s -m 2 "http://127.0.0.1:${BACKEND_PORT}/api/status" 2>/dev/null || echo "")
  if [ -n "${STATUS_JSON}" ]; then
    LAKE_PATH=$(echo "${STATUS_JSON}" | grep -o '"path":"[^"]*"' | head -n 1 | cut -d'"' -f4 || echo "")
    FILE_COUNT=$(echo "${STATUS_JSON}" | grep -o '"file_count":[0-9]*' | head -n 1 | cut -d':' -f2 || echo "")
    SYM_COUNT=$(echo "${STATUS_JSON}" | grep -o '"symbol_count":[0-9]*' | head -n 1 | cut -d':' -f2 || echo "")
    echo -e "  Tick Lake: ${CYAN}${LAKE_PATH}${NC}"
    echo -e "  Inventory: ${SYM_COUNT} symbols across ${FILE_COUNT} parquet files"
  fi
else
  echo -e "  Health:  ${RED}OFFLINE${NC}"
fi
echo ""

# Check Frontend
echo -e "${BOLD}[Frontend Web Server]${NC}"
FRONTEND_ONLINE=false
DETECTED_PORT=""
for P in 3000 3001; do
  if check_frontend_health "${P}"; then
    FRONTEND_ONLINE=true
    DETECTED_PORT="${P}"
    break
  fi
done

if [ "${FRONTEND_ONLINE}" = true ]; then
  FPID=$(lsof -ti :${DETECTED_PORT} | head -n 1 2>/dev/null || echo "")
  echo -e "  Health:  ${GREEN}HEALTHY / ONLINE${NC} on port ${DETECTED_PORT}"
  echo -e "  PID:     ${FPID}"
  if [ -n "${FPID}" ]; then
    MEM=$(ps -o rss= -p "${FPID}" 2>/dev/null | awk '{print int($1/1024) " MB"}' || echo "N/A")
    UPTIME=$(ps -o etime= -p "${FPID}" 2>/dev/null | xargs || echo "N/A")
    echo -e "  Memory:  ${MEM}"
    echo -e "  Uptime:  ${UPTIME}"
  fi

  # Which mode is actually being served. A dev server injects /@vite/client into the
  # document; the bundled preview serves hashed /assets/ files instead. This matters
  # because a dev server reinstates the per-module request waterfall that makes the
  # tablet's cold load slow, and it is easy to end up on one without noticing.
  FRONTEND_HTML=$(curl -s -m 3 "http://127.0.0.1:${DETECTED_PORT}/" 2>/dev/null || echo "")
  if printf '%s' "${FRONTEND_HTML}" | grep -q '@vite/client'; then
    echo -e "  Serving: ${YELLOW}Vite DEV server${NC} (unbundled \u2014 slow cold load on the tablet)"
    echo -e "           ${YELLOW}Run ./tools/mac/restart-services.sh to serve the built bundle.${NC}"
  else
    ASSET=$(printf '%s' "${FRONTEND_HTML}" | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' 2>/dev/null | sed -n '1p' || true)
    echo -e "  Serving: ${GREEN}PRODUCTION bundle${NC}${ASSET:+ (${ASSET})}"
  fi
else
  echo -e "  Health:  ${RED}OFFLINE${NC}"
fi
echo ""

# Network access URLs
LOCAL_IP="$(get_local_ip)"
TAILSCALE_IP="$(get_tailscale_ip)"
PORT_TO_SHOW="${DETECTED_PORT:-3000}"

echo -e "${BOLD}[Access URLs]${NC}"
echo -e "  Local Browser:        ${CYAN}http://localhost:${PORT_TO_SHOW}${NC}"
if [ -n "${LOCAL_IP}" ] && [ "${LOCAL_IP}" != "localhost" ]; then
  echo -e "  Same Wi-Fi (Tablet):  ${CYAN}http://${LOCAL_IP}:${PORT_TO_SHOW}${NC}"
fi
if [ -n "${TAILSCALE_IP}" ]; then
  echo -e "  Tailscale (Remote):   ${CYAN}http://${TAILSCALE_IP}:${PORT_TO_SHOW}${NC}"
fi
echo ""

# Logs
echo -e "${BOLD}[Recent Log Output]${NC}"
echo -e "  Backend log:  ${YELLOW}${LOG_DIR}/backend.log${NC}"
if [ -f "${LOG_DIR}/backend.log" ]; then
  tail -n 3 "${LOG_DIR}/backend.log" | sed 's/^/    /'
fi
echo -e "  Frontend log: ${YELLOW}${LOG_DIR}/frontend.log${NC}"
if [ -f "${LOG_DIR}/frontend.log" ]; then
  tail -n 3 "${LOG_DIR}/frontend.log" | sed 's/^/    /'
fi
echo -e "${BOLD}======================================================${NC}"
