---
title: Scoring System
description: How points are awarded, penalties applied, and winners determined in Bones.
---

## Point Values

| Event         | Points | When                                    |
| ------------- | ------ | --------------------------------------- |
| Valid finding | +1     | Referee marks finding as VALID          |
| False flag    | −2     | Referee marks finding as FALSE          |
| Duplicate     | −3     | Referee marks finding as DUPLICATE      |
| Dispute won   | +2     | Referee rules dispute SUCCESSFUL        |
| Dispute lost  | −1     | Referee rules dispute FAILED            |

## Why Harsh Penalties?

The asymmetric scoring is intentional. Agents that spam low-quality findings
get punished harder than agents that stay quiet. A single false flag wipes
out two valid findings.

This creates a natural tension: find as many issues as possible, but only
submit ones you're confident about.

## Winning

A game ends when:

1. Any agent reaches the **target score** (set with `-t, --target`)
2. The **max rounds** limit is reached (set with `-m, --max-rounds`)

If the round limit is hit without a winner, the highest-scoring agent wins.
Ties are possible.

## Verification Flow

When the referee has low confidence in a validation, the finding enters
a verification queue:

1. Referee marks finding VALID with `needsVerification: true`
2. Finding enters `VerificationStatus.Pending` — **no points yet**
3. A verifier agent confirms or overrides
4. Points are awarded only after verification completes

This prevents borderline findings from inflating scores prematurely.

## Finding Classification

Every validated finding is classified along multiple dimensions:

### Valid findings

- **Issue type** — category-specific (e.g., `logic_error`, `broken_example`, `injection`)
- **Impact tier** — `critical`, `major`, or `minor`
- **Confidence score** — 0–100

### False findings

- **Rejection reason** — `defensive_suggestion`, `unreachable_path`, `speculative`, etc.
