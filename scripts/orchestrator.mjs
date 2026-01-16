#!/usr/bin/env node
/**
 * Bug Hunt Orchestrator
 *
 * Deterministic game loop controller. Outputs exact instructions for each step.
 * Run with: node orchestrator.mjs <command> <game_id> [args]
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = __dirname;
const AGENTS_DIR = resolve(__dirname, "../../../agents");

function escapeShellArg(arg) {
	// Escape single quotes and wrap in single quotes for shell safety
	return `'${String(arg).replace(/'/g, "'\\''")}'`;
}

function gameState(cmd, ...args) {
	const escapedArgs = args.map(escapeShellArg).join(" ");
	const result = execSync(
		`node "${SCRIPTS}/game-state.mjs" ${cmd} ${escapedArgs}`,
		{ encoding: "utf-8" },
	);
	return JSON.parse(result);
}

function loadPromptTemplate() {
	return readFileSync(resolve(AGENTS_DIR, "hunter-prompt.md"), "utf-8");
}

function loadRefereeTemplate() {
	return readFileSync(resolve(AGENTS_DIR, "referee-prompt.md"), "utf-8");
}

function renderHuntPrompt(template, game, agent, scoreboard, round) {
	const agentScore = scoreboard.find((s) => s.id === agent)?.score || 0;
	const scoreboardText = scoreboard
		.map(
			(s) =>
				`| ${s.id} | ${s.score} | ${s.bugs_valid}/${s.bugs_submitted} valid | ${s.bugs_false} false | ${s.bugs_duplicate} dup |`,
		)
		.join("\n");

	return template
		.replace(/\$\{GAME_ID\}/g, game.id)
		.replace(/\$\{AGENT_ID\}/g, agent)
		.replace(/\$\{ROUND\}/g, round.toString())
		.replace(/\$\{PHASE\}/g, "HUNT")
		.replace(/\$\{PHASE_ENDS_AT\}/g, game.phase_ends_at || "N/A")
		.replace(/\$\{TARGET_SCORE\}/g, game.target_score.toString())
		.replace(/\$\{PROJECT_URL\}/g, game.project_url)
		.replace(/\$\{CATEGORIES\}/g, game.categories)
		.replace(
			/\$\{SCOREBOARD\}/g,
			`| Agent | Score | Valid | False | Dup |\n|-------|-------|-------|-------|-----|\n${scoreboardText}`,
		)
		.replace(/\$\{YOUR_SCORE\}/g, agentScore.toString())
		.replace(/\$\{SCRIPTS_PATH\}/g, SCRIPTS)
		.replace(/\$\{IF_HUNT_PHASE\}[\s\S]*?\$\{END_IF\}/g, (match) =>
			match.replace("${IF_HUNT_PHASE}", "").replace("${END_IF}", ""),
		)
		.replace(/\$\{IF_REVIEW_PHASE\}[\s\S]*?\$\{END_IF\}/g, "")
		.replace(/\$\{BUGS_LIST\}/g, "");
}

function renderReviewPrompt(template, game, agent, scoreboard, bugs, round) {
	const agentScore = scoreboard.find((s) => s.id === agent)?.score || 0;
	const scoreboardText = scoreboard
		.map(
			(s) =>
				`| ${s.id} | ${s.score} | ${s.bugs_valid}/${s.bugs_submitted} valid | ${s.bugs_false} false | ${s.bugs_duplicate} dup |`,
		)
		.join("\n");

	// Only show validated bugs from OTHER agents for review (status is "valid" after hunt_scoring)
	const otherBugs = bugs.filter(
		(b) => b.agent_id !== agent && b.status === "valid",
	);
	const bugsText =
		otherBugs.length === 0
			? "_No bugs from other agents to review._"
			: otherBugs
					.map(
						(b) =>
							`**Bug #${b.id}** by ${b.agent_id}\n` +
							`- Category: ${b.category}\n` +
							`- File: ${b.file_path}:${b.line_start}-${b.line_end}\n` +
							`- Description: ${b.description}\n` +
							(b.code_snippet
								? `- Code:\n\`\`\`\n${b.code_snippet}\n\`\`\`\n`
								: ""),
					)
					.join("\n---\n");

	return template
		.replace(/\$\{GAME_ID\}/g, game.id)
		.replace(/\$\{AGENT_ID\}/g, agent)
		.replace(/\$\{ROUND\}/g, round.toString())
		.replace(/\$\{PHASE\}/g, "REVIEW")
		.replace(/\$\{PHASE_ENDS_AT\}/g, game.phase_ends_at || "N/A")
		.replace(/\$\{TARGET_SCORE\}/g, game.target_score.toString())
		.replace(/\$\{PROJECT_URL\}/g, game.project_url)
		.replace(/\$\{CATEGORIES\}/g, game.categories)
		.replace(
			/\$\{SCOREBOARD\}/g,
			`| Agent | Score | Valid | False | Dup |\n|-------|-------|-------|-------|-----|\n${scoreboardText}`,
		)
		.replace(/\$\{YOUR_SCORE\}/g, agentScore.toString())
		.replace(/\$\{SCRIPTS_PATH\}/g, SCRIPTS)
		.replace(/\$\{BUGS_LIST\}/g, bugsText)
		.replace(/\$\{IF_REVIEW_PHASE\}[\s\S]*?\$\{END_IF\}/g, (match) =>
			match.replace("${IF_REVIEW_PHASE}", "").replace("${END_IF}", ""),
		)
		.replace(/\$\{IF_HUNT_PHASE\}[\s\S]*?\$\{END_IF\}/g, "");
}

function renderRefereePrompt(template, bug, dispute = null) {
	const ext = bug.file_path?.split(".").pop() || "";
	const langMap = {
		js: "javascript",
		ts: "typescript",
		py: "python",
		rb: "ruby",
		go: "go",
		rs: "rust",
	};
	const lang = langMap[ext] || ext;

	let rendered = template
		.replace(/\$\{BUG_ID\}/g, bug.id.toString())
		.replace(/\$\{CLAIMING_AGENT\}/g, bug.agent_id)
		.replace(/\$\{CATEGORY\}/g, bug.category)
		.replace(/\$\{FILE_PATH\}/g, bug.file_path)
		.replace(/\$\{LINE_START\}/g, bug.line_start?.toString() || "?")
		.replace(/\$\{LINE_END\}/g, bug.line_end?.toString() || "?")
		.replace(/\$\{DESCRIPTION\}/g, bug.description)
		.replace(/\$\{LANGUAGE\}/g, lang)
		.replace(
			/\$\{CODE_SNIPPET\}/g,
			bug.code_snippet || "_No snippet provided_",
		);

	if (dispute) {
		rendered = rendered
			.replace(/\$\{DISPUTING_AGENT\}/g, dispute.disputer_id)
			.replace(/\$\{DISPUTE_REASON\}/g, dispute.reason);
	} else {
		rendered = rendered
			.replace(/\$\{DISPUTING_AGENT\}/g, "_None_")
			.replace(/\$\{DISPUTE_REASON\}/g, "_No dispute_");
	}

	return rendered;
}

const commands = {
	setup: (
		projectUrl,
		numAgents = 3,
		targetScore = 21,
		huntDuration = 180,
		reviewDuration = 120,
		categories = "all",
	) => {
		const game = gameState(
			"create-game",
			projectUrl,
			numAgents,
			targetScore,
			huntDuration,
			reviewDuration,
			categories,
		);

		const agents = [];
		for (let i = 1; i <= parseInt(numAgents); i++) {
			const agentId = `agent_${i}`;
			gameState("add-agent", game.id, agentId);
			agents.push(agentId);
		}

		return {
			action: "GAME_CREATED",
			gameId: game.id,
			agents,
			config: { targetScore, huntDuration, reviewDuration, categories },
			next: `Run: node orchestrator.mjs start-hunt ${game.id}`,
		};
	},

	"start-hunt": (gameId) => {
		const result = gameState("start-round", gameId);
		if (result.error) return { error: result.error };

		const state = gameState("game-state", gameId);
		const scoreboard = gameState("scoreboard", gameId);
		const template = loadPromptTemplate();

		const agents = state.agents.filter((a) => a.status === "active");
		const prompts = agents.map((a) => ({
			agentId: a.id,
			prompt: renderHuntPrompt(
				template,
				state.game,
				a.id,
				scoreboard,
				result.round,
			),
		}));

		return {
			action: "SPAWN_HUNT_AGENTS",
			round: result.round,
			phase: "hunt",
			endsAt: result.endsAt,
			durationSeconds: result.durationSeconds,
			agents: prompts,
			instructions: [
				'Spawn each agent as a parallel Task with subagent_type: "general-purpose"',
				"Each agent will hunt for bugs until phase time expires",
				"Agents will call finish-hunt when done",
				`Poll: node "${SCRIPTS}/orchestrator.mjs" check-hunt ${gameId}`,
				"When readyForReview=true, run: node orchestrator.mjs start-review " +
					gameId,
			],
		};
	},

	"check-hunt": (gameId) => {
		const result = gameState("check-hunt-complete", gameId);
		return {
			...result,
			next: result.readyForReview
				? `Run: node orchestrator.mjs start-hunt-scoring ${gameId}`
				: `Wait ${result.remainingSeconds}s, then check again`,
		};
	},

	"start-hunt-scoring": (gameId) => {
		const result = gameState("start-hunt-scoring", gameId);
		if (result.error)
			return {
				error: result.error,
				hint: "All agents must call finish-hunt first",
			};

		const pendingBugs = gameState("get-pending-bugs", gameId);
		const template = loadRefereeTemplate();

		const bugPrompts = pendingBugs.map((bug) => ({
			bugId: bug.id,
			type: "bug_validation",
			prompt: renderRefereePrompt(template, bug),
		}));

		return {
			action: "VALIDATE_BUGS",
			round: result.round,
			phase: "hunt_scoring",
			pendingBugs: pendingBugs.length,
			bugValidations: bugPrompts,
			instructions: [
				"For each bug:",
				'  1. Spawn referee Task with model: "opus" (ultrathink)',
				"  2. Parse VERDICT: VALID or VERDICT: FALSE from response",
				"  3. For VALID verdicts, parse CONFIDENCE: high|medium|low (default: medium)",
				`  4. Run: node "${SCRIPTS}/game-state.mjs" validate-bug <bug_id> <VALID|FALSE> "<explanation>" [confidence]`,
				"     Confidence levels: high (clear bug), medium (likely issue), low (edge case)",
				"",
				`After all bugs validated: node orchestrator.mjs start-review ${gameId}`,
			],
		};
	},

	"start-review": (gameId) => {
		const result = gameState("start-review", gameId);
		if (result.error)
			return {
				error: result.error,
				hint: "Must be in hunt_scoring phase with all bugs validated",
			};

		const state = gameState("game-state", gameId);
		const scoreboard = gameState("scoreboard", gameId);
		const bugs = gameState("bugs", gameId);
		const template = loadPromptTemplate();

		// Now show VALIDATED bugs (not pending) so agents can see what was valid/false
		const validatedBugs = bugs.filter((b) => b.status !== "pending");

		const agents = state.agents.filter((a) => a.status === "active");
		const prompts = agents.map((a) => ({
			agentId: a.id,
			prompt: renderReviewPrompt(
				template,
				state.game,
				a.id,
				scoreboard,
				validatedBugs,
				state.game.current_round,
			),
		}));

		return {
			action: "SPAWN_REVIEW_AGENTS",
			round: state.game.current_round,
			phase: "review",
			endsAt: result.endsAt,
			durationSeconds: result.durationSeconds,
			bugsToReview: validatedBugs.length,
			agents: prompts,
			instructions: [
				'Spawn each agent as a parallel Task with subagent_type: "general-purpose"',
				"Agents see VALIDATED bugs and can dispute the referee's decisions",
				"Agents will call finish-review when done",
				`Poll: node "${SCRIPTS}/orchestrator.mjs" check-review ${gameId}`,
				"When ready: node orchestrator.mjs start-review-scoring " + gameId,
			],
		};
	},

	"check-review": (gameId) => {
		const result = gameState("check-review-complete", gameId);
		return {
			...result,
			next: result.readyForScoring
				? `Run: node orchestrator.mjs start-review-scoring ${gameId}`
				: `Wait ${result.remainingSeconds}s, then check again`,
		};
	},

	"start-review-scoring": (gameId) => {
		const result = gameState("start-review-scoring", gameId);
		if (result.error)
			return {
				error: result.error,
				hint: "All agents must call finish-review first",
			};

		const pendingDisputes = gameState("get-pending-disputes", gameId);
		const bugs = gameState("bugs", gameId);
		const template = loadRefereeTemplate();

		const disputePrompts = pendingDisputes.map((d) => {
			const bug = bugs.find((b) => b.id === d.bug_id) || d;
			return {
				disputeId: d.id,
				bugId: d.bug_id,
				type: "dispute_resolution",
				prompt: renderRefereePrompt(template, bug, d),
			};
		});

		return {
			action: "RESOLVE_DISPUTES",
			round: result.round,
			phase: "review_scoring",
			pendingDisputes: pendingDisputes.length,
			disputeResolutions: disputePrompts,
			instructions:
				pendingDisputes.length > 0
					? [
							"For each dispute:",
							'  1. Spawn referee Task with model: "opus" (ultrathink)',
							"  2. Parse VERDICT: SUCCESSFUL or VERDICT: FAILED from response",
							`  3. Run: node "${SCRIPTS}/game-state.mjs" resolve-dispute <dispute_id> <SUCCESSFUL|FAILED> "<explanation>"`,
							"",
							`After all disputes resolved: node orchestrator.mjs check-winner ${gameId}`,
						]
					: [
							"No disputes to resolve.",
							`Run: node orchestrator.mjs check-winner ${gameId}`,
						],
		};
	},

	"check-winner": (gameId) => {
		const result = gameState("check-winner", gameId);
		const scoreboard = gameState("scoreboard", gameId);

		if (result.winner) {
			gameState("complete-game", gameId, result.winner);
			return {
				action: "GAME_COMPLETE",
				winner: result.winner,
				reason: result.reason,
				finalScores: scoreboard,
			};
		}

		if (result.tieBreaker) {
			return {
				action: "TIE_BREAKER",
				tiedAgents: result.tiedAgents,
				scores: scoreboard,
				next: `Run: node orchestrator.mjs start-hunt ${gameId}`,
			};
		}

		return {
			action: "CONTINUE",
			reason: result.reason,
			scores: scoreboard,
			next: `Run: node orchestrator.mjs start-hunt ${gameId}`,
		};
	},

	status: (gameId) => {
		const state = gameState("game-state", gameId);
		const phase = gameState("check-phase", gameId);
		return {
			game: state.game,
			phase,
			agents: state.agents,
			bugCount: state.bugs.length,
			disputeCount: state.disputes.length,
		};
	},
};

// CLI
const [, , command, ...args] = process.argv;

if (!command || command === "help") {
	console.log(`
Bug Hunt Orchestrator

Flow: hunt → hunt_scoring → review → review_scoring → (repeat)

SETUP:
  setup <url> [agents] [target] [hunt_secs] [review_secs] [categories]

GAME LOOP (run in order):
  start-hunt <game_id>          Start hunt phase, get agent prompts
  check-hunt <game_id>          Poll until ready
  start-hunt-scoring <game_id>  Validate bugs (referee prompts)
  start-review <game_id>        Start review phase, get agent prompts
  check-review <game_id>        Poll until ready
  start-review-scoring <game_id> Resolve disputes (referee prompts)
  check-winner <game_id>        Continue or end game

UTILITY:
  status <game_id>              Get current game state
`);
	process.exit(0);
}

if (commands[command]) {
	try {
		const result = commands[command](...args);
		console.log(JSON.stringify(result, null, 2));
	} catch (e) {
		console.error(JSON.stringify({ error: e.message }));
		process.exit(1);
	}
} else {
	console.error(JSON.stringify({ error: `Unknown command: ${command}` }));
	process.exit(1);
}
