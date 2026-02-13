---
title: Playing a Game
description: Run autonomous code review games with configurable agents, models, and scoring.
---

## Quick Start

```bash
bones play ./my-project
```

This runs a full game with defaults: 3 agents, target score of 10, up to 3
rounds, bug hunting category.

## Options

```bash
bones play <project_path> [options]
```

| Option                       | Default                        | Description                    |
| ---------------------------- | ------------------------------ | ------------------------------ |
| `--model <provider/model>`   | `anthropic/claude-sonnet-4-0`  | Agent model                    |
| `--referee-model <model>`    | Same as `--model`              | Referee model                  |
| `-c, --category <type>`      | `bugs`                         | Hunt category                  |
| `-f, --focus <text>`         | —                              | Additional focus prompt         |
| `-t, --target <score>`       | `10`                           | Target score to win            |
| `-a, --agents <count>`       | `3`                            | Number of competing agents     |
| `-m, --max-rounds <n>`       | `3`                            | Max rounds (0 = unlimited)     |
| `--hunt-duration <seconds>`  | `300`                          | Hunt phase time limit          |
| `--review-duration <seconds>`| `180`                          | Review phase time limit        |
| `--thinking <level>`         | `medium`                       | Agent thinking level           |
| `--referee-thinking <level>` | `high`                         | Referee thinking level         |
| `--include <paths...>`       | —                              | Only search these directories  |
| `--exclude <paths...>`       | —                              | Additional directories to skip |


## Examples

### Quick bug hunt

```bash
bones play ./my-project -c bugs -a 2 -t 3 -m 1
```

2 agents, target 3, 1 round — fast feedback loop.

### Security audit

```bash
bones play ./my-project -c security --thinking high
```

### Scoped to specific directories

```bash
bones play ./my-project -c bugs --include src/ lib/
```

### Custom prompt

```bash
bones play ./my-project -c custom -f "Find all race conditions in async code"
```

## Game Phases

Each round follows this sequence:

1. **Hunt** — Agents search and submit findings within `--hunt-duration`
2. **HuntScoring** — Referee validates each finding
3. **Review** — Agents dispute other agents' valid findings
4. **ReviewScoring** — Referee resolves disputes
5. **Winner check** — If target reached, game ends. Otherwise, next round.

## Scoring

| Event         | Points |
| ------------- | ------ |
| Valid finding | +1     |
| False flag    | −2     |
| Duplicate     | −3     |
| Dispute won   | +2     |
| Dispute lost  | −1     |

The penalty system discourages low-quality submissions. Agents are better off
being precise than prolific.
