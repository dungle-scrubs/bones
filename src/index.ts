#!/usr/bin/env node
/**
 * Code Hunt CLI entry point.
 * Parses command-line arguments and routes to appropriate command handlers.
 * Uses shared database at ~/.code-hunt/ for cross-session persistence.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Commands } from "./cli/commands.js";
import { Orchestrator } from "./services/Orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve paths - use ~/.code-hunt/ for shared DB across dev/cache
const dataDir = process.env.CODE_HUNT_DATA_DIR ?? join(homedir(), ".code-hunt");
const dbPath = join(dataDir, "game.db");
const scriptsPath =
	process.env.CODE_HUNT_SCRIPTS_PATH ?? join(__dirname, "..", "scripts");

// Parse command line
const [, , command, ...args] = process.argv;

if (!command) {
	console.log(`Code Hunt - Competitive Code Review Game

Usage: code-hunt <command> [args]

Game Flow Commands:
  setup <url> [options]     Create a new game
    --web, -w               Start API server and dashboard, print URLs
    --category, -c <type>   Category: bugs|doc_drift|security|test_coverage|tech_debt|custom
    --focus, -f <text>      Additional focus (merged with category)
    --prompt, -p <text>     Custom prompt (sets category to custom)
    --target, -t <score>    Target score (default: 10)
    --hunt-duration, -h <s> Hunt phase duration in seconds (default: 300)
    --review-duration, -r   Review phase duration in seconds (default: 180)
    --agents, -a <count>    Number of agents (default: 3)
    --max-rounds, -m <n>    Max rounds, 0 = unlimited (default: 3)

  start-hunt <game_id>      Start hunt phase
  check-hunt <game_id>      Check hunt phase status
  start-hunt-scoring <id>   Start scoring hunt findings
  validate <game_id> <finding_id> <VALID|FALSE|DUPLICATE> <explanation> <confidence_score> <bug_category> <needs_verification> [dup_id]
  pending-verifications <id>  List findings needing verification
  verify <game_id> <finding_id> <CONFIRM|REJECT> <explanation> [corrected_category]

  start-review <game_id>    Start review phase
  check-review <game_id>    Check review phase status
  start-review-scoring <id> Start scoring disputes
  resolve <game_id> <dispute_id> <SUCCESSFUL|FAILED> <explanation>

  check-winner <game_id>    Check if game has winner
  export <game_id>          Export findings to logs folder

Agent Commands:
  submit <game_id> <agent_id> <file> <start> <end> <description> [snippet]
  dispute <game_id> <agent_id> <finding_id> <reason>
  done <game_id> <agent_id> <hunt|review>

Query Commands:
  status <game_id>          Get game status and scoreboard
  findings <game_id>        List all findings
  disputes <game_id>        List all disputes

Examples:
  # Default bug hunt
  code-hunt setup https://github.com/example/repo

  # Documentation drift
  code-hunt setup https://github.com/example/repo -c doc_drift

  # Bug hunt with focus
  code-hunt setup https://github.com/example/repo -c bugs -f "Focus on auth code"

  # Export results
  code-hunt export my-project-a1b2c3

Output:
  Game IDs: {project-name}-{short-id} (e.g., my-repo-a1b2c3)
  Logs: skills/code-hunt/logs/{game-id}/findings.md
`);
	process.exit(0);
}

// Initialize orchestrator and commands
const orchestrator = new Orchestrator(dbPath, scriptsPath);
const commands = new Commands(orchestrator);

/** Maps CLI command names to their handler functions for routing. */
const commandHandlers: Record<
	string,
	(args: string[]) => string | Promise<string>
> = {
	setup: (a) => commands.setup(a),
	"start-hunt": (a) => commands.startHunt(a),
	"check-hunt": (a) => commands.checkHunt(a),
	"start-hunt-scoring": (a) => commands.startHuntScoring(a),
	validate: (a) => commands.validate(a),
	"pending-verifications": (a) => commands.getPendingVerifications(a),
	verify: (a) => commands.verify(a),
	"start-review": (a) => commands.startReview(a),
	"check-review": (a) => commands.checkReview(a),
	"start-review-scoring": (a) => commands.startReviewScoring(a),
	resolve: (a) => commands.resolve(a),
	"check-winner": (a) => commands.checkWinner(a),
	export: (a) => commands.export(a),
	submit: (a) => commands.submit(a),
	dispute: (a) => commands.dispute(a),
	done: (a) => commands.done(a),
	status: (a) => commands.status(a),
	findings: (a) => commands.findings(a),
	disputes: (a) => commands.disputes(a),
	ui: (a) => commands.ui(a),
};

const handler = commandHandlers[command];
if (!handler) {
	console.error(`Unknown command: ${command}`);
	console.error("Run 'code-hunt' without arguments for usage.");
	orchestrator.close();
	process.exit(1);
}

(async () => {
	try {
		const result = await handler(args);
		console.log(result);
		orchestrator.close();
	} catch (error) {
		console.error(JSON.stringify({ error: (error as Error).message }));
		orchestrator.close();
		process.exit(1);
	}
})();
