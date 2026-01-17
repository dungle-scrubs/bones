# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup (installs all deps including dashboard)
node dist/index.js init

# Development
pnpm dev                    # Run CLI with tsx (no build needed)
pnpm build                  # Compile TypeScript to dist/
pnpm serve                  # Run API server with tsx

# Testing
pnpm test                   # Run all tests
pnpm test:watch             # Watch mode
pnpm vitest src/domain/Finding.test.ts  # Single test file

# Lint/Format
pnpm lint                   # Check with Biome
pnpm lint:fix               # Auto-fix
```

## Architecture

Code Hunt is a competitive multi-agent code review game. Agents hunt for issues (bugs, security, doc drift, etc.), then review each other's findings. A referee validates findings and resolves disputes.

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

**Orchestrator** (`src/services/Orchestrator.ts`): Central coordinator. All CLI commands route through here. Manages phase transitions and coordinates repositories.

**Scorer** (`src/services/Scorer.ts`): Handles point calculations in transactions. Finding validation and dispute resolution both update agent scores atomically.

**PromptRenderer** (`src/services/PromptRenderer.ts`): Generates prompts for hunt agents, review agents, and referee validations. Each prompt type has specific variables.

**Domain Models** (`src/domain/`):
- `Game`: Phase state machine, timer management
- `Finding`: Bug submission with duplicate detection (pattern hash + similarity scoring)
- `Dispute`: Challenge to a finding
- `Agent`: Score tracking, phase completion flags

**Repositories** (`src/repository/`): SQLite persistence via better-sqlite3. Each domain model has a corresponding repository.

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

- **CLI**: `src/index.ts` → `src/cli/commands.ts` → Orchestrator
- **API**: `src/server.ts` (Hono, port 8019) for dashboard
- **Dashboard**: `apps/dashboard/` (Next.js, port 3019)

### Hunt Categories

Built-in categories with curated prompts: `bugs`, `doc_drift`, `security`, `test_coverage`, `tech_debt`, `custom`. Each has:
- Category-specific issue types (`BugIssueType`, `DocDriftIssueType`, etc.)
- Acceptance criteria in `src/domain/acceptance-criteria.ts`
- Validation guidance in prompts
