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

NODE_DIR="$(dirname "$(resolve_node)")"
SYSTEM_PATH="${NODE_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

echo -e "${BOLD}${CYAN}======================================================${NC}"
echo -e "${BOLD}${CYAN}   Installing Market Rewind Auto-Startup on macOS     ${NC}"
echo -e "${BOLD}${CYAN}======================================================${NC}"

# ------------------------------------------------------------------------------
# 1. Compile Native macOS Background Launcher Applet
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
# 3. Create LaunchAgent plist files as well (for launchd reference)
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
        <string>/bin/bash</string>
        <string>${SCRIPT_DIR}/start-backend.sh</string>
        <string>--foreground</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_ROOT}</string>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${SYSTEM_PATH}</string>
        <key>PYTHONPATH</key>
        <string>${REPO_ROOT}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/backend.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/backend.error.log</string>
</dict>
</plist>
EOF

cat <<EOF > "${FRONTEND_PLIST}"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${FRONTEND_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${SCRIPT_DIR}/start-frontend.sh</string>
        <string>--foreground</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_ROOT}</string>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
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
# 4. Start Services Now
# ------------------------------------------------------------------------------
log_info "Starting Market Rewind services now..."
"${SCRIPT_DIR}/start-services.sh"

echo ""
log_success "Market Rewind will now start automatically whenever your Mac opens or logs in!"
echo ""
