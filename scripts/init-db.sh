#!/bin/bash
# Initialize SQLite database for bug-hunt game

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DB_PATH="${PLUGIN_ROOT}/.data/bugs.db"
SCHEMA_PATH="${SCRIPT_DIR}/schema.sql"

mkdir -p "$(dirname "$DB_PATH")"

if [ ! -f "$DB_PATH" ]; then
    sqlite3 "$DB_PATH" < "$SCHEMA_PATH"
    echo "Database initialized at $DB_PATH"
else
    echo "Database already exists at $DB_PATH"
fi
