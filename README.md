<p align="center">
  <img src="assets/icon-color-navy-gold_01.jpg" width="200" height="200" alt="Bones" />
</p>

<h1 align="center">Bones</h1>

<p align="center">
  <a href="https://github.com/dungle-scrubs/bones/actions/workflows/ci.yml"><img src="https://github.com/dungle-scrubs/bones/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

Competitive multi-agent code review game. LLM agents hunt for bugs, security
issues, doc drift, and more in your codebase — then attack each other's
findings. A referee validates everything. First to the target score wins.

## How It Works

```
Setup → Hunt → HuntScoring → Review → ReviewScoring → (loop or Complete)
```

1. **Hunt** — Agents search your codebase for issues and submit findings
2. **HuntScoring** — A referee agent validates each finding (valid, false flag,
   or duplicate)
3. **Review** — Agents dispute other agents' valid findings
4. **ReviewScoring** — Referee resolves disputes
5. **Loop** — If no winner, start next round; otherwise game over

### Scoring

| Event | Points |
|-------|--------|
| Valid finding | +1 |
| False flag | -2 |
| Duplicate | -3 |
| Dispute won | +2 |
| Dispute lost | -1 |

### Design Philosophy: Incentives Over Instructions

The review phase does not prompt agents to treat findings as suspect. The scoring
system already creates that pressure — a successful dispute earns +2 while a
failed one costs -1, so agents are naturally incentivized to be skeptical but
selective. Layering "assume everything is questionable" on top of those mechanics
would stack prompt bias onto game-theoretic incentive, producing carpet-bomb
disputes and noisy referee queues rather than careful analysis.

Instead, the system demands **structured counter-evidence**: every dispute must
articulate a specific, testable counter-argument (e.g., "this path is unreachable
because X" or "this is handled in file Y"). This filters out lazy disputes
without biasing the overall posture. The distinction is the same one auditors
draw between professional skepticism — evaluate rigorously — and reflexive
rejection. The first produces signal; the second produces noise.

## Requirements

- [Bun](https://bun.sh/) v1.1+
- `ANTHROPIC_API_KEY` environment variable

## Installation

```bash
# Install globally via npm
npm install -g bones

# Or run directly with bun
bun install
bun run build
```

## Usage

### Quick game

```bash
# Run a bug-hunting game against a project
bones play ./my-project -c bugs -a 2 -t 5 -m 1
```

### Full game with defaults (3 agents, target 10, 3 rounds)

```bash
bones play ./my-project
```

### Choose a category

```bash
bones play ./my-project -c security
bones play ./my-project -c doc_drift
bones play ./my-project -c test_coverage
bones play ./my-project -c tech_debt
```

### Custom prompt

```bash
bones play ./my-project -c custom -f "Find all SQL injection vectors"
```

### Authentication

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Play options

```
bones play <project_path> [options]

Options:
  --model <provider/model>      Agent model (default: anthropic/claude-sonnet-4-0)
  --referee-model <model>       Referee model (default: same as --model)
  -c, --category <type>         bugs | doc_drift | security | test_coverage | tech_debt | custom
  -f, --focus <text>            Additional focus prompt
  -t, --target <score>          Target score (default: 10)
  -a, --agents <count>          Number of agents (default: 3)
  -m, --max-rounds <n>          Max rounds, 0 = unlimited (default: 3)
  --hunt-duration <seconds>     Hunt phase duration (default: 300)
  --review-duration <seconds>   Review phase duration (default: 180)
  --thinking <level>            Agent thinking level (default: medium)
  --include <paths...>          Only search these directories
  --exclude <paths...>          Additional directories to exclude
  --on-complete <command>       Shell command to run on completion (gets BONES_* env vars)
  --notify <sink>               Built-in notification: stdout | file:<path>
  --output <mode>               Output mode: tui (default) | json
```

### Inspect results

```bash
bones status <game_id>      # Scoreboard and game state
bones findings <game_id>    # All findings with verdicts
bones disputes <game_id>    # All disputes with resolutions
bones export <game_id>      # Export to ~/.bones/logs/
bones ui <game_id>          # Interactive terminal UI
```

### Run history & diffing

```bash
bones history ./my-project              # List past games for a project
bones history ./my-project -n 5         # Last 5 games
bones diff <game_id_1> <game_id_2>      # Compare findings across two runs
```

### Scheduled / headless mode

Games auto-export results and write `summary.json` on completion (or crash).
Exit codes: `0` = completed with findings, `1` = error, `2` = no findings.

```bash
# Run headless with NDJSON output and notifications
bones play ./my-project --output json --notify file:~/bones-results.log

# Run with a shell hook on completion
bones play ./my-project --output json \
  --on-complete "slack-notify.sh"
```

The `--on-complete` command receives game summary as environment variables:
`BONES_GAME_ID`, `BONES_WINNER`, `BONES_FINDINGS_COUNT`, `BONES_VALID_FINDINGS`,
`BONES_COST`, `BONES_TOKENS`, `BONES_PROJECT`, `BONES_CATEGORY`, `BONES_ROUNDS`.

### Generate a schedule

```bash
bones schedule ./my-project                     # nightly preset (launchd/cron)
bones schedule ./my-project --preset weekly     # weekly full run
```

The `nightly` preset rotates categories: Mon/Wed = bugs, Tue/Thu = doc_drift,
Fri = security. Generates wrapper scripts with log rotation (30 days) and
platform-specific scheduling (launchd on macOS, cron on Linux).

### Web dashboard

```bash
bones init                  # Install dashboard dependencies
bones serve                 # Start API server (port 8019)
# In another terminal:
cd apps/dashboard && bun dev  # Start dashboard (port 3019)
```

## Building from Source

```bash
git clone https://github.com/dungle-scrubs/bones.git
cd bones
bun install
bun run build
```

The compiled CLI is at `dist/cli.js`. Link it globally:

```bash
bun link
```

## Development

```bash
bun run dev           # Run CLI without building
bun test              # Run all tests (115 tests)
bun test --watch      # Watch mode
bun run lint          # Lint with Biome
bun run lint:fix      # Auto-fix lint issues
bun run typecheck     # Type-check without emitting
```

## Architecture

| Component | Tech |
|-----------|------|
| Runtime | Bun |
| CLI | Commander |
| Database | bun:sqlite |
| API server | Hono |
| Dashboard | Next.js |
| Agent framework | pi-agent-core + pi-ai |

### Key directories

```
src/
├── cli.ts                    # CLI entry point
├── cli/commands.ts           # Command handlers
├── domain/                   # Game, Finding, Dispute, Agent models
├── repository/               # SQLite persistence
├── services/
│   ├── Orchestrator.ts       # Central facade for all game operations
│   ├── GameRunner.ts         # Autonomous game loop with retry + auto-export
│   ├── Scorer.ts             # Point calculations in transactions
│   ├── Exporter.ts           # Game result export (markdown + JSON)
│   ├── RetryPolicy.ts        # Exponential backoff for API resilience
│   ├── NotificationHook.ts   # Completion hooks (shell commands, file, stdout)
│   └── Scheduler.ts          # launchd/cron schedule generation
└── agents/                   # Agent factory, runner, and tools
apps/
└── dashboard/                # Next.js web UI
```

## Known Limitations

- macOS and Linux only (uses Bun runtime)
- Requires an Anthropic API key
- Dashboard requires separate `bun install` in `apps/dashboard/`
- Game databases are stored locally at `~/.bones/`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
