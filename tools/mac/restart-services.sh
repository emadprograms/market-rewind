#!/usr/bin/env bash
# ==============================================================================
# Restart All Market Rewind Services
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/stop-services.sh"
sleep 2
"${SCRIPT_DIR}/start-services.sh"
