#!/usr/bin/env bash
# ==============================================================================
# Install Market Rewind as a macOS Background Application (Login Item & LaunchAgent)
# Automatically starts backend and frontend whenever you log in or Mac boots
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

APP_PATH="${SCRIPT_DIR}/MarketRewind.app"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
mkdir -p "${LAUNCH_AGENTS_DIR}" "${LOG_DIR}"

BACKEND_LABEL="com.marketrewind.backend"
FRONTEND_LABEL="com.marketrewind.frontend"

BACKEND_PLIST="${LAUNCH_AGENTS_DIR}/${BACKEND_LABEL}.plist"
FRONTEND_PLIST="${LAUNCH_AGENTS_DIR}/${FRONTEND_LABEL}.plist"

PYTHON_BIN="$(resolve_python)"
NODE_BIN="$(resolve_node)"
NODE_DIR="$(dirname "${NODE_BIN}")"
SYSTEM_PATH="${NODE_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

echo -e "${BOLD}${CYAN}======================================================${NC}"
echo -e "${BOLD}${CYAN}   Installing Market Rewind Auto-Startup on macOS     ${NC}"
echo -e "${BOLD}${CYAN}======================================================${NC}"

# ------------------------------------------------------------------------------
# 1. Compile Native macOS Background Launcher Applet (Fallback Login Item)
# ------------------------------------------------------------------------------
log_info "Building native macOS background launcher: ${APP_PATH}..."
rm -rf "${APP_PATH}"
osacompile -o "${APP_PATH}" -e "do shell script \"/bin/bash \\\"${SCRIPT_DIR}/start-services.sh\\\" > /dev/null 2>&1 &\""

# ------------------------------------------------------------------------------
# 2. Register as a macOS Login Item (Starts automatically on Mac login/boot)
# ------------------------------------------------------------------------------
log_info "Registering Market Rewind in macOS Login Items (System Settings)..."
osascript -e "tell application \"System Events\" to delete (every login item whose name is \"Market Rewind\" or name is \"MarketRewind\")" 2>/dev/null || true
osascript -e "tell application \"System Events\" to make login item at end with properties {name:\"Market Rewind\", path:\"${APP_PATH}\", hidden:true}" >/dev/null

log_success "Market Rewind registered in macOS Login Items!"

# ------------------------------------------------------------------------------
# 3. Create LaunchAgent plist files (24/7 Supervised & Persistent via launchd)
# ------------------------------------------------------------------------------
log_info "Writing LaunchAgent templates to ~/Library/LaunchAgents/..."
cat <<EOF > "${BACKEND_PLIST}"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${BACKEND_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON_BIN}</string>
        <string>${REPO_ROOT}/backend/streaming_service/server.py</string>
        <string>--host</string>
        <string>0.0.0.0</string>
        <string>--port</string>
        <string>${BACKEND_PORT}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_ROOT}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${SYSTEM_PATH}</string>
        <key>PYTHONPATH</key>
        <string>${REPO_ROOT}</string>
        <key>PYTHONUNBUFFERED</key>
        <string>1</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/backend.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/backend.error.log</string>
</dict>
</plist>
EOF

# The frontend job runs `node vite.js preview` directly rather than through a shell script.
#
# Why not start-frontend.sh: macOS TCC blocks a launchd-spawned /bin/bash from reaching a
# script under ~/Documents, so the agent dies immediately with
#   shell-init: error retrieving current directory: getcwd: ... Operation not permitted
#   /bin/bash: .../start-frontend.sh: Operation not permitted
# (reported on macOS 15, Mac mini M4, repo under ~/Documents). Executing node directly
# avoids the shell entirely, and is how this agent worked before.
#
# The trade: the agent cannot build, so dist/ must already be current. install-startup.sh
# and start-services.sh therefore both call build_frontend() BEFORE loading this agent.
# `preview` is what makes it serve the bundle -- drop it and the tablet is back on the
# unbundled dev server.
cat <<EOF > "${FRONTEND_PLIST}"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${FRONTEND_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${REPO_ROOT}/node_modules/vite/bin/vite.js</string>
        <string>preview</string>
        <string>--host</string>
        <string>0.0.0.0</string>
        <string>--port</string>
        <string>${FRONTEND_PORT}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_ROOT}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${SYSTEM_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/frontend.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/frontend.error.log</string>
</dict>
</plist>
EOF
chmod 644 "${BACKEND_PLIST}" "${FRONTEND_PLIST}"

# ------------------------------------------------------------------------------
# 4. Load LaunchAgents into launchd (24/7 Persistent & Auto-Restarting)
# ------------------------------------------------------------------------------
log_info "Registering and loading persistent LaunchAgents into launchd..."
launchctl unload -w "${BACKEND_PLIST}" 2>/dev/null || true
launchctl unload -w "${FRONTEND_PLIST}" 2>/dev/null || true

# Must happen before the frontend agent loads: the agent serves dist/ with `vite preview`
# and never builds, so an empty or stale dist/ means the tablet gets 404s or old code.
if ! build_frontend; then
  log_error "Refusing to load the frontend agent without a valid bundle."
  log_error "Fix the build error above, then re-run this script."
  exit 1
fi

launchctl load -w "${BACKEND_PLIST}"
launchctl load -w "${FRONTEND_PLIST}"

log_info "Waiting for services to become active under launchd supervision..."
sleep 2

LOCAL_IP="$(get_local_ip)"
TAILSCALE_IP="$(get_tailscale_ip)"

echo ""
log_success "Market Rewind is now configured as a persistent 24/7 service via launchd!"
log_info "Both backend and frontend will run continuously and automatically revive if terminated."
echo -e "  ${BOLD}Local Machine:${NC}      ${CYAN}http://localhost:3000${NC}"
if [ -n "${LOCAL_IP}" ] && [ "${LOCAL_IP}" != "localhost" ]; then
  echo -e "  ${BOLD}Home Wi-Fi (Tablet):${NC} ${CYAN}http://${LOCAL_IP}:3000${NC}"
fi
if [ -n "${TAILSCALE_IP}" ]; then
  echo -e "  ${BOLD}Tailscale (Remote):${NC}  ${CYAN}http://${TAILSCALE_IP}:3000${NC}"
fi
echo ""
