#!/bin/bash
# Mark agent done: done.sh <game_id> <agent_id> <hunt|review>
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/../dist/index.js" done "$@"
