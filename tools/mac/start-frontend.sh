#!/usr/bin/env bash
# ==============================================================================
# Start Market Rewind Frontend Web Application
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

# Serving mode.
#   prod (default) — build once and serve the bundled output. The tablet fetches a single
#                    ~460 kB asset instead of the dev server's per-module request
#                    waterfall, which is the dominant cost of a cold load over Wi-Fi.
#   dev            — Vite dev server with hot reload, for local development. Much slower
#                    to load on a remote device; use it when editing, not when presenting.
FOREGROUND=false
SERVE_MODE="prod"
for arg in "$@"; do
  case "${arg}" in
    --foreground|-f) FOREGROUND=true ;;
    --dev)  SERVE_MODE="dev" ;;
    --prod) SERVE_MODE="prod" ;;
  esac
done

# Check if already running on port
if lsof -ti :${FRONTEND_PORT} >/dev/null 2>&1; then
  EXISTING_PID=$(lsof -ti :${FRONTEND_PORT} | head -n 1)
  if check_frontend_health "${FRONTEND_PORT}"; then
    log_warn "Frontend is already running on port ${FRONTEND_PORT} (PID ${EXISTING_PID})."
    # Health is a bare TCP/HTTP probe, so a dev server satisfies it too. Say so rather
    # than letting the operator believe production mode took effect.
    log_warn "Not restarting it. If it was started in the other mode (prod vs dev), run"
    log_warn "  ${SCRIPT_DIR}/restart-services.sh"
    log_warn "to pick up the requested '${SERVE_MODE}' mode."
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

# In production mode the bundle must exist and be current before anything is served.
if [ "${SERVE_MODE}" = "prod" ]; then
  log_info "Building production bundle (this also keeps the served assets current)..."
  if ! (cd "${REPO_ROOT}" && "${NODE_BIN}" "${VITE_BIN}" build >"${LOG_DIR}/frontend.build.log" 2>&1); then
    log_error "Production build failed. See ${LOG_DIR}/frontend.build.log"
    tail -n 15 "${LOG_DIR}/frontend.build.log"
    exit 1
  fi
  log_success "Production bundle built."
  VITE_ARGS=(preview --host 0.0.0.0 --port "${FRONTEND_PORT}")
else
  log_warn "Dev mode: serving unbundled modules. Expect slow cold loads on the tablet."
  VITE_ARGS=(--host 0.0.0.0 --port "${FRONTEND_PORT}")
fi

if [ "${FOREGROUND}" = true ]; then
  log_info "Starting Market Rewind Frontend (${SERVE_MODE}) in foreground on port ${FRONTEND_PORT}..."
  exec "${NODE_BIN}" "${VITE_BIN}" "${VITE_ARGS[@]}"
else
  log_info "Starting Market Rewind Frontend (${SERVE_MODE}) in background on port ${FRONTEND_PORT}..."
  nohup "${NODE_BIN}" "${VITE_BIN}" "${VITE_ARGS[@]}" \
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
