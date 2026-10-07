#!/usr/bin/env bash
# ==============================================================================
# Stop Market Rewind DuckDB Streaming Backend Service
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

STOPPED=false

# If managed by launchd, unload first to prevent automatic restart
if launchctl list | grep -q "com.marketrewind.backend"; then
  log_info "Unloading backend LaunchAgent from launchctl..."
  launchctl unload "${BACKEND_PLIST}" 2>/dev/null || true
fi

# Try from PID file first
if [ -f "${BACKEND_PID_FILE}" ]; then
  PID=$(cat "${BACKEND_PID_FILE}" 2>/dev/null || echo "")
  if [ -n "${PID}" ] && is_pid_alive "${PID}"; then
    log_info "Stopping backend process (PID ${PID})..."
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
  rm -f "${BACKEND_PID_FILE}"
fi

# Also check for any process listening on the backend port
if lsof -ti :${BACKEND_PORT} >/dev/null 2>&1; then
  PORT_PIDS=$(lsof -ti :${BACKEND_PORT} | tr '\n' ' ')
  log_info "Stopping processes on port ${BACKEND_PORT}: ${PORT_PIDS}..."
  for p in ${PORT_PIDS}; do
    kill "${p}" 2>/dev/null || true
  done
  sleep 1
  for p in ${PORT_PIDS}; do
    kill -9 "${p}" 2>/dev/null || true
  done
  STOPPED=true
fi

if [ "${STOPPED}" = true ]; then
  log_success "Market Rewind Backend stopped."
else
  log_info "Backend was not running."
fi
