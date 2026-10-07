#!/usr/bin/env bash
# ==============================================================================
# Start Market Rewind DuckDB Streaming Backend Service
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

FOREGROUND=false
if [ "${1:-}" = "--foreground" ] || [ "${1:-}" = "-f" ]; then
  FOREGROUND=true
fi

# Check if already running on port
if lsof -ti :${BACKEND_PORT} >/dev/null 2>&1; then
  EXISTING_PID=$(lsof -ti :${BACKEND_PORT} | head -n 1)
  if [ "${FOREGROUND}" = true ]; then
    log_warn "Port ${BACKEND_PORT} occupied by PID ${EXISTING_PID}. Terminating old process so foreground runner can bind..."
    kill -9 "${EXISTING_PID}" 2>/dev/null || true
    sleep 1
  elif check_backend_health; then
    log_warn "Backend is already running on port ${BACKEND_PORT} (PID ${EXISTING_PID})."
    echo "${EXISTING_PID}" > "${BACKEND_PID_FILE}"
    exit 0
  else
    log_warn "Port ${BACKEND_PORT} is occupied by PID ${EXISTING_PID}, but not responding to health check. Stopping old process..."
    kill -9 "${EXISTING_PID}" 2>/dev/null || true
    sleep 1
  fi
fi

PYTHON_BIN="$(resolve_python)"
log_info "Using Python interpreter: ${PYTHON_BIN}"

# Validate dependencies
if ! "${PYTHON_BIN}" -c "import duckdb, aiohttp" >/dev/null 2>&1; then
  log_error "The resolved Python (${PYTHON_BIN}) lacks required packages (duckdb, aiohttp)."
  log_info "Please ensure python packages are installed or ../data-harvester/.venv exists."
  exit 1
fi

LOG_OUT="${LOG_DIR}/backend.log"
LOG_ERR="${LOG_DIR}/backend.error.log"

export PYTHONPATH="${REPO_ROOT}"

if [ "${FOREGROUND}" = true ]; then
  echo "$$" > "${BACKEND_PID_FILE}"
  log_info "Starting Market Rewind Streaming Backend in foreground on port ${BACKEND_PORT}..."
  exec "${PYTHON_BIN}" "${REPO_ROOT}/backend/streaming_service/server.py" --host 0.0.0.0 --port "${BACKEND_PORT}"
else
  log_info "Starting Market Rewind Streaming Backend in background on port ${BACKEND_PORT}..."
  nohup "${PYTHON_BIN}" "${REPO_ROOT}/backend/streaming_service/server.py" \
    --host 0.0.0.0 --port "${BACKEND_PORT}" \
    </dev/null >> "${LOG_OUT}" 2>> "${LOG_ERR}" &

  BACKEND_PID=$!
  disown "${BACKEND_PID}" 2>/dev/null || true
  echo "${BACKEND_PID}" > "${BACKEND_PID_FILE}"

  # Wait for startup health check (up to 10 seconds)
  log_info "Waiting for streaming backend to initialize..."
  READY=false
  for i in {1..20}; do
    if check_backend_health; then
      READY=true
      break
    fi
    sleep 0.5
  done

  if [ "${READY}" = true ]; then
    log_success "Backend started successfully (PID: ${BACKEND_PID}) on http://localhost:${BACKEND_PORT}"
    log_info "Log files: ${LOG_OUT}"
  else
    log_error "Backend failed to respond to health check after 10s. Check logs:"
    tail -n 15 "${LOG_ERR}"
    exit 1
  fi
fi
