# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup (installs all deps including dashboard)
bun src/cli.ts init

# Development
bun run dev                 # Run CLI with bun (no build needed)
bun run build               # Compile TypeScript to dist/
bun run serve               # Run API server with bun

# Testing
bun test                    # Run all tests
bun test --watch            # Watch mode
bun test src/domain/Finding.test.ts  # Single test file

# Lint/Format
bun run lint                # Check with Biome
bun run lint:fix            # Auto-fix
```

## Architecture

Bones is a competitive multi-agent code review game. Agents hunt for issues (bugs, security, doc drift, etc.), then review each other's findings. A referee validates findings and resolves disputes.

### Runtime & Toolchain

- **Runtime**: Bun (test runner, SQLite via `bun:sqlite`, server via `Bun.serve`)
- **CLI**: Commander (subcommands with typed options)
- **Database**: `bun:sqlite` (zero-dep, native SQLite)
- **API server**: Hono (Bun-native, no `@hono/node-server`)
- **Tests**: `bun:test` (describe/it/expect)

### Game Flow State Machine

```
Setup → Hunt → HuntScoring → Review → ReviewScoring → (loop or Complete)
```

- **Hunt**: Agents search codebase for issues, submit findings
- **HuntScoring**: Referee validates each finding (VALID/FALSE/DUPLICATE)
- **Review**: Agents dispute other agents' valid findings
- **ReviewScoring**: Referee resolves disputes (SUCCESSFUL/FAILED)
- **Loop**: If no winner, start next round; otherwise Complete

### Key Components

**Orchestrator** (`src/services/Orchestrator.ts`): Central coordinator. All CLI commands route through here. Manages phase transitions, coordinates repositories, and provides history/diff queries.

**GameRunner** (`src/services/GameRunner.ts`): Drives the autonomous game loop. Wraps all LLM agent calls in exponential backoff retry (via RetryPolicy). Auto-exports results and writes `summary.json` on completion or crash.

**Scorer** (`src/services/Scorer.ts`): Handles point calculations in transactions. Finding validation and dispute resolution both update agent scores atomically.

**PromptRenderer** (`src/services/PromptRenderer.ts`): Generates prompts for hunt agents, review agents, and referee validations. Each prompt type has specific variables.

**RetryPolicy** (`src/services/RetryPolicy.ts`): Exponential backoff with jitter for transient API errors (429, 500, 503). Used by GameRunner for all agent spawns.

**NotificationHook** (`src/services/NotificationHook.ts`): Dispatches completion notifications. Supports shell commands (`--on-complete`) with `BONES_*` env vars, and built-in sinks (`--notify stdout`, `--notify file:<path>`).

**Scheduler** (`src/services/Scheduler.ts`): Generates platform-specific scheduling config. macOS → launchd plists, Linux → cron entries. Includes wrapper scripts with log rotation.

**Domain Models** (`src/domain/`):
- `Game`: Phase state machine, timer management
- `Finding`: Bug submission with duplicate detection (pattern hash + similarity scoring)
- `Dispute`: Challenge to a finding
- `Agent`: Score tracking, phase completion flags

**Repositories** (`src/repository/`): SQLite persistence via `bun:sqlite`. Each domain model has a corresponding repository.

### Scoring

```
VALID_FINDING: +1    FALSE_FLAG: -2    DUPLICATE: -3
DISPUTE_WON: +2      DISPUTE_LOST: -1
```

### Finding Classification Taxonomy

Every finding is classified along multiple dimensions:

**For VALID findings:**
- `issueType`: Category-specific (e.g., `logic_error`, `broken_example`, `injection`)
- `impactTier`: `critical` | `major` | `minor`
- `confidenceScore`: 0-100

**For FALSE findings:**
- `rejectionReason`: Why rejected (`defensive_suggestion`, `unreachable_path`, `speculative`, etc.)

Issue types are defined per hunt category in `ISSUE_TYPES_BY_CATEGORY` (types.ts).

### Verification Flow

Low-confidence validations can trigger a second-pass verification agent:
1. Referee marks finding VALID with `needsVerification: true`
2. Finding enters `VerificationStatus.Pending` (no points yet)
3. Verifier confirms or overrides
4. Points awarded only after verification

### Entry Points

- **CLI**: `src/cli.ts` (commander) → `src/cli/commands.ts` → Orchestrator
- **API**: `src/server.ts` (Hono, port 8019) for dashboard
- **Dashboard**: `apps/dashboard/` (Next.js, port 3019)

### Headless / Scheduled Mode

Games auto-export on completion (or crash) and write `summary.json` to `~/.bones/logs/<game_id>/`. Exit codes: 0 = success, 1 = error, 2 = no findings.

**CLI flags:**
- `--on-complete <cmd>` — Shell command with `BONES_*` env vars
- `--notify stdout|file:<path>` — Built-in notification sinks

**History commands:**
- `bones history [project]` — list past games for a project
- `bones diff <id1> <id2>` — compare findings across runs (new/resolved/recurring)
- `bones schedule [project]` — generate launchd/cron scheduling config

**API endpoints:**
- `GET /api/games?project=<path>` — filter games by project
- `GET /api/diff?game1=<id>&game2=<id>` — compare two runs

### Hunt Categories

Built-in categories with curated prompts: `bugs`, `doc_drift`, `security`, `test_coverage`, `tech_debt`, `custom`. Each has:
- Category-specific issue types (`BugIssueType`, `DocDriftIssueType`, etc.)
- Acceptance criteria in `src/domain/acceptance-criteria.ts`
- Validation guidance in prompts
