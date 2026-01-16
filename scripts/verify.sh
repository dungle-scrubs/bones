#!/bin/bash
# Verify a finding: verify.sh <game_id> <finding_id> <CONFIRM|REJECT> "<explanation>" [corrected_category]
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/../dist/index.js" verify "$@"
