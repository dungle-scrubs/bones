import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	HuntCategory,
	type ImpactTier,
	type IssueType,
	RejectionReason,
} from "../domain/types.js";
import { getOAuthKey, isLoggedIn, login, logout } from "../services/Auth.js";
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
const VALID_CATEGORIES = Object.values(HuntCategory) as string[];

/** Options parsed by commander for the `setup` command. */
export interface SetupOpts {
	web?: boolean;
	category?: string;
	focus?: string;
	prompt?: string;
	target?: string;
	agents?: string;
	maxRounds?: string;
	huntDuration?: string;
	reviewDuration?: string;
}

/** Options parsed by commander for the `play` command. */
export interface PlayOpts extends SetupOpts {
	model?: string;
	refereeModel?: string;
	thinking?: string;
	refereeThinking?: string;
	auth?: string;
	include?: string[];
	exclude?: string[];
	/** Output mode: "tui" (interactive Ink dashboard) or "json" (NDJSON for programmatic use). */
	output?: "tui" | "json";
}

/**
 * CLI command handlers. Commander handles arg parsing;
 * methods receive typed values and delegate to Orchestrator.
 * Each method returns a JSON string for CLI output.
 */
export class Commands {
	constructor(private orchestrator: Orchestrator) {}

	/**
	 * Runs the Anthropic OAuth login flow for Claude Pro/Max subscription auth.
	 * Opens browser, prompts for auth code, saves tokens to ~/.bones/oauth.json.
	 *
	 * @returns JSON result with login status
	 */
	async login(): Promise<string> {
		try {
			const credentials = await login(
				(url) => {
					console.log(`\nOpen this URL in your browser:\n  ${url}\n`);
					try {
						execSync(`open "${url}"`, { stdio: "ignore" });
					} catch {
						// Manual open is fine
					}
				},
				async () => {
					const readline = await import("node:readline");
					const rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout,
					});
					return new Promise<string>((resolve) => {
						rl.question("Paste the authorization code: ", (answer) => {
							rl.close();
							resolve(answer.trim());
						});
					});
				},
			);

			return JSON.stringify({
				success: true,
				message:
					"Logged in to Anthropic (Claude Pro/Max). Credentials saved to ~/.bones/oauth.json",
				expires: new Date(credentials.expires).toISOString(),
			});
		} catch (error) {
			return JSON.stringify({
				error: `Login failed: ${(error as Error).message}`,
			});
		}
	}

	/**
	 * Removes saved OAuth credentials.
	 *
	 * @returns JSON confirmation
	 */
	logoutCmd(): string {
		logout();
		return JSON.stringify({
			success: true,
			message: "Logged out. OAuth credentials removed.",
		});
	}

	/**
	 * Checks current OAuth authentication status.
	 *
	 * @returns JSON with auth status and expiry
	 */
	authStatus(): string {
		const loggedIn = isLoggedIn();
		return JSON.stringify({
			authenticated: loggedIn,
			provider: "anthropic",
			billing: loggedIn ? "Claude Pro/Max subscription" : "not authenticated",
			message: loggedIn
				? "Using OAuth subscription auth. Token is valid."
				: "Not logged in. Run 'bones login' to authenticate, or use ANTHROPIC_API_KEY for API billing.",
		});
	}

	/**
	 * Creates a new game with agents from commander-parsed options.
	 * With --web flag, starts API server and dashboard.
	 *
	 * @param projectUrl - Project URL or local path
	 * @param opts - Parsed commander options
	 * @returns JSON game setup result
	 */
	async setup(projectUrl: string, opts: SetupOpts): Promise<string> {
		const config = this.buildSetupConfig(projectUrl, opts);
		if ("error" in config) {
			return JSON.stringify(config);
		}

		const conflicts = this.orchestrator.checkConflicts(config);
		if (conflicts) {
			return JSON.stringify(conflicts, null, 2);
		}

		const result = this.orchestrator.setup(config);

		if (opts.web) {
			const dashboard = await ensureDashboardRunning();
			const dashboardUrl = getDashboardUrl(result.gameId);
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

	/**
	 * Starts the hunt phase, returning agent prompts to spawn.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON hunt phase result
	 */
	startHunt(gameId: string): string {
		return JSON.stringify(this.orchestrator.startHunt(gameId), null, 2);
	}

	/**
	 * Checks if hunt phase is ready for scoring.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON hunt check result
	 */
	checkHunt(gameId: string): string {
		return JSON.stringify(this.orchestrator.checkHunt(gameId), null, 2);
	}

	/**
	 * Transitions to hunt scoring, returning validation prompts.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON scoring phase result
	 */
	startHuntScoring(gameId: string): string {
		return JSON.stringify(this.orchestrator.startHuntScoring(gameId), null, 2);
	}

	/**
	 * Records a referee's validation decision for a finding.
	 * Verdict-specific extra args vary by type:
	 * - VALID: [confidenceScore, issueType, impactTier, needsVerification?]
	 * - FALSE: [confidenceScore, rejectionReason]
	 * - DUPLICATE: [duplicateOfId]
	 *
	 * @param gameId - Game identifier
	 * @param findingIdStr - Finding ID as string (parsed to int)
	 * @param verdict - VALID | FALSE | DUPLICATE
	 * @param explanation - Referee explanation
	 * @param extra - Verdict-specific positional args
	 * @returns JSON validation result
	 */
	validate(
		gameId: string,
		findingIdStr: string,
		verdict: string,
		explanation: string,
		extra: string[],
	): string {
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
			const [scoreStr, issueTypeStr, impactStr, verifyStr] = extra;
			if (!scoreStr || !issueTypeStr || !impactStr) {
				return JSON.stringify({
					error:
						"VALID requires: <confidence_score> <issue_type> <impact_tier> [needs_verification]",
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
			issueType = issueTypeStr as IssueType;

			const validImpacts = ["critical", "major", "minor"];
			if (!validImpacts.includes(impactStr)) {
				return JSON.stringify({
					error: `Invalid impact_tier: ${impactStr}. Valid: ${validImpacts.join(", ")}`,
				});
			}
			impactTier = impactStr as ImpactTier;

			if (verifyStr === "true") needsVerification = true;
			else if (verifyStr && verifyStr !== "false") {
				return JSON.stringify({
					error: `needs_verification must be true or false, got: ${verifyStr}`,
				});
			}
		} else if (normalizedVerdict === "FALSE") {
			const [scoreStr, reasonStr] = extra;
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
			const [dupIdStr] = extra;
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
	 *
	 * @param gameId - Game identifier
	 * @returns JSON list of pending verifications
	 */
	getPendingVerifications(gameId: string): string {
		return JSON.stringify(
			this.orchestrator.getPendingVerifications(gameId),
			null,
			2,
		);
	}

	/**
	 * Records a verification agent's decision on an uncertain finding.
	 *
	 * @param gameId - Game identifier
	 * @param findingIdStr - Finding ID as string
	 * @param verdict - CONFIRM | REJECT
	 * @param explanation - Verifier explanation
	 * @param typeOrReason - Issue type (CONFIRM) or rejection reason (REJECT)
	 * @returns JSON verification result
	 */
	verify(
		gameId: string,
		findingIdStr: string,
		verdict: string,
		explanation: string,
		typeOrReason?: string,
	): string {
		const findingId = parseInt(findingIdStr, 10);
		if (Number.isNaN(findingId)) {
			return JSON.stringify({ error: "finding_id must be a valid integer" });
		}

		const normalizedVerdict = verdict.toUpperCase();
		if (!["CONFIRM", "REJECT"].includes(normalizedVerdict)) {
			return JSON.stringify({ error: "verdict must be CONFIRM or REJECT" });
		}

		let issueType: IssueType | undefined;
		let rejectionReason: RejectionReason | undefined;

		if (normalizedVerdict === "CONFIRM") {
			if (typeOrReason) issueType = typeOrReason as IssueType;
		} else {
			if (!typeOrReason) {
				return JSON.stringify({ error: "REJECT requires: <rejection_reason>" });
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

	/**
	 * Transitions game to review phase.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON review phase result
	 */
	startReview(gameId: string): string {
		return JSON.stringify(this.orchestrator.startReview(gameId), null, 2);
	}

	/**
	 * Checks if review phase is ready for dispute resolution.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON review check result
	 */
	checkReview(gameId: string): string {
		return JSON.stringify(this.orchestrator.checkReview(gameId), null, 2);
	}

	/**
	 * Transitions to review scoring, returning dispute resolution prompts.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON scoring phase result
	 */
	startReviewScoring(gameId: string): string {
		return JSON.stringify(
			this.orchestrator.startReviewScoring(gameId),
			null,
			2,
		);
	}

	/**
	 * Records a referee's resolution decision for a dispute.
	 *
	 * @param gameId - Game identifier
	 * @param disputeIdStr - Dispute ID as string
	 * @param verdict - SUCCESSFUL | FAILED
	 * @param explanation - Referee explanation
	 * @returns JSON resolution result
	 */
	resolve(
		gameId: string,
		disputeIdStr: string,
		verdict: string,
		explanation: string,
	): string {
		const disputeId = parseInt(disputeIdStr, 10);
		if (Number.isNaN(disputeId)) {
			return JSON.stringify({ error: "dispute_id must be a valid integer" });
		}

		const normalizedVerdict = verdict.toUpperCase();
		if (!["SUCCESSFUL", "FAILED"].includes(normalizedVerdict)) {
			return JSON.stringify({ error: "verdict must be SUCCESSFUL or FAILED" });
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

	/**
	 * Checks if any agent has reached the target score.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON winner check result
	 */
	checkWinner(gameId: string): string {
		return JSON.stringify(this.orchestrator.checkWinner(gameId), null, 2);
	}

	/**
	 * Submits a new finding from an agent during the hunt phase.
	 *
	 * @param gameId - Game identifier
	 * @param agentId - Submitting agent ID
	 * @param filePath - File containing the issue
	 * @param lineStartStr - Start line as string
	 * @param lineEndStr - End line as string
	 * @param description - Finding description
	 * @param codeSnippet - Optional code snippet
	 * @returns JSON with finding ID
	 */
	submit(
		gameId: string,
		agentId: string,
		filePath: string,
		lineStartStr: string,
		lineEndStr: string,
		description: string,
		codeSnippet?: string,
	): string {
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

	/**
	 * Submits a dispute from an agent challenging another agent's finding.
	 *
	 * @param gameId - Game identifier
	 * @param agentId - Disputing agent ID
	 * @param findingIdStr - Finding ID as string
	 * @param reason - Dispute reason
	 * @returns JSON with dispute ID
	 */
	dispute(
		gameId: string,
		agentId: string,
		findingIdStr: string,
		reason: string,
	): string {
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

	/**
	 * Marks an agent as finished with the current phase.
	 *
	 * @param gameId - Game identifier
	 * @param agentId - Agent ID
	 * @param phase - "hunt" or "review"
	 * @returns JSON confirmation
	 */
	done(gameId: string, agentId: string, phase: string): string {
		if (phase !== "hunt" && phase !== "review") {
			return JSON.stringify({ error: "phase must be 'hunt' or 'review'" });
		}
		this.orchestrator.markAgentDone(gameId, agentId, phase);
		return JSON.stringify({ success: true, agentId, phase });
	}

	/**
	 * Returns current game state including phase, round, timer, and scoreboard.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON game status
	 */
	status(gameId: string): string {
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

	/**
	 * Lists all findings for a game with summary info.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON findings list
	 */
	findings(gameId: string): string {
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

	/**
	 * Lists all disputes for a game with resolution status and points.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON disputes list
	 */
	disputes(gameId: string): string {
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

	/**
	 * Exports game results to logs directory (markdown + JSON reports).
	 *
	 * @param gameId - Game identifier
	 * @returns JSON export result
	 */
	export(gameId: string): string {
		return JSON.stringify(this.orchestrator.exportGame(gameId), null, 2);
	}

	/**
	 * Launches interactive terminal UI for real-time game monitoring.
	 *
	 * @param gameId - Game identifier
	 * @returns JSON exit status
	 */
	async ui(gameId: string): Promise<string> {
		const game = this.orchestrator.getGame(gameId);
		if (!game) {
			return JSON.stringify({ error: `Game not found: ${gameId}` });
		}

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
	 *
	 * @param projectPath - Path to the project to review
	 * @param opts - Parsed commander options
	 * @returns JSON summary when game completes
	 */
	async play(projectPath: string, opts: PlayOpts): Promise<string> {
		const { getModel, registerBuiltInApiProviders } = await import(
			"@mariozechner/pi-ai"
		);
		registerBuiltInApiProviders();

		const resolvedPath = resolve(projectPath);
		if (!existsSync(resolvedPath)) {
			return JSON.stringify({
				error: `Project path not found: ${resolvedPath}`,
			});
		}

		// Auth: explicit --auth oauth, or auto-detect if logged in and no ANTHROPIC_API_KEY
		let oauthApiKey: string | undefined;
		const hasEnvKey = !!process.env.ANTHROPIC_API_KEY;
		const useOAuth = opts.auth === "oauth" || (!hasEnvKey && isLoggedIn());

		if (useOAuth) {
			const key = await getOAuthKey();
			if (!key) {
				return JSON.stringify({
					error:
						"Not logged in. Run 'bones login' first, or set ANTHROPIC_API_KEY.",
				});
			}
			oauthApiKey = key;
			if (opts.output !== "json") {
				console.log("[auth]    Using Claude Pro/Max subscription (OAuth)");
			}
		} else if (!hasEnvKey) {
			return JSON.stringify({
				error:
					"No auth configured. Run 'bones login' or set ANTHROPIC_API_KEY.",
			});
		}

		// Resolve models
		const modelSpec = opts.model ?? "anthropic/claude-sonnet-4-0";
		const [agentProvider, agentModelId] = modelSpec.split("/") as [
			string,
			string,
		];
		const agentModel = getModel(agentProvider as any, agentModelId as any);

		const refereeModel = opts.refereeModel
			? (() => {
					const [p, m] = opts.refereeModel!.split("/") as [string, string];
					return getModel(p as any, m as any);
				})()
			: agentModel;

		// Build setup config from shared opts
		const config = this.buildSetupConfig(projectPath, opts);
		if ("error" in config) {
			return JSON.stringify(config);
		}

		// Build path filter from --include/--exclude
		const pathFilter =
			opts.include || opts.exclude
				? { include: opts.include, exclude: opts.exclude }
				: undefined;

		const playConfig: PlayConfig = {
			...config,
			agentModel,
			refereeModel,
			agentThinking: (opts.thinking ?? "medium") as any,
			refereeThinking: (opts.refereeThinking ?? "high") as any,
			apiKey: oauthApiKey,
			pathFilter,
		};

		if (opts.output === "json") {
			return this.playJson(resolvedPath, playConfig);
		}

		return this.playTui(resolvedPath, playConfig);
	}

	/**
	 * Runs the game with an interactive Ink TUI dashboard.
	 *
	 * @param projectPath - Resolved absolute path to the project
	 * @param playConfig - Full play configuration
	 * @returns JSON summary when game completes
	 */
	private async playTui(
		projectPath: string,
		playConfig: PlayConfig,
	): Promise<string> {
		const runner = new GameRunner(this.orchestrator, projectPath, {
			silent: true,
		});

		const { EventEmitter } = await import("node:events");
		const { render } = await import("ink");
		const React = await import("react");
		const { LiveGameUI } = await import("./ui/LiveGameUI.js");

		const emitter = new EventEmitter();
		const { unmount } = render(
			React.createElement(LiveGameUI, {
				emitter,
				orchestrator: this.orchestrator,
			}),
		);

		let result = "";

		for await (const event of runner.play(playConfig)) {
			emitter.emit("game-event", event);

			if (event.type === "game_complete") {
				result = JSON.stringify(
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

		// Let TUI render final state before unmounting
		await new Promise((resolve) => setTimeout(resolve, 2000));
		unmount();

		return result || JSON.stringify({ error: "Game ended without a winner" });
	}

	/**
	 * Runs the game with NDJSON output for programmatic consumption.
	 * Emits one JSON object per line for key events, enriched with DB data
	 * at phase boundaries (findings, scores, disputes).
	 *
	 * @param projectPath - Resolved absolute path to the project
	 * @param playConfig - Full play configuration
	 * @returns Final JSON summary when game completes
	 */
	private async playJson(
		projectPath: string,
		playConfig: PlayConfig,
	): Promise<string> {
		const runner = new GameRunner(this.orchestrator, projectPath, {
			silent: true,
		});

		/** Writes a single NDJSON line to stdout. */
		const emit = (obj: Record<string, unknown>) => {
			console.log(JSON.stringify(obj));
		};

		let gameId = "";
		let result = "";

		for await (const event of runner.play(playConfig)) {
			switch (event.type) {
				case "game_created":
					gameId = event.gameId;
					emit({
						event: "game_created",
						gameId: event.gameId,
						agents: event.agents,
					});
					break;

				case "round_start":
					emit({ event: "round_start", round: event.round });
					break;

				case "hunt_start":
					emit({
						event: "hunt_start",
						round: event.round,
						agents: event.agentCount,
					});
					break;

				case "hunt_agent_done":
					emit({
						event: "hunt_agent_done",
						agent: event.agentId,
						turns: event.result.turnCount,
						cost: `$${event.result.totalUsage.cost.total.toFixed(4)}`,
						aborted: event.result.aborted
							? (event.result.abortReason ?? "unknown")
							: undefined,
						error: event.result.error ?? undefined,
					});
					break;

				// After all findings scored — emit enriched summary from DB
				case "scoring_end": {
					const findings = this.orchestrator.getFindings(gameId);
					const scoreboard = this.orchestrator.getScoreboard(gameId);
					emit({
						event: "scoring_end",
						round: event.round,
						findings: findings.map((f) => ({
							id: f.id,
							agent: f.agentId,
							file: f.filePath,
							lines: `${f.lineStart}-${f.lineEnd}`,
							status: f.status,
							description: f.description,
						})),
						scoreboard: scoreboard.map((e) => ({
							agent: e.id,
							score: e.score,
							valid: e.findingsValid,
							false: e.findingsFalse,
							duplicate: e.findingsDuplicate,
						})),
					});
					break;
				}

				case "review_agent_done":
					emit({
						event: "review_agent_done",
						agent: event.agentId,
						turns: event.result.turnCount,
						cost: `$${event.result.totalUsage.cost.total.toFixed(4)}`,
					});
					break;

				// After all disputes resolved — emit enriched summary from DB
				case "dispute_scoring_end": {
					const disputes = this.orchestrator.getDisputes(gameId);
					const scoreboard = this.orchestrator.getScoreboard(gameId);
					emit({
						event: "dispute_scoring_end",
						round: event.round,
						disputes: disputes.map((d) => ({
							id: d.id,
							finding: d.findingId,
							disputer: d.disputerId,
							status: d.status,
							reason: d.reason,
						})),
						scoreboard: scoreboard.map((e) => ({
							agent: e.id,
							score: e.score,
							valid: e.findingsValid,
							false: e.findingsFalse,
							duplicate: e.findingsDuplicate,
							disputesWon: e.disputesWon,
							disputesLost: e.disputesLost,
						})),
					});
					break;
				}

				case "round_complete":
					emit({
						event: "round_complete",
						round: event.round,
						action: event.action,
						winner: event.winner ?? undefined,
						reason: event.reason,
					});
					break;

				case "game_complete": {
					const finalScoreboard = this.orchestrator.getScoreboard(gameId);
					const allFindings = this.orchestrator.getFindings(gameId);
					result = JSON.stringify({
						event: "game_complete",
						winner: event.winner,
						reason: event.reason,
						cost: `$${event.totalCost.cost.total.toFixed(4)}`,
						tokens: event.totalCost.totalTokens,
						scoreboard: finalScoreboard.map((e) => ({
							agent: e.id,
							score: e.score,
							valid: e.findingsValid,
							false: e.findingsFalse,
							duplicate: e.findingsDuplicate,
							disputesWon: e.disputesWon,
							disputesLost: e.disputesLost,
						})),
						findings: allFindings.map((f) => ({
							id: f.id,
							agent: f.agentId,
							file: f.filePath,
							lines: `${f.lineStart}-${f.lineEnd}`,
							status: f.status,
							description: f.description,
						})),
					});
					console.log(result);
					break;
				}

				// Skip noisy per-finding/per-dispute events — summaries above cover them
				default:
					break;
			}
		}

		// Return empty string — all output already emitted via console.log
		return "";
	}

	/**
	 * Initializes the project by installing dependencies for all components.
	 *
	 * @returns JSON init result
	 */
	init(): string {
		const projectRoot = join(__dirname, "..", "..");
		const dashboardDir = join(projectRoot, "apps", "dashboard");
		const results: { step: string; success: boolean; message?: string }[] = [];

		const bunCheck = spawnSync("bun", ["--version"], { encoding: "utf-8" });
		if (bunCheck.status !== 0) {
			return JSON.stringify({
				error: "bun is required but not found. Install from https://bun.sh",
			});
		}

		const rootNodeModules = join(projectRoot, "node_modules");
		if (!existsSync(rootNodeModules)) {
			console.log("Installing root dependencies...");
			try {
				execSync("bun install", { cwd: projectRoot, stdio: "inherit" });
				results.push({ step: "root dependencies", success: true });
			} catch {
				results.push({
					step: "root dependencies",
					success: false,
					message: "bun install failed",
				});
			}
		} else {
			results.push({
				step: "root dependencies",
				success: true,
				message: "already installed",
			});
		}

		const dashboardNodeModules = join(dashboardDir, "node_modules");
		if (!existsSync(dashboardNodeModules)) {
			console.log("Installing dashboard dependencies...");
			try {
				execSync("bun install", { cwd: dashboardDir, stdio: "inherit" });
				results.push({ step: "dashboard dependencies", success: true });
			} catch {
				results.push({
					step: "dashboard dependencies",
					success: false,
					message: "bun install failed in apps/dashboard",
				});
			}
		} else {
			results.push({
				step: "dashboard dependencies",
				success: true,
				message: "already installed",
			});
		}

		console.log("Building TypeScript...");
		try {
			execSync("bun run build", { cwd: projectRoot, stdio: "inherit" });
			results.push({ step: "typescript build", success: true });
		} catch {
			results.push({
				step: "typescript build",
				success: false,
				message: "build failed",
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

	/**
	 * Builds a SetupConfig from commander-parsed options.
	 * Shared between setup() and play().
	 *
	 * @param projectUrl - Project URL or path
	 * @param opts - Parsed commander options
	 * @returns SetupConfig or error object
	 */
	private buildSetupConfig(
		projectUrl: string,
		opts: SetupOpts,
	): SetupConfig | { error: string } {
		const config: SetupConfig = { projectUrl };

		if (opts.prompt) {
			// Legacy --prompt maps to custom category
			config.category = HuntCategory.Custom;
			config.userPrompt = opts.prompt;
		} else {
			if (opts.category) {
				if (!VALID_CATEGORIES.includes(opts.category as HuntCategory)) {
					return {
						error: `Invalid category: ${opts.category}. Valid: ${VALID_CATEGORIES.join(", ")}`,
					};
				}
				config.category = opts.category as HuntCategory;
			}
			if (opts.focus) {
				config.userPrompt = opts.focus;
			}
		}

		if (opts.target) config.targetScore = parseInt(opts.target, 10);
		if (opts.agents) config.numAgents = parseInt(opts.agents, 10);
		if (opts.maxRounds) config.maxRounds = parseInt(opts.maxRounds, 10);
		if (opts.huntDuration)
			config.huntDuration = parseInt(opts.huntDuration, 10);
		if (opts.reviewDuration)
			config.reviewDuration = parseInt(opts.reviewDuration, 10);

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
}
