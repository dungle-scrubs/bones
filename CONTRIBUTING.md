# Contributing

## Development Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/dungle-scrubs/bones.git
   cd bones
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Run tests to verify:

   ```bash
   bun test
   ```

## Making Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run the checks:

   ```bash
   bun test
   bun run lint
   bun run typecheck
   ```

5. Commit using [conventional commits](https://www.conventionalcommits.org/):

   ```bash
   git commit -m "feat: add export to CSV"
   git commit -m "fix: handle empty findings list"
   ```

6. Push and open a Pull Request

## Commit Messages

This project uses conventional commits for automated versioning:

| Prefix | Purpose |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `refactor:` | Code change that neither fixes nor adds |
| `test:` | Adding or updating tests |
| `chore:` | Maintenance (deps, CI, etc.) |
| `feat!:` | Breaking change |

## Code Style

- Formatted and linted with [Biome](https://biomejs.dev/)
- Tabs for indentation, double quotes for strings
- Pre-commit hooks run automatically via husky + lint-staged
