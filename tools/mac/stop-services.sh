#!/usr/bin/env bash
# ==============================================================================
# Stop All Market Rewind Services (Backend + Frontend)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

echo -e "${BOLD}${YELLOW}Stopping Market Rewind Services...${NC}"

# 1. Stop Frontend
"${SCRIPT_DIR}/stop-frontend.sh"

# 2. Stop Backend
"${SCRIPT_DIR}/stop-backend.sh"

echo -e "${BOLD}${GREEN}✔ All Market Rewind services have been stopped.${NC}"
