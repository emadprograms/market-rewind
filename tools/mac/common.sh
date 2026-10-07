#!/usr/bin/env bash
# ==============================================================================
# Market Rewind macOS Scripts - Common Environment & Helper Library
# ==============================================================================

# Find repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Safeguard: If invoked inside a temporary git worktree, resolve canonical main repository root
if git -C "${REPO_ROOT}" rev-parse --git-common-dir >/dev/null 2>&1; then
  COMMON_DIR="$(git -C "${REPO_ROOT}" rev-parse --git-common-dir)"
  if [ -n "${COMMON_DIR}" ] && [ -d "${COMMON_DIR}" ]; then
    CANONICAL_ROOT="$(cd "${COMMON_DIR}/.." && pwd)"
    if [ -f "${CANONICAL_ROOT}/package.json" ]; then
      REPO_ROOT="${CANONICAL_ROOT}"
    fi
  fi
fi

# Runtime state directories
RUN_DIR="${REPO_ROOT}/.run"
LOG_DIR="${HOME}/Library/Logs/MarketRewind"
PROJECT_LOG_DIR="${REPO_ROOT}/logs"

mkdir -p "${RUN_DIR}" "${LOG_DIR}" "${PROJECT_LOG_DIR}"

# PID files
BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"

# LaunchAgent Plist paths
BACKEND_PLIST="${HOME}/Library/LaunchAgents/com.marketrewind.backend.plist"
FRONTEND_PLIST="${HOME}/Library/LaunchAgents/com.marketrewind.frontend.plist"

# Default ports
BACKEND_PORT=8765
FRONTEND_PORT=3000

# ANSI color codes
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logger helpers
log_info() {
  echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Build the production bundle into dist/.
#
# Kept out of the LaunchAgent on purpose: launchd runs the frontend as a direct binary
# (see install-startup.sh) because macOS TCC refuses to let a launchd-spawned /bin/bash
# run a script that lives under ~/Documents ("Operation not permitted"). So the bundle is
# built HERE, by a script the user runs in their own session, and the agent only serves it.
#
# Callers: install-startup.sh (before loading the agent) and start-services.sh.
build_frontend() {
  local node_bin vite_bin
  node_bin="$(resolve_node)"
  vite_bin="${REPO_ROOT}/node_modules/vite/bin/vite.js"
  if [ ! -f "${vite_bin}" ]; then
    vite_bin="${REPO_ROOT}/node_modules/.bin/vite"
  fi
  if [ ! -e "${vite_bin}" ]; then
    log_error "Vite not found (looked for node_modules/vite/bin/vite.js and node_modules/.bin/vite)."
    log_error "Run 'npm install' in ${REPO_ROOT} first."
    return 1
  fi

  log_info "Building production bundle..."
  if ! (cd "${REPO_ROOT}" && "${node_bin}" "${vite_bin}" build >"${LOG_DIR}/frontend.build.log" 2>&1); then
    log_error "Production build failed. See ${LOG_DIR}/frontend.build.log"
    tail -n 15 "${LOG_DIR}/frontend.build.log"
    return 1
  fi
  log_success "Production bundle built."
  return 0
}

# Resolve Python executable with DuckDB & aiohttp support
resolve_python() {
  if [ -x "${REPO_ROOT}/.venv/bin/python" ]; then
    echo "${REPO_ROOT}/.venv/bin/python"
    return 0
  fi

  if [ -x "${REPO_ROOT}/../data-harvester/.venv/bin/python" ]; then
    echo "${REPO_ROOT}/../data-harvester/.venv/bin/python"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    if python3 -c "import duckdb, aiohttp" >/dev/null 2>&1; then
      command -v python3
      return 0
    fi
  fi

  # Fallback to homebrew python3 if available
  if [ -x "/opt/homebrew/bin/python3" ]; then
    echo "/opt/homebrew/bin/python3"
    return 0
  fi

  command -v python3 || echo "python3"
}

# Resolve Node.js binary
resolve_node() {
  if [ -x "/opt/homebrew/bin/node" ]; then
    echo "/opt/homebrew/bin/node"
  elif [ -x "/usr/local/bin/node" ]; then
    echo "/usr/local/bin/node"
  else
    command -v node || echo "node"
  fi
}

# Resolve npm binary
resolve_npm() {
  if [ -x "/opt/homebrew/bin/npm" ]; then
    echo "/opt/homebrew/bin/npm"
  elif [ -x "/usr/local/bin/npm" ]; then
    echo "/usr/local/bin/npm"
  else
    command -v npm || echo "npm"
  fi
}

# Get local LAN Wi-Fi IP address
get_local_ip() {
  ipconfig getifaddr en0 2>/dev/null || ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1 || echo "localhost"
}

# Get Tailscale IP address if available
get_tailscale_ip() {
  if command -v tailscale >/dev/null 2>&1; then
    tailscale ip -4 2>/dev/null || echo ""
  else
    ifconfig 2>/dev/null | grep -A 2 "utun" | grep "inet 100\." | awk '{print $2}' | head -n 1 || echo ""
  fi
}

# Check if a process is alive by PID
is_pid_alive() {
  local pid="$1"
  [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null
}

# Check backend health
check_backend_health() {
  curl -s -m 2 "http://127.0.0.1:${BACKEND_PORT}/api/status" >/dev/null 2>&1
}

# Check frontend health
check_frontend_health() {
  local port="${1:-${FRONTEND_PORT}}"
  curl -s -m 2 "http://127.0.0.1:${port}" >/dev/null 2>&1
}
