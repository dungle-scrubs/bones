import { BugCategory, HuntCategory } from "../domain/types.js";
import {
	ensureDashboardRunning,
	getDashboardUrl,
} from "../services/DashboardLauncher.js";
import type { Orchestrator, SetupConfig } from "../services/Orchestrator.js";

const VALID_CATEGORIES = Object.values(HuntCategory);

/**
 * CLI command handlers that parse arguments and delegate to Orchestrator.
 * Each method returns a JSON string for CLI output.
 */
export class Commands {
	constructor(private orchestrator: Orchestrator) {}

	/**
	 * Creates a new game with agents. Parses config options from args.
	 * With --web flag, starts API server and dashboard.
	 */
	async setup(args: string[]): Promise<string> {
		const projectUrl = args[0];
		if (!projectUrl) {
			return JSON.stringify({
				error: `Usage: setup <project_url> [--web] [--category <${VALID_CATEGORIES.join("|")}>] [--focus <additional_prompt>] [--target <score>] [--hunt-duration <seconds>] [--review-duration <seconds>] [--agents <count>] [--max-rounds <count|0>]`,
			});
		}

		const config: SetupConfig = { projectUrl };
		let startWeb = false;

		// Parse optional arguments
		let i = 1;
		while (i < args.length) {
			const flag = args[i];

			// Handle boolean flags (no value)
			if (flag === "--web" || flag === "-w") {
				startWeb = true;
				i += 1;
				continue;
			}

			const value = args[i + 1];

			if (value === undefined) {
				return JSON.stringify({ error: `Missing value for flag: ${flag}` });
			}

			switch (flag) {
				case "--category":
				case "-c":
					if (!VALID_CATEGORIES.includes(value as HuntCategory)) {
						return JSON.stringify({
							error: `Invalid category: ${value}. Valid categories: ${VALID_CATEGORIES.join(", ")}`,
						});
					}
					config.category = value as HuntCategory;
					break;
				case "--focus":
				case "-f":
					config.userPrompt = value;
					break;
				// Legacy support for --prompt (maps to custom category + user prompt)
				case "--prompt":
				case "-p":
					config.category = HuntCategory.Custom;
					config.userPrompt = value;
					break;
				case "--target":
				case "-t": {
					const parsed = parseInt(value, 10);
					if (Number.isNaN(parsed) || parsed < 1) {
						return JSON.stringify({
							error: `--target must be a positive integer, got: ${value}`,
						});
					}
					config.targetScore = parsed;
					break;
				}
				case "--hunt-duration":
				case "-h": {
					const parsed = parseInt(value, 10);
					if (Number.isNaN(parsed) || parsed < 1) {
						return JSON.stringify({
							error: `--hunt-duration must be a positive integer, got: ${value}`,
						});
					}
					config.huntDuration = parsed;
					break;
				}
				case "--review-duration":
				case "-r": {
					const parsed = parseInt(value, 10);
					if (Number.isNaN(parsed) || parsed < 1) {
						return JSON.stringify({
							error: `--review-duration must be a positive integer, got: ${value}`,
						});
					}
					config.reviewDuration = parsed;
					break;
				}
				case "--agents":
				case "-a": {
					const parsed = parseInt(value, 10);
					if (Number.isNaN(parsed) || parsed < 1) {
						return JSON.stringify({
							error: `--agents must be a positive integer, got: ${value}`,
						});
					}
					config.numAgents = parsed;
					break;
				}
				case "--max-rounds":
				case "-m": {
					const parsed = parseInt(value, 10);
					if (Number.isNaN(parsed) || parsed < 0) {
						return JSON.stringify({
							error: `--max-rounds must be a non-negative integer (0 = unlimited), got: ${value}`,
						});
					}
					config.maxRounds = parsed; // 0 = no limit
					break;
				}
				default:
					return JSON.stringify({
						error: `Unknown flag: ${flag}. Valid flags: --web, --category, --focus, --prompt, --target, --hunt-duration, --review-duration, --agents, --max-rounds`,
					});
			}
			i += 2;
		}

		// Check for conflicts between userPrompt and category exclusions
		const conflicts = this.orchestrator.checkConflicts(config);
		if (conflicts) {
			return JSON.stringify(conflicts, null, 2);
		}

		const result = this.orchestrator.setup(config);

		// Start web services if --web flag provided
		if (startWeb) {
			const dashboard = await ensureDashboardRunning();
			const dashboardUrl = getDashboardUrl(result.gameId);

			// Print URLs prominently
			console.log(`\n🌐 API Server: ${dashboard.api.url}`);
			console.log(`📊 Dashboard:  ${dashboardUrl}\n`);

			return JSON.stringify(
				{
					...result,
					dashboard: {
						url: dashboardUrl,
						api: dashboard.api.url,
						started: dashboard.started,
					},
				},
				null,
				2,
			);
		}

		return JSON.stringify(result, null, 2);
	}

	/** Starts the hunt phase, returning agent prompts to spawn. */
	startHunt(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: start-hunt <game_id>" });
		}

		const result = this.orchestrator.startHunt(gameId);
		return JSON.stringify(result, null, 2);
	}

	/** Checks if hunt phase is ready for scoring. */
	checkHunt(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: check-hunt <game_id>" });
		}

		const result = this.orchestrator.checkHunt(gameId);
		return JSON.stringify(result, null, 2);
	}

	/** Transitions to hunt scoring, returning validation prompts. */
	startHuntScoring(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: start-hunt-scoring <game_id>" });
		}

		const result = this.orchestrator.startHuntScoring(gameId);
		return JSON.stringify(result, null, 2);
	}

	/**
	 * Records a referee's validation decision for a finding.
	 * New format: validate <game_id> <finding_id> <verdict> <explanation> <confidence_score> <bug_category> <needs_verification> [duplicate_of_id]
	 * Legacy format: validate <game_id> <finding_id> <verdict> <explanation> [confidence] [duplicate_of_id]
	 */
	validate(args: string[]): string {
		const [gameId, findingIdStr, verdict, explanation, arg5, arg6, arg7, arg8] =
			args;

		if (!gameId || !findingIdStr || !verdict || !explanation) {
			return JSON.stringify({
				error:
					"Usage: validate <game_id> <finding_id> <VALID|FALSE|DUPLICATE> <explanation> <confidence_score:0-100> <bug_category:incorrect_behavior|defensive_programming|convention> <needs_verification:true|false> [duplicate_of_id]",
			});
		}

		const findingId = parseInt(findingIdStr, 10);
		if (Number.isNaN(findingId)) {
			return JSON.stringify({ error: "finding_id must be a valid integer" });
		}

		const normalizedVerdict = verdict.toUpperCase();
		if (!["VALID", "FALSE", "DUPLICATE"].includes(normalizedVerdict)) {
			return JSON.stringify({
				error: "verdict must be VALID, FALSE, or DUPLICATE",
			});
		}

		// Determine if new or legacy format based on arg5 AND arg6
		// New format requires: confidence_score (0-100) AND bug_category
		// Legacy format may have: duplicate_of_id (any integer) or confidence (high|medium|low)
		const validCategories = Object.values(BugCategory) as string[];
		const isNewFormat =
			arg5 !== undefined &&
			!Number.isNaN(parseInt(arg5, 10)) &&
			parseInt(arg5, 10) >= 0 &&
			parseInt(arg5, 10) <= 100 &&
			arg6 !== undefined &&
			validCategories.includes(arg6);

		let confidence: "high" | "medium" | "low" | undefined;
		let confidenceScore: number | undefined;
		let bugCategory: BugCategory | undefined;
		let needsVerification = false;
		let duplicateOfId: number | undefined;

		if (isNewFormat) {
			// New format: confidence_score, bug_category, needs_verification, [duplicate_of_id]
			confidenceScore = parseInt(arg5, 10);

			// Map score to legacy confidence level
			if (confidenceScore >= 90) {
				confidence = "high";
			} else if (confidenceScore >= 70) {
				confidence = "medium";
			} else {
				confidence = "low";
			}

			// Parse bug_category (already validated in isNewFormat check)
			bugCategory = arg6 as BugCategory;

			// Parse needs_verification
			if (arg7) {
				if (arg7 !== "true" && arg7 !== "false") {
					return JSON.stringify({
						error: `Invalid needs_verification: ${arg7}. Must be true or false`,
					});
				}
				needsVerification = arg7 === "true";
			}

			// Parse duplicate_of_id (optional)
			if (arg8) {
				duplicateOfId = parseInt(arg8, 10);
				if (Number.isNaN(duplicateOfId)) {
					return JSON.stringify({
						error: `Invalid duplicate_of_id: ${arg8}`,
					});
				}
			}
		} else {
			// Legacy format: [confidence:high|medium|low] [duplicate_of_id]
			if (arg5) {
				if (["high", "medium", "low"].includes(arg5.toLowerCase())) {
					confidence = arg5.toLowerCase() as "high" | "medium" | "low";
					if (arg6) {
						duplicateOfId = parseInt(arg6, 10);
						if (Number.isNaN(duplicateOfId)) {
							return JSON.stringify({
								error: `Invalid duplicate_of_id: ${arg6}`,
							});
						}
					}
				} else {
					duplicateOfId = parseInt(arg5, 10);
					if (Number.isNaN(duplicateOfId)) {
						return JSON.stringify({
							error: `Invalid value: "${arg5}". Expected confidence (high|medium|low) or duplicate_of_id (integer)`,
						});
					}
				}
			}
		}

		// Validate duplicate_of_id is only provided for DUPLICATE verdict
		if (duplicateOfId !== undefined && normalizedVerdict !== "DUPLICATE") {
			return JSON.stringify({
				error: `duplicate_of_id provided but verdict is ${normalizedVerdict}, not DUPLICATE`,
			});
		}

		const result = this.orchestrator.validateFinding(
			gameId,
			findingId,
			normalizedVerdict as "VALID" | "FALSE" | "DUPLICATE",
			explanation,
			confidence,
			duplicateOfId,
			confidenceScore,
			bugCategory,
			needsVerification,
		);

		return JSON.stringify({
			success: true,
			findingId,
			verdict: result.verdict,
			duplicateOfId: result.duplicateOfId,
			confidence,
			confidenceScore,
			bugCategory,
			needsVerification: result.needsVerification,
		});
	}

	/**
	 * Returns findings that need verification before scoring completes.
	 * Used to spawn verification agents for uncertain findings.
	 */
	getPendingVerifications(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({
				error: "Usage: pending-verifications <game_id>",
			});
		}

		const result = this.orchestrator.getPendingVerifications(gameId);
		return JSON.stringify(result, null, 2);
	}

	/**
	 * Records a verification agent's decision on an uncertain finding.
	 * CONFIRM = it's a real bug, REJECT = it's not
	 */
	verify(args: string[]): string {
		const [gameId, findingIdStr, verdict, explanation, categoryOverride] = args;

		if (!gameId || !findingIdStr || !verdict || !explanation) {
			return JSON.stringify({
				error:
					"Usage: verify <game_id> <finding_id> <CONFIRM|REJECT> <explanation> [corrected_category]",
			});
		}

		const findingId = parseInt(findingIdStr, 10);
		if (Number.isNaN(findingId)) {
			return JSON.stringify({ error: "finding_id must be a valid integer" });
		}

		const normalizedVerdict = verdict.toUpperCase();
		if (!["CONFIRM", "REJECT"].includes(normalizedVerdict)) {
			return JSON.stringify({
				error: "verdict must be CONFIRM or REJECT",
			});
		}

		// Parse optional category override
		let bugCategory: BugCategory | undefined;
		if (categoryOverride) {
			const validCategories = Object.values(BugCategory) as string[];
			if (!validCategories.includes(categoryOverride)) {
				return JSON.stringify({
					error: `Invalid category: ${categoryOverride}. Valid values: ${validCategories.join(", ")}`,
				});
			}
			bugCategory = categoryOverride as BugCategory;
		}

		const result = this.orchestrator.verifyFinding(
			gameId,
			findingId,
			normalizedVerdict === "CONFIRM",
			explanation,
			bugCategory,
		);

		return JSON.stringify({
			success: true,
			findingId,
			confirmed: result.confirmed,
			points: result.points,
			category: bugCategory,
		});
	}

	/** Transitions game to review phase where agents can dispute others' findings. */
	startReview(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: start-review <game_id>" });
		}

		const result = this.orchestrator.startReview(gameId);
		return JSON.stringify(result, null, 2);
	}

	/** Checks if review phase is ready for dispute resolution. */
	checkReview(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: check-review <game_id>" });
		}

		const result = this.orchestrator.checkReview(gameId);
		return JSON.stringify(result, null, 2);
	}

	/** Transitions to review scoring, returning dispute resolution prompts. */
	startReviewScoring(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: start-review-scoring <game_id>" });
		}

		const result = this.orchestrator.startReviewScoring(gameId);
		return JSON.stringify(result, null, 2);
	}

	/** Records a referee's resolution decision for a dispute. */
	resolve(args: string[]): string {
		const [gameId, disputeIdStr, verdict, explanation] = args;

		if (!gameId || !disputeIdStr || !verdict || !explanation) {
			return JSON.stringify({
				error:
					"Usage: resolve <game_id> <dispute_id> <SUCCESSFUL|FAILED> <explanation>",
			});
		}

		const disputeId = parseInt(disputeIdStr, 10);
		if (Number.isNaN(disputeId)) {
			return JSON.stringify({ error: "dispute_id must be a valid integer" });
		}

		const normalizedVerdict = verdict.toUpperCase();
		if (!["SUCCESSFUL", "FAILED"].includes(normalizedVerdict)) {
			return JSON.stringify({
				error: "verdict must be SUCCESSFUL or FAILED",
			});
		}

		this.orchestrator.resolveDispute(
			gameId,
			disputeId,
			normalizedVerdict as "SUCCESSFUL" | "FAILED",
			explanation,
		);

		return JSON.stringify({
			success: true,
			disputeId,
			verdict: normalizedVerdict,
		});
	}

	/** Checks if any agent has reached the target score and returns game outcome. */
	checkWinner(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: check-winner <game_id>" });
		}

		const result = this.orchestrator.checkWinner(gameId);
		return JSON.stringify(result, null, 2);
	}

	/** Submits a new finding from an agent during the hunt phase. */
	submit(args: string[]): string {
		const [
			gameId,
			agentId,
			filePath,
			lineStartStr,
			lineEndStr,
			description,
			codeSnippet,
		] = args;

		if (
			!gameId ||
			!agentId ||
			!filePath ||
			!lineStartStr ||
			!lineEndStr ||
			!description
		) {
			return JSON.stringify({
				error:
					"Usage: submit <game_id> <agent_id> <file_path> <line_start> <line_end> <description> [code_snippet]",
			});
		}

		const lineStart = parseInt(lineStartStr, 10);
		const lineEnd = parseInt(lineEndStr, 10);

		if (Number.isNaN(lineStart) || Number.isNaN(lineEnd)) {
			return JSON.stringify({
				error: "line_start and line_end must be valid integers",
			});
		}

		if (lineStart < 1 || lineEnd < 1 || lineEnd < lineStart) {
			return JSON.stringify({
				error:
					"Invalid line range: line_start and line_end must be positive and line_end >= line_start",
			});
		}

		const findingId = this.orchestrator.submitFinding(
			gameId,
			agentId,
			filePath,
			lineStart,
			lineEnd,
			description,
			codeSnippet,
		);

		return JSON.stringify({ success: true, findingId });
	}

	/** Submits a dispute from an agent challenging another agent's finding. */
	dispute(args: string[]): string {
		const [gameId, agentId, findingIdStr, reason] = args;

		if (!gameId || !agentId || !findingIdStr || !reason) {
			return JSON.stringify({
				error: "Usage: dispute <game_id> <agent_id> <finding_id> <reason>",
			});
		}

		const findingId = parseInt(findingIdStr, 10);
		if (Number.isNaN(findingId)) {
			return JSON.stringify({ error: "finding_id must be a valid integer" });
		}

		const disputeId = this.orchestrator.submitDispute(
			gameId,
			agentId,
			findingId,
			reason,
		);

		return JSON.stringify({ success: true, disputeId });
	}

	/** Marks an agent as finished with the current phase (hunt or review). */
	done(args: string[]): string {
		const [gameId, agentId, phase] = args;

		if (
			!gameId ||
			!agentId ||
			!phase ||
			(phase !== "hunt" && phase !== "review")
		) {
			return JSON.stringify({
				error: "Usage: done <game_id> <agent_id> <hunt|review>",
			});
		}

		this.orchestrator.markAgentDone(gameId, agentId, phase);
		return JSON.stringify({ success: true, agentId, phase });
	}

	/** Returns current game state including phase, round, timer, and scoreboard. */
	status(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: status <game_id>" });
		}

		const game = this.orchestrator.getGame(gameId);
		if (!game) {
			return JSON.stringify({ error: `Game not found: ${gameId}` });
		}

		const scoreboard = this.orchestrator.getScoreboard(gameId);

		return JSON.stringify(
			{
				gameId: game.id,
				category: game.category,
				phase: game.phase,
				round: game.round,
				targetScore: game.config.targetScore,
				phaseEndsAt: game.phaseEndsAt?.toISOString() ?? null,
				timeRemaining: game.timeRemaining,
				winner: game.winnerId,
				scoreboard,
			},
			null,
			2,
		);
	}

	/** Lists all findings for a game with summary info (status, points, truncated description). */
	findings(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: findings <game_id>" });
		}

		const findings = this.orchestrator.getFindings(gameId);
		return JSON.stringify(
			findings.map((f) => ({
				id: f.id,
				round: f.roundNumber,
				agentId: f.agentId,
				filePath: f.filePath,
				lines: `${f.lineStart}-${f.lineEnd}`,
				status: f.status,
				points: f.pointsAwarded,
				description:
					f.description.slice(0, 100) +
					(f.description.length > 100 ? "..." : ""),
			})),
			null,
			2,
		);
	}

	/** Lists all disputes for a game with resolution status and points. */
	disputes(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: disputes <game_id>" });
		}

		const disputes = this.orchestrator.getDisputes(gameId);
		return JSON.stringify(
			disputes.map((d) => ({
				id: d.id,
				round: d.roundNumber,
				findingId: d.findingId,
				disputerId: d.disputerId,
				status: d.status,
				points: d.pointsAwarded,
				reason: d.reason.slice(0, 100) + (d.reason.length > 100 ? "..." : ""),
			})),
			null,
			2,
		);
	}

	/** Exports game results to logs directory (markdown + JSON reports). */
	export(args: string[]): string {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: export <game_id>" });
		}

		const result = this.orchestrator.exportGame(gameId);
		return JSON.stringify(result, null, 2);
	}

	/** Launches interactive terminal UI for real-time game monitoring. */
	async ui(args: string[]): Promise<string> {
		const gameId = args[0];
		if (!gameId) {
			return JSON.stringify({ error: "Usage: ui <game_id>" });
		}

		const game = this.orchestrator.getGame(gameId);
		if (!game) {
			return JSON.stringify({ error: `Game not found: ${gameId}` });
		}

		// Dynamic import to avoid loading ink/react unless needed
		const { render } = await import("ink");
		const React = await import("react");
		const { GameUI } = await import("./ui/GameUI.js");

		const { waitUntilExit } = render(
			React.createElement(GameUI, {
				gameId,
				orchestrator: this.orchestrator,
			}),
		);

		await waitUntilExit();
		return JSON.stringify({ exited: true });
	}
}
