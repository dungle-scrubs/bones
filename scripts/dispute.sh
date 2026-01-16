#!/bin/bash
# Dispute a finding: dispute.sh <game_id> <agent_id> <finding_id> "<reason>"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/../dist/index.js" dispute "$@"
