#!/usr/bin/env bun

/**
 * Bones CLI — competitive multi-agent code review game.
 *
 * Usage:
 *   bones play <path> [options]     Run an autonomous game
 *   bones setup <url> [options]     Create a game for manual orchestration
 *   bones status <game_id>          Show game state + scoreboard
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { Commands } from "./cli/commands.js";
import { HuntCategory } from "./domain/types.js";
import { Orchestrator } from "./services/Orchestrator.js";

const CATEGORIES = Object.values(HuntCategory);

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.BONES_DATA_DIR ?? join(homedir(), ".bones");
const DB_PATH = join(DATA_DIR, "game.db");
const SCRIPTS_PATH =
	process.env.BONES_SCRIPTS_PATH ?? join(__dirname, "..", "scripts");

/**
 * Creates shared Orchestrator + Commands instances.
 * Returned `close` must be called before exit.
 *
 * @returns Orchestrator, Commands, and cleanup function
 */
function createContext(): {
	orchestrator: Orchestrator;
	commands: Commands;
	close: () => void;
} {
	const orchestrator = new Orchestrator(DB_PATH, SCRIPTS_PATH);
	const commands = new Commands(orchestrator);
	return { orchestrator, commands, close: () => orchestrator.close() };
}

/**
 * Wraps a command action: creates context, runs handler, prints result, cleans up.
 *
 * @param fn - Async function receiving Commands instance and returning JSON string
 * @returns Commander action handler
 */
function action(
	fn: (commands: Commands) => string | Promise<string>,
): () => Promise<void> {
	return async () => {
		const { commands, close } = createContext();
		try {
			const result = await fn(commands);
			console.log(result);
		} catch (error) {
			console.error(JSON.stringify({ error: (error as Error).message }));
			process.exit(1);
		} finally {
			close();
		}
	};
}

// ─── Program ─────────────────────────────────────────────────────────────────

const program = new Command();

program
	.name("bones")
	.description("Competitive multi-agent code review game")
	.version("2.0.0");

// ─── Autonomous Game ─────────────────────────────────────────────────────────

program
	.command("play")
	.description("Run a fully autonomous game with LLM agents")
	.argument("<project_path>", "Path to the project to review")
	.option(
		"--model <provider/model>",
		"Agent model",
		"anthropic/claude-sonnet-4-0",
	)
	.option(
		"--referee-model <provider/model>",
		"Referee model (default: same as --model)",
	)
	.addOption(
		new Option("-c, --category <type>", "Hunt category").choices(CATEGORIES),
	)
	.option("-f, --focus <text>", "Additional focus prompt")
	.option("-t, --target <score>", "Target score", "10")
	.option("-a, --agents <count>", "Number of agents", "3")
	.option("-m, --max-rounds <n>", "Max rounds (0 = unlimited)", "3")
	.option("--hunt-duration <seconds>", "Hunt phase duration", "300")
	.option("--review-duration <seconds>", "Review phase duration", "180")
	.option("--thinking <level>", "Agent thinking level", "medium")
	.option("--referee-thinking <level>", "Referee thinking level", "high")
	.option(
		"--include <paths...>",
		"Only search these directories (e.g. src/ lib/)",
	)
	.option("--exclude <paths...>", "Additional directories to exclude")
	.option("--auth <method>", "Auth method: oauth")
	.addOption(
		new Option("--output <mode>", "Output mode")
			.choices(["tui", "json"])
			.default("tui"),
	)
	.action(async (projectPath: string, opts) => {
		const { commands, close } = createContext();
		try {
			const result = await commands.play(projectPath, opts);
			if (result) console.log(result);
		} catch (error) {
			console.error(JSON.stringify({ error: (error as Error).message }));
			process.exit(1);
		} finally {
			close();
		}
	});

// ─── Game Setup ──────────────────────────────────────────────────────────────

program
	.command("setup")
	.description("Create a new game")
	.argument("<project_url>", "Project URL or local path")
	.option("-w, --web", "Start API server and dashboard")
	.addOption(
		new Option("-c, --category <type>", "Hunt category").choices(CATEGORIES),
	)
	.option("-f, --focus <text>", "Additional focus prompt")
	.option("-p, --prompt <text>", "Custom prompt (sets category to custom)")
	.option("-t, --target <score>", "Target score", "10")
	.option("-a, --agents <count>", "Number of agents", "3")
	.option("-m, --max-rounds <n>", "Max rounds (0 = unlimited)", "3")
	.option("--hunt-duration <seconds>", "Hunt phase duration", "300")
	.option("--review-duration <seconds>", "Review phase duration", "180")
	.action(async (projectUrl: string, opts) => {
		const { commands, close } = createContext();
		try {
			const result = await commands.setup(projectUrl, opts);
			console.log(result);
		} catch (error) {
			console.error(JSON.stringify({ error: (error as Error).message }));
			process.exit(1);
		} finally {
			close();
		}
	});

program
	.command("init")
	.description("Install dependencies (required before --web)")
	.action(action((c) => c.init()));

// ─── Auth ────────────────────────────────────────────────────────────────────

program
	.command("login")
	.description("Authenticate with Claude Pro/Max (OAuth)")
	.action(action((c) => c.login()));

program
	.command("logout")
	.description("Remove saved OAuth credentials")
	.action(action((c) => c.logoutCmd()));

program
	.command("auth-status")
	.description("Check authentication status")
	.action(action((c) => c.authStatus()));

// ─── Game Flow ───────────────────────────────────────────────────────────────

program
	.command("start-hunt")
	.description("Start hunt phase")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.startHunt(gameId))());

program
	.command("check-hunt")
	.description("Check hunt phase status")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.checkHunt(gameId))());

program
	.command("start-hunt-scoring")
	.description("Start scoring hunt findings")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.startHuntScoring(gameId))());

program
	.command("validate")
	.description("Record referee validation for a finding")
	.argument("<game_id>")
	.argument("<finding_id>", "Finding ID (integer)")
	.argument("<verdict>", "VALID | FALSE | DUPLICATE")
	.argument("<explanation>", "Referee explanation")
	.argument("[extra...]", "Verdict-specific args (see docs)")
	.action(
		(
			gameId: string,
			findingId: string,
			verdict: string,
			explanation: string,
			extra: string[],
		) =>
			action((c) =>
				c.validate(gameId, findingId, verdict, explanation, extra),
			)(),
	);

program
	.command("pending-verifications")
	.description("List findings needing verification")
	.argument("<game_id>")
	.action((gameId: string) =>
		action((c) => c.getPendingVerifications(gameId))(),
	);

program
	.command("verify")
	.description("Record verification decision for an uncertain finding")
	.argument("<game_id>")
	.argument("<finding_id>")
	.argument("<verdict>", "CONFIRM | REJECT")
	.argument("<explanation>")
	.argument(
		"[type_or_reason]",
		"Issue type (CONFIRM) or rejection reason (REJECT)",
	)
	.action(
		(
			gameId: string,
			findingId: string,
			verdict: string,
			explanation: string,
			typeOrReason?: string,
		) =>
			action((c) =>
				c.verify(gameId, findingId, verdict, explanation, typeOrReason),
			)(),
	);

program
	.command("start-review")
	.description("Start review/dispute phase")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.startReview(gameId))());

program
	.command("check-review")
	.description("Check review phase status")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.checkReview(gameId))());

program
	.command("start-review-scoring")
	.description("Start scoring disputes")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.startReviewScoring(gameId))());

program
	.command("resolve")
	.description("Record referee resolution for a dispute")
	.argument("<game_id>")
	.argument("<dispute_id>")
	.argument("<verdict>", "SUCCESSFUL | FAILED")
	.argument("<explanation>")
	.action(
		(gameId: string, disputeId: string, verdict: string, explanation: string) =>
			action((c) => c.resolve(gameId, disputeId, verdict, explanation))(),
	);

program
	.command("check-winner")
	.description("Check if game has a winner")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.checkWinner(gameId))());

// ─── Agent Commands ──────────────────────────────────────────────────────────

program
	.command("submit")
	.description("Submit a finding during hunt phase")
	.argument("<game_id>")
	.argument("<agent_id>")
	.argument("<file_path>")
	.argument("<line_start>")
	.argument("<line_end>")
	.argument("<description>")
	.argument("[code_snippet]")
	.action(
		(
			gameId: string,
			agentId: string,
			filePath: string,
			lineStart: string,
			lineEnd: string,
			description: string,
			codeSnippet?: string,
		) =>
			action((c) =>
				c.submit(
					gameId,
					agentId,
					filePath,
					lineStart,
					lineEnd,
					description,
					codeSnippet,
				),
			)(),
	);

program
	.command("dispute")
	.description("Dispute another agent's finding")
	.argument("<game_id>")
	.argument("<agent_id>")
	.argument("<finding_id>")
	.argument("<reason>")
	.action(
		(gameId: string, agentId: string, findingId: string, reason: string) =>
			action((c) => c.dispute(gameId, agentId, findingId, reason))(),
	);

program
	.command("done")
	.description("Mark agent as finished with current phase")
	.argument("<game_id>")
	.argument("<agent_id>")
	.argument("<phase>", "hunt | review")
	.action((gameId: string, agentId: string, phase: string) =>
		action((c) => c.done(gameId, agentId, phase))(),
	);

// ─── Query Commands ──────────────────────────────────────────────────────────

program
	.command("status")
	.description("Get game status and scoreboard")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.status(gameId))());

program
	.command("findings")
	.description("List all findings")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.findings(gameId))());

program
	.command("disputes")
	.description("List all disputes")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.disputes(gameId))());

program
	.command("export")
	.description("Export findings to logs folder")
	.argument("<game_id>")
	.action((gameId: string) => action((c) => c.export(gameId))());

// ─── UI ──────────────────────────────────────────────────────────────────────

program
	.command("ui")
	.description("Launch interactive terminal UI")
	.argument("<game_id>")
	.action(async (gameId: string) => {
		const { commands, close } = createContext();
		try {
			const result = await commands.ui(gameId);
			console.log(result);
		} catch (error) {
			console.error(JSON.stringify({ error: (error as Error).message }));
			process.exit(1);
		} finally {
			close();
		}
	});

// ─── Parse ───────────────────────────────────────────────────────────────────

program.parse();
