#!/usr/bin/env bash
# ==============================================================================
# Start Market Rewind Frontend Web Application
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

FOREGROUND=false
if [ "${1:-}" = "--foreground" ] || [ "${1:-}" = "-f" ]; then
  FOREGROUND=true
fi

# Check if already running on port
if lsof -ti :${FRONTEND_PORT} >/dev/null 2>&1; then
  EXISTING_PID=$(lsof -ti :${FRONTEND_PORT} | head -n 1)
  if [ "${FOREGROUND}" = true ]; then
    log_warn "Port ${FRONTEND_PORT} occupied by PID ${EXISTING_PID}. Terminating old process so foreground runner can bind..."
    kill -9 "${EXISTING_PID}" 2>/dev/null || true
    sleep 1
  elif check_frontend_health "${FRONTEND_PORT}"; then
    log_warn "Frontend is already running on port ${FRONTEND_PORT} (PID ${EXISTING_PID})."
    echo "${EXISTING_PID}" > "${FRONTEND_PID_FILE}"
    exit 0
  else
    log_warn "Port ${FRONTEND_PORT} is occupied by PID ${EXISTING_PID}, but not responding. Stopping old process..."
    kill -9 "${EXISTING_PID}" 2>/dev/null || true
    sleep 1
  fi
fi

NODE_BIN="$(resolve_node)"
NPM_BIN="$(resolve_npm)"
export PATH="$(dirname "${NODE_BIN}"):$(dirname "${NPM_BIN}"):${PATH}"

LOG_OUT="${LOG_DIR}/frontend.log"
LOG_ERR="${LOG_DIR}/frontend.error.log"

cd "${REPO_ROOT}"

VITE_BIN="${REPO_ROOT}/node_modules/vite/bin/vite.js"
if [ ! -f "${VITE_BIN}" ]; then
  VITE_BIN="${REPO_ROOT}/node_modules/.bin/vite"
fi

if [ "${FOREGROUND}" = true ]; then
  echo "$$" > "${FRONTEND_PID_FILE}"
  log_info "Starting Market Rewind Frontend in foreground on port ${FRONTEND_PORT}..."
  exec "${NODE_BIN}" "${VITE_BIN}" --host 0.0.0.0 --port "${FRONTEND_PORT}"
else
  log_info "Starting Market Rewind Frontend in background on port ${FRONTEND_PORT}..."
  nohup "${NODE_BIN}" "${VITE_BIN}" --host 0.0.0.0 --port "${FRONTEND_PORT}" \
    </dev/null >> "${LOG_OUT}" 2>> "${LOG_ERR}" &

  FRONTEND_PID=$!
  disown "${FRONTEND_PID}" 2>/dev/null || true
  echo "${FRONTEND_PID}" > "${FRONTEND_PID_FILE}"

  # Wait for startup health check (up to 15 seconds)
  log_info "Waiting for frontend dev server to initialize..."
  READY=false
  for i in {1..30}; do
    if check_frontend_health "${FRONTEND_PORT}"; then
      READY=true
      break
    fi
    # In case port 3000 was busy and vite chose 3001
    if check_frontend_health 3001; then
      READY=true
      FRONTEND_PORT=3001
      break
    fi
    sleep 0.5
  done

  if [ "${READY}" = true ]; then
    log_success "Frontend started successfully on http://localhost:${FRONTEND_PORT}"
    log_info "Log files: ${LOG_OUT}"
  else
    log_error "Frontend server failed to respond after 15s. Check logs:"
    tail -n 15 "${LOG_ERR}"
    exit 1
  fi
fi
