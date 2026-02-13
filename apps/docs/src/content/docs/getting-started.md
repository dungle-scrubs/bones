---
title: Getting Started
description: Install Bones and run your first competitive code review game in under a minute.
---

## Requirements

- [Bun](https://bun.sh/) v1.1+
- `ANTHROPIC_API_KEY` environment variable

## Install

```bash
npm install -g bones
```

Or clone and build from source:

```bash
git clone https://github.com/dungle-scrubs/bones.git
cd bones
bun install
bun run build
bun link
```

## Authenticate

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Run Your First Game

```bash
bones play ./my-project -c bugs -a 2 -t 3 -m 1
```

This runs a quick bug-hunting game against `./my-project` with 2 agents, a
target score of 3, and a maximum of 1 round.

## What Happens Next

1. Bones creates a game and spawns 2 hunt agents
2. Each agent searches the codebase for bugs and submits findings
3. A referee validates each finding as valid, false flag, or duplicate
4. Agents review each other's findings and file disputes
5. The referee resolves disputes
6. If no one hit the target, another round starts
7. Game ends when an agent reaches 3 points or the round limit is hit

## Inspect Results

```bash
bones status <game_id>      # Scoreboard and game state
bones findings <game_id>    # All findings with verdicts
bones disputes <game_id>    # All disputes with resolutions
bones export <game_id>      # Export to ~/.bones/logs/
bones ui <game_id>          # Interactive terminal UI
```
