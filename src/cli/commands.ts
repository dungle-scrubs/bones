import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	HuntCategory,
	type ImpactTier,
	ISSUE_TYPES_BY_CATEGORY,
	type IssueType,
	RejectionReason,
} from "../domain/types.js";
import {
	ensureDashboardRunning,
	getDashboardUrl,
} from "../services/DashboardLauncher.js";
import {
	type GameEvent,
	GameRunner,
	type PlayConfig,
} from "../services/GameRunner.js";
import type { Orchestrator, SetupConfig } from "../services/Orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
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
	 * Format varies by verdict:
	 * - VALID: validate <game_id> <finding_id> VALID <explanation> <confidence_score> <issue_type> <impact_tier> <needs_verification>
	 * - FALSE: validate <game_id> <finding_id> FALSE <explanation> <confidence_score> <rejection_reason>
	 * - DUPLICATE: validate <game_id> <finding_id> DUPLICATE <explanation> <duplicate_of_id>
	 */
	validate(args: string[]): string {
		const [gameId, findingIdStr, verdict, explanation, ...rest] = args;

		if (!gameId || !findingIdStr || !verdict || !explanation) {
			return JSON.stringify({
				error: `Usage:
  VALID:     validate <game_id> <finding_id> VALID <explanation> <confidence_score> <issue_type> <impact_tier> <needs_verification>
  FALSE:     validate <game_id> <finding_id> FALSE <explanation> <confidence_score> <rejection_reason>
  DUPLICATE: validate <game_id> <finding_id> DUPLICATE <explanation> <duplicate_of_id>`,
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

		let confidence: "high" | "medium" | "low" | undefined;
		let confidenceScore: number | undefined;
		let issueType: IssueType | undefined;
		let impactTier: ImpactTier | undefined;
		let rejectionReason: RejectionReason | undefined;
		let needsVerification = false;
		let duplicateOfId: number | undefined;

		if (normalizedVerdict === "VALID") {
			// VALID: confidence_score, issue_type, impact_tier, needs_verification
			const [scoreStr, issueTypeStr, impactStr, verifyStr] = rest;

			if (!scoreStr || !issueTypeStr || !impactStr) {
				return JSON.stringify({
					error:
						"VALID requires: <confidence_score> <issue_type> <impact_tier> <needs_verification>",
				});
			}

			confidenceScore = parseInt(scoreStr, 10);
			if (
				Number.isNaN(confidenceScore) ||
				confidenceScore < 0 ||
				confidenceScore > 100
			) {
				return JSON.stringify({
					error: `confidence_score must be 0-100, got: ${scoreStr}`,
				});
			}

			// Map score to legacy confidence level
			confidence =
				confidenceScore >= 90
					? "high"
					: confidenceScore >= 70
						? "medium"
						: "low";

			issueType = issueTypeStr as IssueType;

			const validImpacts = ["critical", "major", "minor"];
			if (!validImpacts.includes(impactStr)) {
				return JSON.stringify({
					error: `Invalid impact_tier: ${impactStr}. Valid: ${validImpacts.join(", ")}`,
				});
			}
			impactTier = impactStr as ImpactTier;

			if (verifyStr) {
				if (verifyStr !== "true" && verifyStr !== "false") {
					return JSON.stringify({
						error: `Invalid needs_verification: ${verifyStr}. Must be true or false`,
					});
				}
				needsVerification = verifyStr === "true";
			}
		} else if (normalizedVerdict === "FALSE") {
			// FALSE: confidence_score, rejection_reason
			const [scoreStr, reasonStr] = rest;

			if (!scoreStr || !reasonStr) {
				return JSON.stringify({
					error: "FALSE requires: <confidence_score> <rejection_reason>",
				});
			}

			confidenceScore = parseInt(scoreStr, 10);
			if (
				Number.isNaN(confidenceScore) ||
				confidenceScore < 0 ||
				confidenceScore > 100
			) {
				return JSON.stringify({
					error: `confidence_score must be 0-100, got: ${scoreStr}`,
				});
			}

			confidence =
				confidenceScore >= 90
					? "high"
					: confidenceScore >= 70
						? "medium"
						: "low";

			const validReasons = Object.values(RejectionReason) as string[];
			if (!validReasons.includes(reasonStr)) {
				return JSON.stringify({
					error: `Invalid rejection_reason: ${reasonStr}. Valid: ${validReasons.join(", ")}`,
				});
			}
			rejectionReason = reasonStr as RejectionReason;
		} else {
			// DUPLICATE: duplicate_of_id
			const [dupIdStr] = rest;

			if (!dupIdStr) {
				return JSON.stringify({
					error: "DUPLICATE requires: <duplicate_of_id>",
				});
			}

			duplicateOfId = parseInt(dupIdStr, 10);
			if (Number.isNaN(duplicateOfId)) {
				return JSON.stringify({
					error: `Invalid duplicate_of_id: ${dupIdStr}`,
				});
			}
		}

		const result = this.orchestrator.validateFinding(
			gameId,
			findingId,
			normalizedVerdict as "VALID" | "FALSE" | "DUPLICATE",
			explanation,
			confidence,
			duplicateOfId,
			confidenceScore,
			issueType,
			impactTier,
			rejectionReason,
			needsVerification,
		);

		return JSON.stringify({
			success: true,
			findingId,
			verdict: result.verdict,
			duplicateOfId: result.duplicateOfId,
			confidence,
			confidenceScore,
			issueType,
			impactTier,
			rejectionReason,
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
	 * CONFIRM: verify <game_id> <finding_id> CONFIRM <explanation> [corrected_issue_type]
	 * REJECT: verify <game_id> <finding_id> REJECT <explanation> <rejection_reason>
	 */
	verify(args: string[]): string {
		const [gameId, findingIdStr, verdict, explanation, typeOrReason] = args;

		if (!gameId || !findingIdStr || !verdict || !explanation) {
			return JSON.stringify({
				error: `Usage:
  CONFIRM: verify <game_id> <finding_id> CONFIRM <explanation> [corrected_issue_type]
  REJECT:  verify <game_id> <finding_id> REJECT <explanation> <rejection_reason>`,
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

		let issueType: IssueType | undefined;
		let rejectionReason: RejectionReason | undefined;

		if (normalizedVerdict === "CONFIRM") {
			// Optional issue type override
			if (typeOrReason) {
				issueType = typeOrReason as IssueType;
			}
		} else {
			// REJECT requires rejection_reason
			if (!typeOrReason) {
				return JSON.stringify({
					error: "REJECT requires: <rejection_reason>",
				});
			}

			const validReasons = Object.values(RejectionReason) as string[];
			if (!validReasons.includes(typeOrReason)) {
				return JSON.stringify({
					error: `Invalid rejection_reason: ${typeOrReason}. Valid: ${validReasons.join(", ")}`,
				});
			}
			rejectionReason = typeOrReason as RejectionReason;
		}

		const result = this.orchestrator.verifyFinding(
			gameId,
			findingId,
			normalizedVerdict === "CONFIRM",
			explanation,
			issueType,
			rejectionReason,
		);

		return JSON.stringify({
			success: true,
			findingId,
			confirmed: result.confirmed,
			points: result.points,
			issueType,
			rejectionReason,
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

	/**
	 * Runs a fully autonomous game. Spawns LLM agents for all roles.
	 * Uses pi-agent-core for agent loops and pi-ai for model resolution.
	 *
	 * @param args - CLI arguments: <project_url> [options]
	 * @returns JSON summary when game completes
	 */
	async play(args: string[]): Promise<string> {
		const projectUrl = args[0];
		if (!projectUrl) {
			return JSON.stringify({
				error: `Usage: play <project_path> [options]
  --model <provider/model>      Agent model (default: anthropic/claude-sonnet-4-0)
  --referee-model <provider/m>  Referee model (default: same as --model)
  --category <type>             Hunt category
  --target <score>              Target score (default: 10)
  --agents <count>              Number of agents (default: 3)
  --max-rounds <n>              Max rounds (default: 3)
  --thinking <level>            Agent thinking: off|minimal|low|medium|high (default: medium)
  --referee-thinking <level>    Referee thinking (default: high)`,
			});
		}

		// Lazy import to avoid loading pi-ai unless play is used
		const { getModel, registerBuiltInApiProviders } = await import(
			"@mariozechner/pi-ai"
		);
		registerBuiltInApiProviders();

		// Resolve project path
		const projectPath = resolve(projectUrl);
		if (!existsSync(projectPath)) {
			return JSON.stringify({
				error: `Project path not found: ${projectPath}`,
			});
		}

		// Parse play-specific options
		let modelSpec = "anthropic/claude-sonnet-4-0";
		let refereeModelSpec: string | undefined;
		let agentThinking: string = "medium";
		let refereeThinking: string = "high";

		const setupArgs: string[] = [projectUrl];
		let i = 1;
		while (i < args.length) {
			const flag = args[i];
			const value = args[i + 1];

			switch (flag) {
				case "--model":
					modelSpec = value;
					i += 2;
					break;
				case "--referee-model":
					refereeModelSpec = value;
					i += 2;
					break;
				case "--thinking":
					agentThinking = value;
					i += 2;
					break;
				case "--referee-thinking":
					refereeThinking = value;
					i += 2;
					break;
				default:
					// Pass through to setup config parsing
					setupArgs.push(flag);
					if (value && !value.startsWith("--")) {
						setupArgs.push(value);
						i += 2;
					} else {
						i += 1;
					}
					break;
			}
		}

		// Resolve models
		const [agentProvider, agentModelId] = modelSpec.split("/") as [
			string,
			string,
		];
		const agentModel = getModel(agentProvider as any, agentModelId as any);

		const refereeModel = refereeModelSpec
			? (() => {
					const [p, m] = refereeModelSpec!.split("/") as [string, string];
					return getModel(p as any, m as any);
				})()
			: agentModel;

		// Parse setup config from remaining args
		const config = this.parseSetupConfig(setupArgs);
		if ("error" in config) {
			return JSON.stringify(config);
		}

		const playConfig: PlayConfig = {
			...config,
			agentModel,
			refereeModel,
			agentThinking: agentThinking as any,
			refereeThinking: refereeThinking as any,
		};

		// Run the game
		const runner = new GameRunner(this.orchestrator, projectPath);

		for await (const event of runner.play(playConfig)) {
			this.logGameEvent(event);

			if (event.type === "game_complete") {
				return JSON.stringify(
					{
						winner: event.winner,
						reason: event.reason,
						totalCost: {
							totalTokens: event.totalCost.totalTokens,
							cost: `$${event.totalCost.cost.total.toFixed(4)}`,
						},
					},
					null,
					2,
				);
			}
		}

		return JSON.stringify({ error: "Game ended without a winner" });
	}

	/**
	 * Parses setup config from CLI args without the --web flag.
	 * Extracted for reuse between setup() and play().
	 *
	 * @param args - CLI arguments starting with project URL
	 * @returns SetupConfig or error object
	 */
	private parseSetupConfig(args: string[]): SetupConfig | { error: string } {
		const projectUrl = args[0];
		if (!projectUrl) {
			return { error: "Missing project URL" };
		}

		const config: SetupConfig = { projectUrl };
		let i = 1;
		while (i < args.length) {
			const flag = args[i];
			const value = args[i + 1];

			if (value === undefined) {
				return { error: `Missing value for flag: ${flag}` };
			}

			switch (flag) {
				case "--category":
				case "-c":
					if (!VALID_CATEGORIES.includes(value as HuntCategory)) {
						return {
							error: `Invalid category: ${value}. Valid: ${VALID_CATEGORIES.join(", ")}`,
						};
					}
					config.category = value as HuntCategory;
					break;
				case "--focus":
				case "-f":
					config.userPrompt = value;
					break;
				case "--target":
				case "-t":
					config.targetScore = parseInt(value, 10);
					break;
				case "--agents":
				case "-a":
					config.numAgents = parseInt(value, 10);
					break;
				case "--max-rounds":
				case "-m":
					config.maxRounds = parseInt(value, 10);
					break;
				case "--hunt-duration":
				case "-h":
					config.huntDuration = parseInt(value, 10);
					break;
				case "--review-duration":
				case "-r":
					config.reviewDuration = parseInt(value, 10);
					break;
				default:
					return { error: `Unknown flag: ${flag}` };
			}
			i += 2;
		}

		return config;
	}

	/**
	 * Logs a GameEvent as a structured CLI line.
	 *
	 * @param event - GameEvent to format and print
	 */
	private logGameEvent(event: GameEvent): void {
		switch (event.type) {
			case "game_created":
				console.log(
					`[setup]   game=${event.gameId} agents=${event.agents.join(",")}`,
				);
				break;
			case "round_start":
				console.log(`\n[round]   === Round ${event.round} ===`);
				break;
			case "hunt_start":
				console.log(
					`[hunt]    starting round=${event.round} agents=${event.agentCount}`,
				);
				break;
			case "hunt_agent_done":
				console.log(
					`[hunt]    ${event.agentId} done turns=${event.result.turnCount} cost=$${event.result.totalUsage.cost.total.toFixed(4)}`,
				);
				break;
			case "hunt_end":
				console.log(`[hunt]    round=${event.round} complete`);
				break;
			case "scoring_start":
				console.log(`[referee] validating ${event.findingCount} findings`);
				break;
			case "finding_validated":
				console.log(`[referee] finding #${event.findingId} → ${event.verdict}`);
				break;
			case "scoring_end":
				console.log(`[referee] scoring complete`);
				break;
			case "verification_start":
				console.log(`[verify]  verifying ${event.count} uncertain findings`);
				break;
			case "finding_verified":
				console.log(
					`[verify]  finding #${event.findingId} → ${event.confirmed ? "CONFIRMED" : "REJECTED"}`,
				);
				break;
			case "verification_end":
				console.log(`[verify]  verification complete`);
				break;
			case "review_start":
				console.log(
					`[review]  starting round=${event.round} agents=${event.agentCount}`,
				);
				break;
			case "review_agent_done":
				console.log(
					`[review]  ${event.agentId} done turns=${event.result.turnCount} cost=$${event.result.totalUsage.cost.total.toFixed(4)}`,
				);
				break;
			case "review_end":
				console.log(`[review]  round=${event.round} complete`);
				break;
			case "dispute_scoring_start":
				console.log(`[referee] resolving ${event.disputeCount} disputes`);
				break;
			case "dispute_resolved":
				console.log(`[referee] dispute #${event.disputeId} → ${event.verdict}`);
				break;
			case "dispute_scoring_end":
				console.log(`[referee] dispute resolution complete`);
				break;
			case "round_complete":
				console.log(
					`[round]   ${event.action}${event.winner ? ` winner=${event.winner}` : ""} — ${event.reason}`,
				);
				break;
			case "game_complete":
				console.log(`\n[winner]  ${event.winner} — ${event.reason}`);
				console.log(
					`[cost]    tokens=${event.totalCost.totalTokens} cost=$${event.totalCost.cost.total.toFixed(4)}`,
				);
				break;
		}
	}

	/**
	 * Initializes the project by installing dependencies for all components.
	 * Required before using --web flag or running the dashboard.
	 */
	init(): string {
		const projectRoot = join(__dirname, "..", "..");
		const dashboardDir = join(projectRoot, "apps", "dashboard");
		const results: { step: string; success: boolean; message?: string }[] = [];

		// Check pnpm is available
		const pnpmCheck = spawnSync("pnpm", ["--version"], { encoding: "utf-8" });
		if (pnpmCheck.status !== 0) {
			return JSON.stringify({
				error:
					"pnpm is required but not found. Install with: npm install -g pnpm",
			});
		}

		// Install root dependencies if node_modules missing
		const rootNodeModules = join(projectRoot, "node_modules");
		if (!existsSync(rootNodeModules)) {
			console.log("Installing root dependencies...");
			try {
				execSync("pnpm install", { cwd: projectRoot, stdio: "inherit" });
				results.push({ step: "root dependencies", success: true });
			} catch {
				results.push({
					step: "root dependencies",
					success: false,
					message: "pnpm install failed",
				});
			}
		} else {
			results.push({
				step: "root dependencies",
				success: true,
				message: "already installed",
			});
		}

		// Install dashboard dependencies
		const dashboardNodeModules = join(dashboardDir, "node_modules");
		if (!existsSync(dashboardNodeModules)) {
			console.log("Installing dashboard dependencies...");
			try {
				execSync("pnpm install", { cwd: dashboardDir, stdio: "inherit" });
				results.push({ step: "dashboard dependencies", success: true });
			} catch {
				results.push({
					step: "dashboard dependencies",
					success: false,
					message: "pnpm install failed in apps/dashboard",
				});
			}
		} else {
			results.push({
				step: "dashboard dependencies",
				success: true,
				message: "already installed",
			});
		}

		// Build TypeScript
		console.log("Building TypeScript...");
		try {
			execSync("pnpm build", { cwd: projectRoot, stdio: "inherit" });
			results.push({ step: "typescript build", success: true });
		} catch {
			results.push({
				step: "typescript build",
				success: false,
				message: "pnpm build failed",
			});
		}

		const allSuccess = results.every((r) => r.success);
		return JSON.stringify(
			{
				success: allSuccess,
				results,
				message: allSuccess
					? "Initialization complete. You can now use --web flag."
					: "Some steps failed. Check errors above.",
			},
			null,
			2,
		);
	}
}
