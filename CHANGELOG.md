# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-02-13

### Added

- Fully autonomous game mode (`bones play`) — one command runs the entire game
- OAuth authentication with Claude Pro/Max subscriptions (`bones login`)
- Six hunt categories: bugs, security, doc_drift, test_coverage, tech_debt, custom
- Finding verification flow for low-confidence validations
- Interactive terminal UI (`bones ui`)
- Web dashboard with real-time game state (Next.js)
- Path filtering (`--include`, `--exclude`) for agent scope
- Configurable thinking levels for agents and referee
- Export findings to logs (`bones export`)
