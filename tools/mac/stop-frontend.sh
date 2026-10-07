#!/usr/bin/env bash
# ==============================================================================
# Stop Market Rewind Frontend Web Application
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

STOPPED=false

# If managed by launchd, unload first to prevent automatic restart
if launchctl list | grep -q "com.marketrewind.frontend"; then
  log_info "Unloading frontend LaunchAgent from launchctl..."
  launchctl unload "${FRONTEND_PLIST}" 2>/dev/null || true
fi

# Try from PID file first
if [ -f "${FRONTEND_PID_FILE}" ]; then
  PID=$(cat "${FRONTEND_PID_FILE}" 2>/dev/null || echo "")
  if [ -n "${PID}" ] && is_pid_alive "${PID}"; then
    log_info "Stopping frontend process (PID ${PID})..."
    kill "${PID}" 2>/dev/null || true
    for i in {1..10}; do
      if ! is_pid_alive "${PID}"; then
        break
      fi
      sleep 0.5
    done
    if is_pid_alive "${PID}"; then
      log_warn "Process ${PID} did not terminate cleanly; sending SIGKILL..."
      kill -9 "${PID}" 2>/dev/null || true
    fi
    STOPPED=true
  fi
  rm -f "${FRONTEND_PID_FILE}"
fi

# Also check for any process listening on ports 3000 or 3001
for PORT in 3000 3001; do
  if lsof -ti :${PORT} >/dev/null 2>&1; then
    PORT_PIDS=$(lsof -ti :${PORT} | tr '\n' ' ')
    # Filter to only processes that look like node/vite in our repo
    for p in ${PORT_PIDS}; do
      CMD=$(ps -p "${p}" -o comm= 2>/dev/null || echo "")
      if echo "${CMD}" | grep -qi "node"; then
        log_info "Stopping frontend node process on port ${PORT} (PID ${p})..."
        kill "${p}" 2>/dev/null || true
        sleep 0.5
        kill -9 "${p}" 2>/dev/null || true
        STOPPED=true
      fi
    done
  fi
done

if [ "${STOPPED}" = true ]; then
  log_success "Market Rewind Frontend stopped."
else
  log_info "Frontend was not running."
fi
