# Bones — Competitive multi-agent code review game
#
# WHAT THIS PROJECT IS:
#   LLM agents compete to find bugs/issues in a codebase. Agents hunt for
#   issues, a referee validates findings, agents dispute each other's findings,
#   referee resolves disputes. First to target score wins.
#
# ARCHITECTURE:
#   - Runtime: Bun (test runner, SQLite via bun:sqlite, server via Bun.serve)
#   - CLI: Commander (src/cli.ts → src/cli/commands.ts)
#   - Database: bun:sqlite (zero-dep, native)
#   - API server: Hono on port 8019
#   - Dashboard: Next.js on port 3019 (apps/dashboard/)
#   - Agent framework: @mariozechner/pi-agent-core + pi-ai
#
# AUTH:
#   Two options for LLM API access:
#   - `bones login` → OAuth with Claude Pro/Max subscription (free with sub)
#   - `export ANTHROPIC_API_KEY=sk-...` → per-token API billing
#   Run `bones auth-status` to check current auth.
#
# GAME CATEGORIES:
#   bugs         — real, demonstrable bugs (crashes, logic errors, races)
#   security     — injection, auth bypass, secrets in code, SSRF
#   doc_drift    — docs/comments that don't match actual code
#   test_coverage — missing tests, untested edge cases, dead test code
#   tech_debt    — code smells, dead code, duplicated logic
#   custom       — your own prompt via --prompt "..."
#
# SCORING:
#   Valid finding: +1 | False flag: -2 | Duplicate: -3
#   Dispute won: +2  | Dispute lost: -1
#
# GAME FLOW:
#   Setup → Hunt → HuntScoring → Review → ReviewScoring → (loop or Complete)
#
# KEY FILES:
#   src/cli.ts                    — CLI entry point (commander)
#   src/cli/commands.ts           — All command handlers
#   src/services/Orchestrator.ts  — Thin facade over PhaseCoordinator + SubmissionService
#   src/services/GameRunner.ts    — Autonomous game loop (bones play)
#   src/agents/AgentFactory.ts    — Creates pi-agent-core agents per role
#   src/agents/AgentRunner.ts     — Runs agent to completion with usage tracking
#   src/agents/tools/             — hunt, review, referee, verifier, shared tools
#   src/repository/               — SQLite persistence (Game, Agent, Finding, Dispute)
#   src/server.ts                 — Hono API server for dashboard
#   apps/dashboard/               — Next.js web UI

# ─── Development ──────────────────────────────────────────────

# Install all dependencies (root + dashboard)
init:
    bones init

# Build TypeScript to dist/
build:
    bun run build

# Run all tests (bun:test)
test:
    bun test

# Run tests in watch mode
test-watch:
    bun test --watch

# Type-check without emitting
typecheck:
    bun run typecheck

# Lint with Biome
lint:
    bun run lint

# Lint and auto-fix
lint-fix:
    bun run lint:fix

# Build, test, lint, typecheck — full CI check
check: build test lint typecheck

# ─── Auth ─────────────────────────────────────────────────────

# Login with Claude Pro/Max subscription (OAuth)
login:
    bones login

# Check authentication status
auth-status:
    bones auth-status

# Remove saved OAuth credentials
logout:
    bones logout

# ─── Play games ───────────────────────────────────────────────

# Run a quick game against a project (2 agents, target 3, 1 round)
# Usage: just play /path/to/project
play project:
    bones play "{{project}}" -c bugs -a 2 -t 3 -m 1

# Run a game with a specific category
# Usage: just play-cat /path/to/project security
play-cat project category:
    bones play "{{project}}" -c "{{category}}" -a 2 -t 3 -m 1

# Run a full game (3 agents, target 10, 3 rounds — default settings)
play-full project:
    bones play "{{project}}"

# Run with custom prompt
# Usage: just play-custom /path/to/project "Find all SQL injection vectors"
play-custom project prompt:
    bones play "{{project}}" -c custom -p "{{prompt}}" -a 2 -t 3 -m 1

# ─── Play games (JSON output for LLM agents) ─────────────────

# Run a quick game with NDJSON output (no TUI)
# Usage: just play-json /path/to/project
play-json project:
    bones play "{{project}}" -c bugs -a 2 -t 3 -m 1 --output json

# Run a game with NDJSON output and specific category
# Usage: just play-json-cat /path/to/project security
play-json-cat project category:
    bones play "{{project}}" -c "{{category}}" -a 2 -t 3 -m 1 --output json

# Run a full game with NDJSON output
play-json-full project:
    bones play "{{project}}" --output json

# ─── Dashboard ────────────────────────────────────────────────

# Start API server (port 8019) — needed for dashboard
serve:
    bun run serve

# Start dashboard frontend (port 3019) — run `just serve` first
dashboard:
    cd apps/dashboard && bun dev

# Start both API server and dashboard
web:
    #!/usr/bin/env bash
    echo "Starting API server on :8019..."
    bun src/server.ts &
    API_PID=$!
    sleep 1
    echo "Starting dashboard on :3019..."
    cd apps/dashboard && bun dev &
    DASH_PID=$!
    echo ""
    echo "  API:       http://localhost:8019"
    echo "  Dashboard: http://localhost:3019"
    echo ""
    echo "Press Ctrl+C to stop both."
    trap "kill $API_PID $DASH_PID 2>/dev/null" EXIT
    wait

# ─── Game inspection ──────────────────────────────────────────

# Show game status and scoreboard
# Usage: just status bones-abc123
status game_id:
    bones status "{{game_id}}"

# List all findings for a game
findings game_id:
    bones findings "{{game_id}}"

# List all disputes for a game
disputes game_id:
    bones disputes "{{game_id}}"

# Export game findings to ~/.bones/logs/
export game_id:
    bones export "{{game_id}}"

# Launch interactive terminal UI for a game
ui game_id:
    bones ui "{{game_id}}"

# ─── Cleanup ──────────────────────────────────────────────────

# Remove build artifacts
clean:
    rm -rf dist

# Remove all game databases (keeps auth)
clean-games:
    rm -f ~/.bones/*.db
