#!/bin/bash
# Validate a finding: validate.sh <game_id> <finding_id> <VALID|FALSE|DUPLICATE> "<explanation>" <confidence_score:0-100> <bug_category> <needs_verification:true|false> [duplicate_of_id]
# Legacy format also supported: validate.sh <game_id> <finding_id> <verdict> "<explanation>" [confidence:high|medium|low] [duplicate_of_id]
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/../dist/index.js" validate "$@"
