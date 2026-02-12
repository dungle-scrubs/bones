import type { Game } from "../domain/Game.js";
import {
	type Confidence,
	type ConflictDetectionResult,
	type DisputeScoringResult,
	detectPromptConflicts,
	type GameConfig,
	HuntCategory,
	type HuntCheckResult,
	type HuntPhaseResult,
	type ImpactTier,
	type IssueType,
	Phase,
	type RejectionReason,
	type ReviewCheckResult,
	type ReviewPhaseResult,
	type ScoringPhaseResult,
	type SetupResult,
	VerificationStatus,
	type WinnerCheckResult,
} from "../domain/types.js";
import { AgentRepository } from "../repository/AgentRepository.js";
import { Database } from "../repository/Database.js";
import { DisputeRepository } from "../repository/DisputeRepository.js";
import { FindingRepository } from "../repository/FindingRepository.js";
import { GameRepository } from "../repository/GameRepository.js";
import { Exporter } from "./Exporter.js";
import { PromptRenderer } from "./PromptRenderer.js";
import { Scorer } from "./Scorer.js";

/** Input configuration for creating a new game session. */
export interface SetupConfig {
	projectUrl: string;
	category?: HuntCategory;
	userPrompt?: string | null;
	targetScore?: number;
	huntDuration?: number;
	reviewDuration?: number;
	numAgents?: number;
	/** Maximum rounds before tiebreaker. 0 = no limit, default 3. */
	maxRounds?: number;
}

/** Response when user prompt conflicts with category exclusions. */
export interface ClarificationNeeded {
	action: "CLARIFICATION_NEEDED";
	conflicts: ConflictDetectionResult["conflicts"];
}

/** Result of exporting game findings to files. */
export interface ExportResult {
	gameId: string;
	outputDir: string;
	files: string[];
}

/**
 * Central coordinator for Bones game logic.
 * Manages game lifecycle, phase transitions, and coordinates between
 * repositories, scorer, and prompt renderer. This is the main API
 * that the CLI commands interact with.
 */
export class Orchestrator {
	private db: Database;
	private gameRepo: GameRepository;
	private agentRepo: AgentRepository;
	private findingRepo: FindingRepository;
	private disputeRepo: DisputeRepository;
	private scorer: Scorer;
	private promptRenderer: PromptRenderer;
	private exporter: Exporter;
	private scriptsPath: string;

	constructor(dbPath: string, scriptsPath: string) {
		this.db = new Database(dbPath);
		this.gameRepo = new GameRepository(this.db);
		this.agentRepo = new AgentRepository(this.db);
		this.findingRepo = new FindingRepository(this.db);
		this.disputeRepo = new DisputeRepository(this.db);
		this.scorer = new Scorer(
			this.db,
			this.agentRepo,
			this.findingRepo,
			this.disputeRepo,
		);
		this.promptRenderer = new PromptRenderer();
		this.exporter = new Exporter();
		this.scriptsPath = scriptsPath;
	}

	/**
	 * Checks if user's focus prompt conflicts with category exclusions.
	 * Should be called before setup() to warn users of potential issues.
	 */
	checkConflicts(config: SetupConfig): ClarificationNeeded | null {
		const category = config.category ?? HuntCategory.Bugs;
		const result = detectPromptConflicts(category, config.userPrompt ?? null);

		if (result.hasConflicts) {
			return {
				action: "CLARIFICATION_NEEDED",
				conflicts: result.conflicts,
			};
		}
		return null;
	}

	/**
	 * Creates a new game with agents and returns setup information.
	 * Applies default values for any unspecified config options.
	 */
	setup(config: SetupConfig): SetupResult {
		const category = config.category ?? HuntCategory.Bugs;
		const userPrompt = config.userPrompt ?? null;

		const gameConfig: GameConfig = {
			projectUrl: config.projectUrl,
			category,
			userPrompt,
			targetScore: config.targetScore ?? 10,
			huntDuration: config.huntDuration ?? 300,
			reviewDuration: config.reviewDuration ?? 180,
			numAgents: config.numAgents ?? 3,
			maxRounds: config.maxRounds ?? 3, // 0 = no limit
		};

		// Wrap in transaction so game isn't orphaned if agent creation fails
		const { game, agents } = this.db.transaction(() => {
			const game = this.gameRepo.create(gameConfig);
			const agents = this.agentRepo.createMany(game.id, gameConfig.numAgents);
			return { game, agents };
		});

		return {
			action: "GAME_CREATED",
			gameId: game.id,
			agents: agents.map((a) => a.id),
			config: {
				category: gameConfig.category,
				userPrompt: gameConfig.userPrompt,
				targetScore: gameConfig.targetScore,
				huntDuration: gameConfig.huntDuration,
				reviewDuration: gameConfig.reviewDuration,
				numAgents: gameConfig.numAgents,
				maxRounds: gameConfig.maxRounds,
			},
			next: `Start hunt with: start-hunt ${game.id}`,
		};
	}

	/**
	 * Begins the hunt phase, generating prompts for each agent.
	 * Returns agent prompts that should be executed by spawned Claude instances.
	 * @throws Error if game is not in Setup or ReviewScoring phase
	 */
	startHunt(gameId: string): HuntPhaseResult {
		const game = this.requireGame(gameId);

		if (game.phase !== Phase.Setup && game.phase !== Phase.ReviewScoring) {
			throw new Error(`Cannot start hunt from phase: ${game.phase}`);
		}

		game.startHuntPhase();
		this.gameRepo.update(game);

		const agents = this.agentRepo.findActiveByGameId(gameId);
		const scoreboard = this.agentRepo.getScoreboard(gameId);
		const existingFindings = this.findingRepo.findValidByGameId(gameId);

		const agentPrompts = agents.map((agent) => ({
			agentId: agent.id,
			prompt: this.promptRenderer.renderHunt({
				gameId,
				agentId: agent.id,
				round: game.round,
				phaseEndsAt: game.phaseEndsAt!.toISOString(),
				targetScore: game.config.targetScore,
				projectUrl: game.config.projectUrl,
				huntPrompt: game.huntPrompt,
				category: game.category,
				scoreboard,
				yourScore: agent.score,
				scriptsPath: this.scriptsPath,
				existingFindings,
			}),
		}));

		return {
			action: "SPAWN_HUNT_AGENTS",
			round: game.round,
			phase: Phase.Hunt,
			endsAt: game.phaseEndsAt!.toISOString(),
			durationSeconds: game.config.huntDuration,
			agents: agentPrompts,
			instructions: [
				"Spawn one Claude agent per entry above",
				"Each agent should execute their prompt",
				"Agents can submit findings and mark done",
				`Check status with: check-hunt ${gameId}`,
			],
		};
	}

	/**
	 * Checks hunt phase status - whether time expired or all agents done.
	 * Used to determine if scoring can begin.
	 */
	checkHunt(gameId: string): HuntCheckResult {
		const game = this.requireGame(gameId);

		if (game.phase !== Phase.Hunt) {
			throw new Error(`Not in hunt phase: ${game.phase}`);
		}

		const pendingAgents = this.agentRepo.getPendingHuntAgents(
			gameId,
			game.round,
		);
		const allDone = pendingAgents.length === 0;
		const timeExpired = game.isPhaseExpired;

		return {
			round: game.round,
			timeExpired,
			remainingSeconds: game.timeRemaining,
			allAgentsFinished: allDone,
			readyForScoring: timeExpired || allDone,
			pending: pendingAgents.map((a) => a.id),
			next:
				timeExpired || allDone
					? `Start scoring with: start-hunt-scoring ${gameId}`
					: `Wait for agents or timeout. Check again with: check-hunt ${gameId}`,
		};
	}

	/**
	 * Transitions to hunt scoring phase and returns validation prompts.
	 * Each prompt guides the referee through validating one finding.
	 */
	startHuntScoring(gameId: string): ScoringPhaseResult {
		const game = this.requireGame(gameId);

		if (game.phase !== Phase.Hunt) {
			throw new Error(`Cannot start hunt scoring from phase: ${game.phase}`);
		}

		game.transitionTo(Phase.HuntScoring);
		this.gameRepo.update(game);

		const pendingFindings = this.findingRepo.findPendingByRound(
			gameId,
			game.round,
		);

		const validations = pendingFindings.map((finding) => ({
			findingId: finding.id,
			type: "finding_validation" as const,
			prompt: this.promptRenderer.renderFindingValidation({
				gameId,
				findingId: finding.id,
				agentId: finding.agentId,
				description: finding.description,
				filePath: finding.filePath,
				lineStart: finding.lineStart,
				lineEnd: finding.lineEnd,
				codeSnippet: finding.codeSnippet,
				projectUrl: game.config.projectUrl,
				scriptsPath: this.scriptsPath,
				category: game.category,
			}),
		}));

		return {
			action: "VALIDATE_FINDINGS",
			round: game.round,
			phase: Phase.HuntScoring,
			pendingFindings: pendingFindings.length,
			findingValidations: validations,
			instructions: [
				"Process each finding validation",
				"Submit verdicts via validate command",
				`When all validated: start-review ${gameId}`,
			],
		};
	}

	/**
	 * Records the referee's validation decision for a finding.
	 * Automatically checks for duplicates when marking as VALID.
	 * Updates agent scores and statistics accordingly.
	 * If needsVerification is true, finding is flagged for second-pass review.
	 */
	validateFinding(
		gameId: string,
		findingId: number,
		verdict: "VALID" | "FALSE" | "DUPLICATE",
		explanation: string,
		confidence?: Confidence,
		duplicateOfId?: number,
		confidenceScore?: number,
		issueType?: IssueType,
		impactTier?: ImpactTier,
		rejectionReason?: RejectionReason,
		needsVerification?: boolean,
	): {
		verdict: "VALID" | "FALSE" | "DUPLICATE";
		duplicateOfId?: number;
		needsVerification?: boolean;
	} {
		const finding = this.findingRepo.findById(findingId);
		if (!finding || finding.gameId !== gameId) {
			throw new Error(`Finding not found: ${findingId}`);
		}

		// Duplicate check is now done inside applyFindingValidation (inside transaction)
		// to prevent TOCTOU race conditions
		const result = this.scorer.applyFindingValidation(
			finding,
			verdict,
			explanation,
			confidence,
			duplicateOfId,
			confidenceScore,
			issueType,
			impactTier,
			rejectionReason,
			needsVerification,
			gameId,
		);

		return {
			verdict: result.verdict,
			duplicateOfId: result.duplicateOfId,
			needsVerification: result.verdict === "VALID" ? needsVerification : false,
		};
	}

	/**
	 * Lists findings that need verification before scoring can complete.
	 * Returns prompts for spawning verification agents.
	 */
	getPendingVerifications(gameId: string): {
		findings: Array<{
			findingId: number;
			prompt: string;
		}>;
	} {
		const game = this.requireGame(gameId);
		const pendingFindings = this.findingRepo.findPendingVerificationByRound(
			gameId,
			game.round,
		);

		const findings = pendingFindings.map((finding) => ({
			findingId: finding.id,
			prompt: this.promptRenderer.renderVerificationPrompt({
				gameId,
				findingId: finding.id,
				agentId: finding.agentId,
				description: finding.description,
				filePath: finding.filePath,
				lineStart: finding.lineStart,
				lineEnd: finding.lineEnd,
				codeSnippet: finding.codeSnippet,
				projectUrl: game.config.projectUrl,
				scriptsPath: this.scriptsPath,
				category: game.category,
				originalVerdict: finding.refereeVerdict ?? "",
				confidenceScore: finding.confidenceScore ?? 0,
				issueType: finding.issueType,
			}),
		}));

		return { findings };
	}

	/**
	 * Records the verification agent's decision on a finding.
	 * If confirmed, awards points. If overridden, marks as false positive.
	 */
	verifyFinding(
		gameId: string,
		findingId: number,
		confirmed: boolean,
		explanation: string,
		overriddenIssueType?: IssueType,
		rejectionReason?: RejectionReason,
	): { confirmed: boolean; points: number } {
		const finding = this.findingRepo.findById(findingId);
		if (!finding || finding.gameId !== gameId) {
			throw new Error(`Finding not found: ${findingId}`);
		}

		if (finding.verificationStatus !== VerificationStatus.Pending) {
			throw new Error(
				`Finding ${findingId} is not pending verification: ${finding.verificationStatus}`,
			);
		}

		const agent = this.agentRepo.findById(finding.agentId);
		if (!agent) {
			throw new Error(`Agent not found: ${finding.agentId}`);
		}

		const points = this.db.transaction(() => {
			const pts = finding.applyVerification(
				confirmed,
				explanation,
				overriddenIssueType,
				rejectionReason,
			);
			agent.awardPoints(pts);

			if (confirmed) {
				agent.recordValidFinding();
			} else {
				agent.recordFalseFinding();
			}

			this.findingRepo.update(finding);
			this.agentRepo.update(agent);
			return pts;
		});

		return { confirmed, points };
	}

	/**
	 * Begins the review phase where agents can dispute findings.
	 * Returns prompts with valid findings that each agent can challenge.
	 */
	startReview(gameId: string): ReviewPhaseResult {
		const game = this.requireGame(gameId);

		if (game.phase !== Phase.HuntScoring) {
			throw new Error(`Cannot start review from phase: ${game.phase}`);
		}

		game.startReviewPhase();
		this.gameRepo.update(game);

		const agents = this.agentRepo.findActiveByGameId(gameId);
		const scoreboard = this.agentRepo.getScoreboard(gameId);
		const validFindings = this.findingRepo.findValidByGameId(gameId);

		const agentPrompts = agents.map((agent) => {
			const reviewableFindings = validFindings.filter(
				(f) => f.agentId !== agent.id,
			);
			return {
				agentId: agent.id,
				prompt: this.promptRenderer.renderReview({
					gameId,
					agentId: agent.id,
					round: game.round,
					phaseEndsAt: game.phaseEndsAt!.toISOString(),
					targetScore: game.config.targetScore,
					projectUrl: game.config.projectUrl,
					findings: reviewableFindings,
					scoreboard,
					yourScore: agent.score,
					scriptsPath: this.scriptsPath,
				}),
			};
		});

		return {
			action: "SPAWN_REVIEW_AGENTS",
			round: game.round,
			phase: Phase.Review,
			endsAt: game.phaseEndsAt!.toISOString(),
			durationSeconds: game.config.reviewDuration,
			findingsToReview: validFindings.length,
			agents: agentPrompts,
			instructions: [
				"Spawn one Claude agent per entry above",
				"Agents can dispute findings they believe are incorrect",
				`Check status with: check-review ${gameId}`,
			],
		};
	}

	/**
	 * Checks review phase status - whether time expired or all agents done.
	 * Used to determine if dispute scoring can begin.
	 */
	checkReview(gameId: string): ReviewCheckResult {
		const game = this.requireGame(gameId);

		if (game.phase !== Phase.Review) {
			throw new Error(`Not in review phase: ${game.phase}`);
		}

		const pendingAgents = this.agentRepo.getPendingReviewAgents(
			gameId,
			game.round,
		);
		const allDone = pendingAgents.length === 0;
		const timeExpired = game.isPhaseExpired;

		return {
			round: game.round,
			timeExpired,
			remainingSeconds: game.timeRemaining,
			allAgentsFinished: allDone,
			readyForScoring: timeExpired || allDone,
			pending: pendingAgents.map((a) => a.id),
			next:
				timeExpired || allDone
					? `Start scoring with: start-review-scoring ${gameId}`
					: `Wait for agents or timeout. Check again with: check-review ${gameId}`,
		};
	}

	/**
	 * Transitions to review scoring phase and returns dispute resolution prompts.
	 * Each prompt guides the referee through resolving one dispute.
	 */
	startReviewScoring(gameId: string): DisputeScoringResult {
		const game = this.requireGame(gameId);

		if (game.phase !== Phase.Review) {
			throw new Error(`Cannot start review scoring from phase: ${game.phase}`);
		}

		game.transitionTo(Phase.ReviewScoring);
		this.gameRepo.update(game);

		const pendingDisputes = this.disputeRepo.findPendingByRound(
			gameId,
			game.round,
		);

		const resolutions = pendingDisputes.map((dispute) => {
			const finding = this.findingRepo.findById(dispute.findingId);
			if (!finding) {
				throw new Error(
					`Finding ${dispute.findingId} not found for dispute ${dispute.id}`,
				);
			}
			return {
				disputeId: dispute.id,
				findingId: dispute.findingId,
				type: "dispute_resolution" as const,
				prompt: this.promptRenderer.renderDisputeResolution({
					gameId,
					disputeId: dispute.id,
					findingId: dispute.findingId,
					disputerId: dispute.disputerId,
					finderId: finding.agentId,
					findingDescription: finding.description,
					disputeReason: dispute.reason,
					filePath: finding.filePath,
					lineStart: finding.lineStart,
					lineEnd: finding.lineEnd,
					codeSnippet: finding.codeSnippet,
					projectUrl: game.config.projectUrl,
					scriptsPath: this.scriptsPath,
				}),
			};
		});

		return {
			action: "RESOLVE_DISPUTES",
			round: game.round,
			phase: Phase.ReviewScoring,
			pendingDisputes: pendingDisputes.length,
			disputeResolutions: resolutions,
			instructions: [
				"Process each dispute resolution",
				"Submit verdicts via resolve command",
				`When all resolved: check-winner ${gameId}`,
			],
		};
	}

	/**
	 * Records the referee's resolution for a dispute.
	 * If successful, revokes the original finding and adjusts both agents' scores.
	 */
	resolveDispute(
		gameId: string,
		disputeId: number,
		verdict: "SUCCESSFUL" | "FAILED",
		explanation: string,
	): void {
		const dispute = this.disputeRepo.findById(disputeId);
		if (!dispute || dispute.gameId !== gameId) {
			throw new Error(`Dispute not found: ${disputeId}`);
		}

		const finding = this.findingRepo.findById(dispute.findingId);
		if (!finding) {
			throw new Error(`Finding not found for dispute: ${dispute.findingId}`);
		}

		this.scorer.applyDisputeResolution(dispute, finding, verdict, explanation);
	}

	/**
	 * Determines if the game should end or continue to another round.
	 * Handles target score reached, ties, and max rounds scenarios.
	 */
	checkWinner(gameId: string): WinnerCheckResult {
		const game = this.requireGame(gameId);

		if (game.phase !== Phase.ReviewScoring) {
			throw new Error(`Cannot check winner from phase: ${game.phase}`);
		}

		const scoreboard = this.agentRepo.getScoreboard(gameId);
		const targetScore = game.config.targetScore;

		// Check if anyone reached target score
		const winners = scoreboard.filter((e) => e.score >= targetScore);

		if (winners.length === 1) {
			game.complete(winners[0].id);
			this.gameRepo.update(game);

			const agent = this.agentRepo.findById(winners[0].id);
			if (agent) {
				agent.declareWinner();
				this.agentRepo.update(agent);
			}

			return {
				action: "GAME_COMPLETE",
				winner: winners[0].id,
				reason: `${winners[0].id} reached target score of ${targetScore}`,
				finalScores: scoreboard,
			};
		}

		if (winners.length > 1) {
			// Tie-breaker needed
			return {
				action: "TIE_BREAKER",
				tiedAgents: winners.map((w) => w.id),
				reason: `Multiple agents reached ${targetScore}: ${winners.map((w) => w.id).join(", ")}`,
				scores: scoreboard,
				next: `Continue with another round: start-hunt ${gameId}`,
			};
		}

		// Check if max rounds reached - declare highest scorer as winner (0 = no limit)
		const maxRounds = game.config.maxRounds;
		if (maxRounds > 0 && game.round >= maxRounds) {
			const leader = scoreboard[0];
			if (leader) {
				// Check for ties at the top score
				const tiedForFirst = scoreboard.filter((e) => e.score === leader.score);
				if (tiedForFirst.length > 1) {
					// Tie at max rounds - pick winner randomly to break deadlock
					const randomIndex = Math.floor(Math.random() * tiedForFirst.length);
					const tieBreakWinner = tiedForFirst[randomIndex];

					game.complete(tieBreakWinner.id);
					this.gameRepo.update(game);

					const agent = this.agentRepo.findById(tieBreakWinner.id);
					if (agent) {
						agent.declareWinner();
						this.agentRepo.update(agent);
					}

					return {
						action: "GAME_COMPLETE",
						winner: tieBreakWinner.id,
						reason: `Max rounds (${maxRounds}) reached with tie at ${leader.score} points. ${tieBreakWinner.id} wins by random tiebreaker among: ${tiedForFirst.map((w) => w.id).join(", ")}`,
						finalScores: scoreboard,
					};
				}

				game.complete(leader.id);
				this.gameRepo.update(game);

				const agent = this.agentRepo.findById(leader.id);
				if (agent) {
					agent.declareWinner();
					this.agentRepo.update(agent);
				}

				return {
					action: "GAME_COMPLETE",
					winner: leader.id,
					reason: `Max rounds (${maxRounds}) reached. ${leader.id} wins with highest score: ${leader.score}`,
					finalScores: scoreboard,
				};
			}
		}

		// No winner yet, continue
		return {
			action: "CONTINUE",
			reason: `No agent has reached ${targetScore} yet. Highest: ${scoreboard[0]?.score ?? 0}`,
			scores: scoreboard,
			next: `Continue with another round: start-hunt ${gameId}`,
		};
	}

	/**
	 * Records a finding submitted by an agent during hunt phase.
	 * Returns the new finding's ID. Doc drift category requires evidence snippet.
	 * @throws Error if not in hunt phase or agent not found
	 */
	submitFinding(
		gameId: string,
		agentId: string,
		filePath: string,
		lineStart: number,
		lineEnd: number,
		description: string,
		codeSnippet?: string,
	): number {
		const game = this.requireGame(gameId);

		if (game.phase !== Phase.Hunt) {
			throw new Error(
				`Cannot submit finding outside hunt phase: ${game.phase}`,
			);
		}

		const agent = this.agentRepo.findById(agentId);
		if (!agent || agent.gameId !== gameId) {
			throw new Error(`Agent not found: ${agentId}`);
		}

		if (agent.hasFinishedHunt(game.round)) {
			throw new Error("Agent has already finished hunt phase for this round");
		}

		// doc_drift requires evidence snippet showing doc content vs code content
		if (game.category === HuntCategory.DocumentationDrift && !codeSnippet) {
			throw new Error(
				"doc_drift submissions require codeSnippet containing: " +
					"1) The exact documentation text, 2) The exact code behavior, " +
					"3) The contradiction. Use format:\n" +
					"DOC: <exact quote from documentation>\n" +
					"CODE: <actual code behavior>\n" +
					"CONTRADICTION: <why these conflict>",
			);
		}

		const finding = this.findingRepo.create({
			gameId,
			roundNumber: game.round,
			agentId,
			description,
			filePath,
			lineStart,
			lineEnd,
			codeSnippet,
		});

		return finding.id;
	}

	/**
	 * Records a dispute filed by an agent against another's finding.
	 * Returns the new dispute's ID. Validates that finding is disputeable.
	 * @throws Error if not in review phase, agent owns finding, or already disputed
	 */
	submitDispute(
		gameId: string,
		agentId: string,
		findingId: number,
		reason: string,
	): number {
		const game = this.requireGame(gameId);

		if (game.phase !== Phase.Review) {
			throw new Error(
				`Cannot submit dispute outside review phase: ${game.phase}`,
			);
		}

		const agent = this.agentRepo.findById(agentId);
		if (!agent || agent.gameId !== gameId) {
			throw new Error(`Agent not found: ${agentId}`);
		}

		if (agent.hasFinishedReview(game.round)) {
			throw new Error("Agent has already finished review phase for this round");
		}

		const finding = this.findingRepo.findById(findingId);
		if (!finding || finding.gameId !== gameId) {
			throw new Error(`Finding not found: ${findingId}`);
		}

		if (!finding.isValid) {
			throw new Error(
				`Can only dispute valid findings, status is: ${finding.status}`,
			);
		}

		if (finding.agentId === agentId) {
			throw new Error("Cannot dispute your own finding");
		}

		if (this.disputeRepo.hasAgentDisputed(findingId, agentId)) {
			throw new Error("Already disputed this finding");
		}

		const dispute = this.disputeRepo.create({
			gameId,
			roundNumber: game.round,
			findingId,
			disputerId: agentId,
			reason,
		});

		return dispute.id;
	}

	/**
	 * Marks an agent as done with the current phase.
	 * Prevents further submissions from this agent until next round.
	 */
	markAgentDone(
		gameId: string,
		agentId: string,
		phase: "hunt" | "review",
	): void {
		const game = this.requireGame(gameId);
		const agent = this.agentRepo.findById(agentId);

		if (!agent || agent.gameId !== gameId) {
			throw new Error(`Agent not found: ${agentId}`);
		}

		if (phase === "hunt") {
			if (game.phase !== Phase.Hunt) {
				throw new Error(`Not in hunt phase: ${game.phase}`);
			}
			agent.finishHunt(game.round);
		} else {
			if (game.phase !== Phase.Review) {
				throw new Error(`Not in review phase: ${game.phase}`);
			}
			agent.finishReview(game.round);
		}

		this.agentRepo.update(agent);
	}

	/** Returns a game by ID or null if not found. */
	getGame(gameId: string): Game | null {
		return this.gameRepo.findById(gameId);
	}

	/** Lists all games, most recent first. */
	getAllGames(): Game[] {
		return this.gameRepo.findAll();
	}

	/** Returns the current scoreboard for a game. */
	getScoreboard(gameId: string) {
		return this.agentRepo.getScoreboard(gameId);
	}

	/** Lists all findings for a game. */
	getFindings(gameId: string) {
		return this.findingRepo.findByGameId(gameId);
	}

	/** Lists all disputes for a game. */
	getDisputes(gameId: string) {
		return this.disputeRepo.findByGameId(gameId);
	}

	/**
	 * Exports game results to the logs directory.
	 * Creates findings.md, game.json, and full-report.json files.
	 */
	exportGame(gameId: string): ExportResult {
		const game = this.requireGame(gameId);
		const findings = this.findingRepo.findByGameId(gameId);
		const scoreboard = this.agentRepo.getScoreboard(gameId);

		// Calculate total duration
		const startTime = game.createdAt.getTime();
		const endTime = game.completedAt?.getTime() ?? Date.now();
		const totalDuration = Math.floor((endTime - startTime) / 1000);

		const outputDir = this.exporter.export({
			game,
			findings,
			scoreboard,
			totalDuration,
		});

		return {
			gameId: game.id,
			outputDir,
			files: ["findings.md", "game.json", "full-report.json"],
		};
	}

	/**
	 * Fetches a game by ID or throws if not found.
	 * Helper for methods that require a valid game.
	 */
	private requireGame(gameId: string): Game {
		const game = this.gameRepo.findById(gameId);
		if (!game) {
			throw new Error(`Game not found: ${gameId}`);
		}
		return game;
	}

	/** Closes the database connection. Call when shutting down. */
	close(): void {
		this.db.close();
	}
}
