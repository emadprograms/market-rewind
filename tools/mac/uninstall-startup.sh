#!/usr/bin/env bash
# ==============================================================================
# Uninstall Market Rewind macOS Background Startup
# Removes from macOS Login Items and cleans up LaunchAgents
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

APP_PATH="${SCRIPT_DIR}/MarketRewind.app"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"

BACKEND_LABEL="com.marketrewind.backend"
FRONTEND_LABEL="com.marketrewind.frontend"

BACKEND_PLIST="${LAUNCH_AGENTS_DIR}/${BACKEND_LABEL}.plist"
FRONTEND_PLIST="${LAUNCH_AGENTS_DIR}/${FRONTEND_LABEL}.plist"

echo -e "${BOLD}${YELLOW}======================================================${NC}"
echo -e "${BOLD}${YELLOW}   Uninstalling Market Rewind Auto-Startup on macOS   ${NC}"
echo -e "${BOLD}${YELLOW}======================================================${NC}"

# 1. Remove from macOS Login Items
log_info "Removing Market Rewind from macOS Login Items..."
osascript -e "tell application \"System Events\" to delete (every login item whose name is \"Market Rewind\" or name is \"MarketRewind\")" 2>/dev/null || true

# 2. Unload from launchd (if loaded)
log_info "Unloading any LaunchAgents..."
launchctl unload -w "${BACKEND_PLIST}" 2>/dev/null || true
launchctl unload -w "${FRONTEND_PLIST}" 2>/dev/null || true

# 3. Remove plist and applet files
log_info "Cleaning up configuration files..."
rm -f "${BACKEND_PLIST}" "${FRONTEND_PLIST}"
rm -rf "${APP_PATH}"

# 4. Stop running instances
"${SCRIPT_DIR}/stop-services.sh"

echo ""
log_success "Market Rewind automatic startup has been completely uninstalled."
log_info "The application will no longer start automatically at login."
log_info "You can still run it manually at any time using: ./tools/mac/start-services.sh"
echo ""
