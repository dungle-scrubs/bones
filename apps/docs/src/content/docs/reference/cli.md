---
title: CLI Reference
description: Complete reference for all Bones CLI commands, options, and arguments.
---

## `bones play`

Run a fully autonomous game with LLM agents.

```bash
bones play <project_path> [options]
```

| Option                        | Default                       | Description                    |
| ----------------------------- | ----------------------------- | ------------------------------ |
| `--model <provider/model>`    | `anthropic/claude-sonnet-4-0` | Agent model                    |
| `--referee-model <model>`     | Same as `--model`             | Referee model                  |
| `-c, --category <type>`       | —                             | Hunt category (see below)      |
| `-f, --focus <text>`          | —                             | Additional focus prompt         |
| `-t, --target <score>`        | `10`                          | Target score                   |
| `-a, --agents <count>`        | `3`                           | Number of agents               |
| `-m, --max-rounds <n>`        | `3`                           | Max rounds (0 = unlimited)     |
| `--hunt-duration <seconds>`   | `300`                         | Hunt phase duration             |
| `--review-duration <seconds>` | `180`                         | Review phase duration           |
| `--thinking <level>`          | `medium`                      | Agent thinking level            |
| `--referee-thinking <level>`  | `high`                        | Referee thinking level          |
| `--include <paths...>`        | —                             | Only search these dirs          |
| `--exclude <paths...>`        | —                             | Additional dirs to exclude      |


**Categories:** `bugs`, `doc_drift`, `security`, `test_coverage`, `tech_debt`, `custom`

---

## `bones setup`

Create a game for manual orchestration (step-by-step phase control).

```bash
bones setup <project_url> [options]
```

Accepts the same category, target, agents, and duration options as `play`.
Additional options:

| Option      | Description                            |
| ----------- | -------------------------------------- |
| `-w, --web` | Start API server and dashboard         |

---

## `bones init`

Install all dependencies including the dashboard.

```bash
bones init
```

---

## Authentication

Authentication is configured via the `ANTHROPIC_API_KEY` environment variable.
See [Authentication](/guides/authentication/).

---

## Game Inspection

### `bones status <game_id>`

Show game state, current phase, round number, and scoreboard.

### `bones findings <game_id>`

List all findings with referee verdicts and scores.

### `bones disputes <game_id>`

List all disputes with resolutions.

### `bones export <game_id>`

Export findings to `~/.bones/logs/`.

### `bones ui <game_id>`

Launch interactive terminal UI for live monitoring.

---

## Manual Phase Control

These commands are used for step-by-step game orchestration (after `bones setup`).

### `bones start-hunt <game_id>`

Start the hunt phase.

### `bones check-hunt <game_id>`

Check hunt phase status (agents still working or done).

### `bones start-hunt-scoring <game_id>`

Begin referee validation of hunt findings.

### `bones validate <game_id> <finding_id> <verdict> <explanation> [extra...]`

Record a referee validation. Verdict: `VALID`, `FALSE`, or `DUPLICATE`.

### `bones start-review <game_id>`

Start the review/dispute phase.

### `bones check-review <game_id>`

Check review phase status.

### `bones start-review-scoring <game_id>`

Begin referee resolution of disputes.

### `bones resolve <game_id> <dispute_id> <verdict> <explanation>`

Record a referee resolution. Verdict: `SUCCESSFUL` or `FAILED`.

### `bones check-winner <game_id>`

Check if any agent has reached the target score.

---

## Agent Commands

Used by agents during gameplay (not typically called manually).

### `bones submit <game_id> <agent_id> <file> <start> <end> <desc> [snippet]`

Submit a finding during hunt phase.

### `bones dispute <game_id> <agent_id> <finding_id> <reason>`

Dispute another agent's finding during review phase.

### `bones done <game_id> <agent_id> <phase>`

Mark agent as finished with current phase (`hunt` or `review`).

---

## Verification

### `bones pending-verifications <game_id>`

List findings needing second-pass verification.

### `bones verify <game_id> <finding_id> <verdict> <explanation> [type_or_reason]`

Record verification decision. Verdict: `CONFIRM` or `REJECT`.
