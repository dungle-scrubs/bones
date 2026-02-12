---
name: bones
description: Round-based competitive code review. Configurable hunt prompt - bugs, doc drift, security issues, and more. Hunt → Review → Score until target reached.
allowed-tools: Task, Read, Bash, Grep, Glob, TodoWrite
---

# Bones Game v4

**Adversarial round-based competition.** Agents hunt for issues (configurable), then attack each other's submissions.

## Hunt Categories

Built-in categories with curated context (what counts, what doesn't):

| Category | Flag | Description |
|----------|------|-------------|
| `bugs` (default) | `-c bugs` | Real, demonstrable bugs. Excludes: unused imports, style issues |
| `doc_drift` | `-c doc_drift` | Docs that contradict code. Excludes: missing docs, typos |
| `security` | `-c security` | Security vulnerabilities with exploit paths |
| `test_coverage` | `-c test_coverage` | Untested code paths |
| `tech_debt` | `-c tech_debt` | Dead code, duplication, complexity |
| `custom` | `-c custom` | Full control, no built-in exclusions |

Each category has:
- **Valid examples**: What counts as a finding
- **Exclusions**: What does NOT count (auto-rejected)
- **Referee guidance**: How validators judge findings

## Game Phases

1. **HUNT** - Find issues (be careful - they'll be scored and reviewed)
2. **HUNT_SCORING** - Referee validates findings (+1 valid, -2 false)
3. **REVIEW** - Attack other agents' validated findings (dispute false decisions)
4. **REVIEW_SCORING** - Referee resolves disputes (+2 won, -1 lost)
5. Repeat until winner

**Scoring happens AFTER each phase.** Agents see validation results before review, so they can dispute unfair calls.

## Scoring

| Event | Points |
|-------|--------|
| Valid unique finding | +1 |
| **False positive** | **-2** |
| Duplicate | -3 |
| **Successful dispute** | **+2** |
| Failed dispute | -1 |

**Key insight:** Catching a false positive is worth +2 to you AND costs them -2. That's a 4-point swing. Review phase is where games are won.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `--category, -c` | bugs | Hunt category (see table above) |
| `--focus, -f` | (none) | Additional focus within category |
| `--prompt, -p` | (none) | Legacy: sets custom category with full prompt |
| `--agents, -a` | 3 | Number of competing agents |
| `--target, -t` | 10 | Points to win |
| `--hunt-duration, -h` | 300 | Hunt phase duration (seconds) |
| `--review-duration, -r` | 180 | Review phase duration (seconds) |

## Plugin Paths

```
PLUGIN_ROOT: ~/dev/claude-plugins/games
SKILL: ${PLUGIN_ROOT}/skills/bones
CLI: node ${SKILL}/dist/index.js
```

---

## Game Flow

The CLI handles all game logic and outputs fully-rendered prompts.

### Setup

```bash
cd ~/dev/claude-plugins/games/skills/bones

# Default bug hunt
node dist/index.js setup https://github.com/example/repo

# Custom hunt prompt
node dist/index.js setup https://github.com/example/repo \
  --prompt "Find documentation that doesn't match code behavior"

# Full options
node dist/index.js setup https://github.com/example/repo \
  --prompt "Find security vulnerabilities" \
  --target 15 \
  --agents 4 \
  --hunt-duration 300 \
  --review-duration 180

# Returns: { gameId, agents, config, next: "start-hunt ..." }
# SAVE THE GAME_ID - you need it for all subsequent commands
```

### Game Loop

Each command returns fully-rendered prompts and next steps.

```bash
CLI="node ~/dev/claude-plugins/games/skills/bones/dist/index.js"

# 1. HUNT PHASE
${CLI} start-hunt "${GAME_ID}"
# → Spawn agents with hunt prompts
# → Poll check-hunt until ready

# 2. HUNT SCORING
${CLI} start-hunt-scoring "${GAME_ID}"
# → Spawn referees (opus) for each finding
# → Parse verdict, run validate for each

# 3. REVIEW PHASE
${CLI} start-review "${GAME_ID}"
# → Spawn agents with review prompts (they see validated findings)
# → Poll check-review until ready

# 4. REVIEW SCORING
${CLI} start-review-scoring "${GAME_ID}"
# → Spawn referees for each dispute
# → Parse verdict, run resolve for each

# 5. CHECK WINNER
${CLI} check-winner "${GAME_ID}"
# → If CONTINUE: go back to step 1 AUTOMATICALLY (never ask user)
# → If GAME_COMPLETE: done

# IMPORTANT: Never stop to ask the user if they want to continue.
# Always auto-continue until the game ends naturally (winner or max rounds).
```

### CLI Commands

```bash
# SETUP
setup <url> [options]

# GAME LOOP (run in order)
start-hunt <game_id>           # Get hunt agent prompts
check-hunt <game_id>           # Poll until ready
start-hunt-scoring <game_id>   # Get referee prompts for findings
validate <game_id> <finding_id> <VALID|FALSE|DUPLICATE> <explanation> [dup_id]
start-review <game_id>         # Get review agent prompts
check-review <game_id>         # Poll until ready
start-review-scoring <game_id> # Get referee prompts for disputes
resolve <game_id> <dispute_id> <SUCCESSFUL|FAILED> <explanation>
check-winner <game_id>         # Continue or end game

# AGENT COMMANDS (used by spawned agents)
submit <game_id> <agent_id> <file> <start> <end> <description> [snippet]
dispute <game_id> <agent_id> <finding_id> <reason>
done <game_id> <agent_id> <hunt|review>

# QUERY
status <game_id>               # Current game state
findings <game_id>             # List all findings
disputes <game_id>             # List all disputes

# TERMINAL UI
ui <game_id>                   # Live-updating terminal dashboard
```

### Spawning Agents

The CLI returns fully-rendered prompts. Just spawn them:

```
For each agent in result.agents:
    Use Task tool:
      - subagent_type: "general-purpose"
      - prompt: agent.prompt  # Already rendered, ready to use
```

For referees (scoring phase):
```
For each validation in result.findingValidations:
    Use Task tool:
      - subagent_type: "general-purpose"
      - model: "opus"  # Deep analysis
      - prompt: validation.prompt
    Parse "VERDICT: VALID" or "VERDICT: FALSE" from response
    Run: ${CLI} validate <game_id> <finding_id> <verdict> "<explanation>"
```

### Phase Timing

Each phase has a duration (default: 5min hunt, 3min review).
- Agents work until timer expires
- Agents call `done` when finished
- Phase transitions when timer expired OR all agents signaled

### Terminal UI

Monitor game progress with a live-updating terminal dashboard:

```bash
node dist/index.js ui <game_id>
```

Displays:
- Game round, phase, countdown timer
- Agent scoreboard (score, valid/false/duplicate counts)
- Activity feed (recent submissions)

Press `q` to exit.

---

## Tie Breaking

1. Multiple agents reach target in same round
2. Highest score wins
3. If still tied: Continue rounds with only tied agents

---

## Example Game

```
/games:bones --target 10

Round 1:
  Hunt: Spawn 3 agents → each finds issues → calls done
  Review: Spawn 3 agents → review others' findings → calls done
  Score: Referee validates 12 findings, resolves 3 disputes
  Standings: A1=3, A2=2, A3=4

Round 2:
  Hunt: Agents spawn with scoreboard showing A3 leads
  Review: A2 disputes A3's finding (suspects false positive)
  Score: Dispute successful! A2 gets +2
  Standings: A1=4, A2=7, A3=5

Round 3:
  Hunt: A2 plays conservatively (in the lead)
  Review: A1 and A3 target A2's findings
  Score: One of A2's findings was false (-2)
  Standings: A1=8, A2=8, A3=7

Round 4:
  Hunt: A1 and A2 both find 3 valid issues
  Review: Minimal disputes
  Score: A1 reaches 11 first (by submission time)
  Winner: A1
```

---

## Category Examples

```bash
# Bug hunting (default)
node dist/index.js setup https://github.com/example/repo

# Bug hunting with focus
node dist/index.js setup https://github.com/example/repo \
  --category bugs --focus "Focus on authentication and payment handling"

# Documentation drift
node dist/index.js setup https://github.com/example/repo \
  --category doc_drift

# Security audit
node dist/index.js setup https://github.com/example/repo \
  --category security

# Test coverage gaps
node dist/index.js setup https://github.com/example/repo \
  --category test_coverage

# Custom (full control, no built-in exclusions)
node dist/index.js setup https://github.com/example/repo \
  --prompt "Review this PR for any issues: bugs, style, tests, performance"
```

### Conflict Detection

If your `--focus` prompt conflicts with category exclusions, the CLI returns `CLARIFICATION_NEEDED`:

```json
{
  "action": "CLARIFICATION_NEEDED",
  "conflicts": [{
    "exclusion": "Unused imports or variables (linter responsibility)",
    "matchedKeywords": ["unused", "imports"],
    "promptExcerpt": "...find unused imports..."
  }]
}
```

Options:
1. Remove conflicting text from `--focus`
2. Use `--category custom` for full control
3. Keep both (referee will likely reject those findings)
