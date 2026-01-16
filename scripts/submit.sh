#!/bin/bash
# Submit a finding: submit.sh <game_id> <agent_id> <file_path> <line_start> <line_end> "<description>" [code_snippet]
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/../dist/index.js" submit "$@"
