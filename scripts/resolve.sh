#!/bin/bash
# Resolve a dispute: resolve.sh <game_id> <dispute_id> <SUCCESSFUL|FAILED> "<explanation>"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/../dist/index.js" resolve "$@"
