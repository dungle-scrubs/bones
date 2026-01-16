#!/bin/bash
# Validate a finding: validate.sh <game_id> <finding_id> <VALID|FALSE|DUPLICATE> "<explanation>" [confidence] [duplicate_of_id]
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/../dist/index.js" validate "$@"
