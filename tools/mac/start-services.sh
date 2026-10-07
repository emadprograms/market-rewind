#!/usr/bin/env bash
# ==============================================================================
# Start All Market Rewind Services (Backend + Frontend)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

echo -e "${BOLD}${CYAN}======================================================${NC}"
echo -e "${BOLD}${CYAN}   Starting Market Rewind Services on macOS           ${NC}"
echo -e "${BOLD}${CYAN}======================================================${NC}"

# Prefer launchd supervision if LaunchAgents are installed
if [ -f "${BACKEND_PLIST}" ] && [ -f "${FRONTEND_PLIST}" ]; then
  log_info "Activating persistent LaunchAgents with launchd..."
  # The frontend agent serves dist/ and does not build (see install-startup.sh for why),
  # so refresh the bundle before handing over to launchd. This is also what makes
  # ./tools/mac/restart-services.sh pick up code changes.
  if ! build_frontend; then
    log_error "Production build failed; not loading the frontend agent."
    exit 1
  fi
  launchctl load -w "${BACKEND_PLIST}" 2>/dev/null || true
  launchctl load -w "${FRONTEND_PLIST}" 2>/dev/null || true
  sleep 2
else
  # 1. Start Backend Streaming Service
  "${SCRIPT_DIR}/start-backend.sh"

  # 2. Start Frontend Web Server
  "${SCRIPT_DIR}/start-frontend.sh"
fi

LOCAL_IP="$(get_local_ip)"
TAILSCALE_IP="$(get_tailscale_ip)"

# Detect actual port in use for frontend (3000 or 3001)
ACTIVE_PORT=3000
if ! check_frontend_health 3000 && check_frontend_health 3001; then
  ACTIVE_PORT=3001
fi

echo ""
echo -e "${BOLD}${GREEN}✔ All Market Rewind services are running!${NC}"
echo -e "${BOLD}------------------------------------------------------${NC}"
echo -e "  ${BOLD}Local Machine:${NC}      ${CYAN}http://localhost:${ACTIVE_PORT}${NC}"
if [ -n "${LOCAL_IP}" ] && [ "${LOCAL_IP}" != "localhost" ]; then
  echo -e "  ${BOLD}Home Wi-Fi (Tablet):${NC} ${CYAN}http://${LOCAL_IP}:${ACTIVE_PORT}${NC}"
fi
if [ -n "${TAILSCALE_IP}" ]; then
  echo -e "  ${BOLD}Tailscale (Remote):${NC}  ${CYAN}http://${TAILSCALE_IP}:${ACTIVE_PORT}${NC}"
fi
echo -e "  ${BOLD}Streaming Backend:${NC}  ${CYAN}http://localhost:${BACKEND_PORT}/api/status${NC}"
echo -e "  ${BOLD}Logs Directory:${NC}     ${YELLOW}${LOG_DIR}${NC}"
echo -e "${BOLD}------------------------------------------------------${NC}"
echo -e "To view live status:   ${BOLD}./tools/mac/status-services.sh${NC}"
echo -e "To stop services:      ${BOLD}./tools/mac/stop-services.sh${NC}"
echo ""
