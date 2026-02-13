---
title: Architecture
description: Internal architecture of Bones — services, domain models, repositories, and agent framework.
---

## Stack

| Component       | Technology               |
| --------------- | ------------------------ |
| Runtime         | Bun                      |
| CLI             | Commander                |
| Database        | bun:sqlite               |
| API server      | Hono (port 8019)         |
| Dashboard       | Next.js (port 3019)      |
| Agent framework | pi-agent-core + pi-ai    |

## Project Structure

```
src/
├── cli.ts                      # CLI entry point (Commander)
├── cli/commands.ts             # All command handlers
├── domain/                     # Domain models
│   ├── Game.ts                 # Phase state machine, timer management
│   ├── Finding.ts              # Bug submission, duplicate detection
│   ├── Dispute.ts              # Challenge to a finding
│   ├── Agent.ts                # Score tracking, phase completion
│   ├── types.ts                # Enums, issue types, categories
│   └── acceptance-criteria.ts  # Per-category validation rules
├── repository/                 # SQLite persistence
│   ├── Database.ts             # Connection management
│   ├── GameRepository.ts
│   ├── FindingRepository.ts
│   ├── AgentRepository.ts
│   └── DisputeRepository.ts
├── services/
│   ├── Orchestrator.ts         # Thin facade over coordinators
│   ├── GameRunner.ts           # Autonomous game loop (bones play)
│   ├── PhaseCoordinator.ts     # Phase transitions
│   ├── Scorer.ts               # Point calculations in transactions
│   ├── PromptRenderer.ts       # Agent/referee prompt generation
│   └── DashboardLauncher.ts    # Starts API + dashboard processes
├── agents/
│   ├── AgentFactory.ts         # Creates pi-agent-core agents per role
│   ├── AgentRunner.ts          # Runs agent to completion
│   └── tools/                  # hunt, review, referee, verifier tools
└── server.ts                   # Hono API server
apps/
└── dashboard/                  # Next.js web UI
```

## Key Services

### Orchestrator

Central coordinator. All CLI commands route through here. Manages phase
transitions and coordinates repositories.

### GameRunner

Drives the autonomous `bones play` loop. Creates a game, spawns agents,
runs phases in sequence, and checks for winners between rounds.

### Scorer

Handles all point calculations inside database transactions. Finding
validation and dispute resolution both update agent scores atomically.

### PromptRenderer

Generates prompts for hunt agents, review agents, and referee validations.
Each prompt type has specific variables including the game category,
acceptance criteria, and agent context.

## Game State Machine

```
Setup → Hunt → HuntScoring → Review → ReviewScoring → (loop or Complete)
```

Phase transitions are enforced by the domain model. You can't start review
scoring before the review phase completes, for example.

## Duplicate Detection

Findings include a **pattern hash** computed from the file path and affected
line range. When a new finding is submitted, it's compared against existing
findings using a **similarity score** that considers:

- Same file path
- Overlapping line ranges
- Description similarity

The referee uses this data to mark duplicates with the −3 penalty.
