#!/usr/bin/env node
/**
 * Bones CLI entry point.
 * Parses command-line arguments and routes to appropriate command handlers.
 * Uses shared database at ~/.bones/ for cross-session persistence.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Commands } from "./cli/commands.js";
import { Orchestrator } from "./services/Orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve paths - use ~/.bones/ for shared DB across dev/cache
const dataDir = process.env.BONES_DATA_DIR ?? join(homedir(), ".bones");
const dbPath = join(dataDir, "game.db");
const scriptsPath =
	process.env.BONES_SCRIPTS_PATH ?? join(__dirname, "..", "scripts");

// Parse command line
const [, , command, ...args] = process.argv;

if (!command) {
	console.log(`Bones - Competitive Code Review Game

Usage: bones <command> [args]

Setup Commands:
  init                      Install dependencies (required before --web)
  login                     Authenticate with Claude Pro/Max (OAuth)
  logout                    Remove saved OAuth credentials
  auth-status               Check authentication status

Autonomous Game:
  play <project_path> [opts] Run a fully autonomous game with LLM agents
    --model <provider/model>   Agent model (default: anthropic/claude-sonnet-4-0)
    --referee-model <p/m>      Referee model (default: same as --model)
    --category <type>          Hunt category
    --target <score>           Target score (default: 10)
    --agents <count>           Number of agents (default: 3)
    --thinking <level>         Agent thinking level (default: medium)
    --referee-thinking <level> Referee thinking level (default: high)
    --auth oauth               Use Claude Pro/Max subscription (run 'login' first)

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
  validate - format varies by verdict:
    VALID:     validate <game_id> <finding_id> VALID <explanation> <score> <issue_type> <impact> <needs_verify>
    FALSE:     validate <game_id> <finding_id> FALSE <explanation> <score> <rejection_reason>
    DUPLICATE: validate <game_id> <finding_id> DUPLICATE <explanation> <duplicate_of_id>
  pending-verifications <id>  List findings needing verification
  verify - format varies by verdict:
    CONFIRM: verify <game_id> <finding_id> CONFIRM <explanation> [issue_type]
    REJECT:  verify <game_id> <finding_id> REJECT <explanation> <rejection_reason>

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
  bones setup https://github.com/example/repo

  # Documentation drift
  bones setup https://github.com/example/repo -c doc_drift

  # Bug hunt with focus
  bones setup https://github.com/example/repo -c bugs -f "Focus on auth code"

  # Export results
  bones export my-project-a1b2c3

Output:
  Game IDs: {project-name}-{short-id} (e.g., my-repo-a1b2c3)
  Logs: bones/logs/{game-id}/findings.md
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
	init: () => commands.init(),
	login: () => commands.login(),
	logout: () => commands.logoutCmd(),
	"auth-status": () => commands.authStatus(),
	play: (a) => commands.play(a),
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
	console.error("Run 'bones' without arguments for usage.");
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
