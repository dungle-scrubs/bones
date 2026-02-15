# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-02-15)


### Features

* add abort visibility and tool call diagnostics ([aefabff](https://github.com/dungle-scrubs/bones/commit/aefabff78d931e708e9dc00669674b2d28ca42c4))
* add app icons (navy-gold primary + 7 color variants) ([2d85f86](https://github.com/dungle-scrubs/bones/commit/2d85f8695a6af0b031965a6ed30ec4022e107ea0))
* add Astro Starlight docs site ([a6665ba](https://github.com/dungle-scrubs/bones/commit/a6665ba7dc5c950cfbbfceb87a2207094b2855f4))
* add autonomous agent game loop ([1b10c94](https://github.com/dungle-scrubs/bones/commit/1b10c942e38c33dfa8e92779037603e7d85a09ec))
* add OAuth login for Claude Pro/Max ([79ba00c](https://github.com/dungle-scrubs/bones/commit/79ba00c893775c187b84d7ef9cd00723c8131780))
* add OAuth subscription auth support ([b22a495](https://github.com/dungle-scrubs/bones/commit/b22a495dede5a2890d2487e8aa152e405fb327cb))
* add path filtering for agent tools ([dd5dd48](https://github.com/dungle-scrubs/bones/commit/dd5dd48edc37c81869e4ee1510870d2616ffca88))
* **api:** expose classification fields in findings endpoint ([6fb785e](https://github.com/dungle-scrubs/bones/commit/6fb785e7ca8c7b194e94e17937e7e8b88723a726))
* **cli:** add init command for first-time setup ([4fa70d9](https://github.com/dungle-scrubs/bones/commit/4fa70d9d7414023c47ff32cb503268eef84516cc))
* **cli:** add verification commands and update validate format ([70bcd41](https://github.com/dungle-scrubs/bones/commit/70bcd41a5bfad35805ac81cf0f7237d7fc73c0c0))
* **cli:** rewrite with commander ([7aad93c](https://github.com/dungle-scrubs/bones/commit/7aad93c0087e69a2c207d50379f2402ac8be548e))
* **cli:** update commands for classification taxonomy ([2c166aa](https://github.com/dungle-scrubs/bones/commit/2c166aa3d3544524fad448770a35952348869be2))
* **domain:** add finding classification taxonomy ([9b5b3ce](https://github.com/dungle-scrubs/bones/commit/9b5b3cef9b1a922434a0b79515a8d0444f502a1b))
* **domain:** add verification types and extend Finding model ([f052a01](https://github.com/dungle-scrubs/bones/commit/f052a01ae2f5fe9e4b9089da6e5f40ecc79f1ae0))
* **play:** add --output json mode for programmatic consumption ([593c00a](https://github.com/dungle-scrubs/bones/commit/593c00ade18b18c3f51f23ffec02ec44f0419cab))
* **prompts:** add words-hurt library integration ([9a20922](https://github.com/dungle-scrubs/bones/commit/9a20922ea3e3ba206615e971695903972d6123af))
* **prompts:** wire validation prompts to use project context ([d0d49c8](https://github.com/dungle-scrubs/bones/commit/d0d49c8d2cff27d5440ec6318b238061e26f9c21))
* **repository:** add verification columns and queries ([343708c](https://github.com/dungle-scrubs/bones/commit/343708c1e56e7c8cf6e1d021c603ef7c2e711782))
* **repository:** update schema for finding classification ([37445eb](https://github.com/dungle-scrubs/bones/commit/37445eb6cbfd583f5c0a245330055e8106e3f4a9))
* **review:** require structured counter-evidence in disputes ([cba1a5d](https://github.com/dungle-scrubs/bones/commit/cba1a5d5521d8eb5c16ba8a770194c984b9aefbe))
* **services:** implement verification workflow ([794e4c0](https://github.com/dungle-scrubs/bones/commit/794e4c04d61bfe30f74c2d0da439fff3b5cdfa49))
* **services:** integrate classification taxonomy ([5aa7084](https://github.com/dungle-scrubs/bones/commit/5aa7084134c4bba0a1665193197515a911bb25a2))
* **tui:** add live game dashboard component ([7de52f8](https://github.com/dungle-scrubs/bones/commit/7de52f8acbfcaf94cae9d53eb055892c542186ef))
* **tui:** wire live dashboard into play command ([00d8747](https://github.com/dungle-scrubs/bones/commit/00d87473f101d2483f4c94d31a0a22e8266f41d2))


### Bug Fixes

* 4 bugs found by bones agents (round 2) ([f588dd4](https://github.com/dungle-scrubs/bones/commit/f588dd445b96ff536f023921c2ff8cb9a72180c6))
* 5 bugs found by bones agents ([c2ff158](https://github.com/dungle-scrubs/bones/commit/c2ff15838d72222542e699302cb12be6b1e37999))
* **cli:** require both confidence_score and bug_category for new format ([4d6654e](https://github.com/dungle-scrubs/bones/commit/4d6654efa8c02655f217572ca97fa7d2a6ac4576))
* **dashboard:** add localStorage polyfill for Node.js 25 SSR ([35c393f](https://github.com/dungle-scrubs/bones/commit/35c393f9b5203e78b235bd73632bf9ec1c978468))
* **domain:** clear verificationStatus when revoking validation ([54ef28c](https://github.com/dungle-scrubs/bones/commit/54ef28caa18b7c76c6c46dc8788cbbba71616c9d))
* explain game flow in hunt prompt so agents actually submit ([9638646](https://github.com/dungle-scrubs/bones/commit/96386465f1526ddc5413218c23609e49c576dca3))
* explicit tool instructions in agent system prompt ([dc1e358](https://github.com/dungle-scrubs/bones/commit/dc1e358859d849b69c9c3f479c8903e523cc3136))
* increase turn limits — referee was running out before validating ([dfa4629](https://github.com/dungle-scrubs/bones/commit/dfa462900bba13ff0c9ded6c69b5649c0924d72b))
* redirect CC shim tools to real tools, fix SSR EventSource ([3831b32](https://github.com/dungle-scrubs/bones/commit/3831b3277445e0d61c7e85e05d6f827e1e47362c))
* rename read_file tool to view_file for OAuth compat ([9821167](https://github.com/dungle-scrubs/bones/commit/9821167a29213e5c5433b7234a3a474debbd6bcd))
* rewrite prompts to reference tools instead of shell scripts ([0b0d9c6](https://github.com/dungle-scrubs/bones/commit/0b0d9c67d0908decb6e3dead2871d8153e5502aa))
* **services:** prevent race conditions in duplicate detection ([dda5c9a](https://github.com/dungle-scrubs/bones/commit/dda5c9a967595b62b1c164c3b0a1f7be21fc897f))
* **services:** prevent submissions after agent marks phase done ([5d7f4bd](https://github.com/dungle-scrubs/bones/commit/5d7f4bd7182355f54acec46e687c93c50df29b8f))
* silent UPDATE failures across all 4 repositories ([c1f3426](https://github.com/dungle-scrubs/bones/commit/c1f34267e72fa0607dd563406ab632037e45c117))
* **ui:** handle DESC-sorted findings in activity log ([ade52f0](https://github.com/dungle-scrubs/bones/commit/ade52f086f236efcc9e5b5f3e8f4a4990e578ab4))
* update hono 4.11.3 → 4.11.9 (6 CVEs) ([ca70d89](https://github.com/dungle-scrubs/bones/commit/ca70d89608f9d86ec002267a50a5527d51a20bee))

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
