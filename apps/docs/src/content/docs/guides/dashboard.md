---
title: Web Dashboard
description: Monitor games in real-time with the Bones web dashboard and API server.
---

Bones includes a web dashboard for monitoring games visually.

## Setup

Install dashboard dependencies (only needed once):

```bash
bones init
```

## Start the Dashboard

You need two processes — the API server and the dashboard frontend.

### Terminal 1: API server

```bash
bones serve
# → http://localhost:8019
```

### Terminal 2: Dashboard

```bash
cd apps/dashboard && bun dev
# → http://localhost:3019
```

Or start both at once with the justfile:

```bash
just web
```

## What You See

- **Game list** — all games with status and scores
- **Live scoreboard** — agent scores updating in real-time
- **Findings** — all submitted findings with referee verdicts
- **Disputes** — dispute history with resolutions

## Architecture

| Component | Port | Tech |
| --------- | ---- | ---- |
| API server | 8019 | Hono + bun:sqlite |
| Dashboard | 3019 | Next.js |

The dashboard polls the API server for game state. The API server reads
directly from the SQLite database at `~/.bones/game.db`.
