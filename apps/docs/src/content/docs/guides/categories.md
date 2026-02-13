---
title: Hunt Categories
description: Choose what your agents hunt for — bugs, security vulnerabilities, doc drift, test gaps, tech debt, or custom prompts.
---

Every game targets a specific category. This focuses the agents and shapes the
referee's validation criteria.

## Built-in Categories

### `bugs`

Real, demonstrable bugs — crashes, logic errors, race conditions, incorrect
return values, off-by-one errors. The finding must be provably wrong, not just
a style preference.

```bash
bones play ./my-project -c bugs
```

### `security`

Injection vectors, auth bypass, secrets in code, SSRF, path traversal,
insecure crypto, missing input validation. Findings are classified by impact
tier (critical, major, minor).

```bash
bones play ./my-project -c security
```

### `doc_drift`

Documentation and comments that don't match actual code behavior. Outdated
README instructions, wrong parameter descriptions, misleading examples,
stale API docs.

```bash
bones play ./my-project -c doc_drift
```

### `test_coverage`

Missing tests, untested edge cases, dead test code, tests that don't actually
assert anything meaningful, mocked-out logic that's never integration-tested.

```bash
bones play ./my-project -c test_coverage
```

### `tech_debt`

Code smells, dead code, duplicated logic, overly complex abstractions,
TODO/FIXME items that have been lingering, unused dependencies.

```bash
bones play ./my-project -c tech_debt
```

### `custom`

Your own prompt. Use `-f` or `--focus` to describe what agents should look for.

```bash
bones play ./my-project -c custom -f "Find all places where errors are silently swallowed"
```

## Acceptance Criteria

Each category has built-in acceptance criteria that the referee uses to
validate findings. A `bugs` finding must be demonstrably wrong code — not
a suggestion for improvement. A `security` finding must describe an
exploitable vector, not a theoretical concern.

See the [CLI Reference](/reference/cli/) for the full list of issue types per
category.
