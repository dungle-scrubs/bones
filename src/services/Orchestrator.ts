/**
 * Central facade for Bones game operations.
 * Delegates to PhaseCoordinator (phase lifecycle), SubmissionService (findings/disputes),
 * and Scorer (point calculations). This is the public API that CLI, server, and tools use.
 */

import type { Game } from "../domain/Game.js";
import type {
	Confidence,
	ImpactTier,
	IssueType,
	RejectionReason,
} from "../domain/types.js";
import {
	type ConflictDetectionResult,
	type DisputeScoringResult,
	detectPromptConflicts,
	type GameConfig,
	HuntCategory,
	type HuntCheckResult,
	type HuntPhaseResult,
	Phase,
	type ReviewCheckResult,
	type ReviewPhaseResult,
	type ScoringPhaseResult,
	type SetupResult,
	type WinnerCheckResult,
} from "../domain/types.js";
import { AgentRepository } from "../repository/AgentRepository.js";
import { Database } from "../repository/Database.js";
import { DisputeRepository } from "../repository/DisputeRepository.js";
import { FindingRepository } from "../repository/FindingRepository.js";
import { GameRepository } from "../repository/GameRepository.js";
import { Exporter } from "./Exporter.js";
import { PhaseCoordinator } from "./PhaseCoordinator.js";
import { SubmissionService } from "./SubmissionService.js";

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
 * Public API for Bones game operations.
 * Thin facade — business logic lives in PhaseCoordinator, SubmissionService, and Scorer.
 */
export class Orchestrator {
	private db: Database;
	private gameRepo: GameRepository;
	private agentRepo: AgentRepository;
	private findingRepo: FindingRepository;
	private disputeRepo: DisputeRepository;
	private phaseCoordinator: PhaseCoordinator;
	private submissionService: SubmissionService;
	private exporter: Exporter;

	constructor(dbPath: string, scriptsPath: string) {
		this.db = new Database(dbPath);
		this.gameRepo = new GameRepository(this.db);
		this.agentRepo = new AgentRepository(this.db);
		this.findingRepo = new FindingRepository(this.db);
		this.disputeRepo = new DisputeRepository(this.db);

		this.phaseCoordinator = new PhaseCoordinator(
			this.gameRepo,
			this.agentRepo,
			this.findingRepo,
			this.disputeRepo,
			scriptsPath,
		);

		this.submissionService = new SubmissionService(
			this.db,
			this.gameRepo,
			this.agentRepo,
			this.findingRepo,
			this.disputeRepo,
		);

		this.exporter = new Exporter();
	}

	// =========================================================================
	// Game Setup
	// =========================================================================

	/**
	 * Checks if user's focus prompt conflicts with category exclusions.
	 * Should be called before setup() to warn users of potential issues.
	 */
	checkConflicts(config: SetupConfig): ClarificationNeeded | null {
		const category = config.category ?? HuntCategory.Bugs;
		const result = detectPromptConflicts(category, config.userPrompt ?? null);
		if (result.hasConflicts) {
			return { action: "CLARIFICATION_NEEDED", conflicts: result.conflicts };
		}
		return null;
	}

	/**
	 * Creates a new game with agents and returns setup information.
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
			maxRounds: config.maxRounds ?? 3,
		};

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

	// =========================================================================
	// Phase Lifecycle (delegates to PhaseCoordinator)
	// =========================================================================

	/** @see PhaseCoordinator.startHunt */
	startHunt(gameId: string): HuntPhaseResult {
		return this.phaseCoordinator.startHunt(this.requireGame(gameId));
	}

	/** @see PhaseCoordinator.checkHunt */
	checkHunt(gameId: string): HuntCheckResult {
		return this.phaseCoordinator.checkHunt(this.requireGame(gameId));
	}

	/** @see PhaseCoordinator.startHuntScoring */
	startHuntScoring(gameId: string): ScoringPhaseResult {
		return this.phaseCoordinator.startHuntScoring(this.requireGame(gameId));
	}

	/** @see PhaseCoordinator.startReview */
	startReview(gameId: string): ReviewPhaseResult {
		return this.phaseCoordinator.startReview(this.requireGame(gameId));
	}

	/** @see PhaseCoordinator.checkReview */
	checkReview(gameId: string): ReviewCheckResult {
		return this.phaseCoordinator.checkReview(this.requireGame(gameId));
	}

	/** @see PhaseCoordinator.startReviewScoring */
	startReviewScoring(gameId: string): DisputeScoringResult {
		return this.phaseCoordinator.startReviewScoring(this.requireGame(gameId));
	}

	/** @see PhaseCoordinator.checkWinner */
	checkWinner(gameId: string): WinnerCheckResult {
		return this.phaseCoordinator.checkWinner(this.requireGame(gameId));
	}

	/** @see PhaseCoordinator.getPendingVerifications */
	getPendingVerifications(gameId: string) {
		return this.phaseCoordinator.getPendingVerifications(
			this.requireGame(gameId),
		);
	}

	// =========================================================================
	// Submissions & Validation (delegates to SubmissionService)
	// =========================================================================

	/** @see SubmissionService.submitFinding */
	submitFinding(
		gameId: string,
		agentId: string,
		filePath: string,
		lineStart: number,
		lineEnd: number,
		description: string,
		codeSnippet?: string,
	): number {
		return this.submissionService.submitFinding(
			gameId,
			agentId,
			filePath,
			lineStart,
			lineEnd,
			description,
			codeSnippet,
		);
	}

	/** @see SubmissionService.validateFinding */
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
	) {
		return this.submissionService.validateFinding(
			gameId,
			findingId,
			verdict,
			explanation,
			confidence,
			duplicateOfId,
			confidenceScore,
			issueType,
			impactTier,
			rejectionReason,
			needsVerification,
		);
	}

	/** @see SubmissionService.verifyFinding */
	verifyFinding(
		gameId: string,
		findingId: number,
		confirmed: boolean,
		explanation: string,
		overriddenIssueType?: IssueType,
		rejectionReason?: RejectionReason,
	) {
		return this.submissionService.verifyFinding(
			gameId,
			findingId,
			confirmed,
			explanation,
			overriddenIssueType,
			rejectionReason,
		);
	}

	/** @see SubmissionService.submitDispute */
	submitDispute(
		gameId: string,
		agentId: string,
		findingId: number,
		reason: string,
	): number {
		return this.submissionService.submitDispute(
			gameId,
			agentId,
			findingId,
			reason,
		);
	}

	/** @see SubmissionService.resolveDispute */
	resolveDispute(
		gameId: string,
		disputeId: number,
		verdict: "SUCCESSFUL" | "FAILED",
		explanation: string,
	): void {
		this.submissionService.resolveDispute(
			gameId,
			disputeId,
			verdict,
			explanation,
		);
	}

	/** @see SubmissionService.markAgentDone */
	markAgentDone(
		gameId: string,
		agentId: string,
		phase: "hunt" | "review",
	): void {
		this.submissionService.markAgentDone(gameId, agentId, phase);
	}

	// =========================================================================
	// Queries
	// =========================================================================

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

	// =========================================================================
	// Export
	// =========================================================================

	/**
	 * Exports game results to the logs directory.
	 */
	exportGame(gameId: string): ExportResult {
		const game = this.requireGame(gameId);
		const findings = this.findingRepo.findByGameId(gameId);
		const scoreboard = this.agentRepo.getScoreboard(gameId);

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

	// =========================================================================
	// Lifecycle
	// =========================================================================

	/**
	 * Fetches a game by ID or throws if not found.
	 */
	private requireGame(gameId: string): Game {
		const game = this.gameRepo.findById(gameId);
		if (!game) {
			throw new Error(`Game not found: ${gameId}`);
		}
		return game;
	}

	/** Closes the database connection. */
	close(): void {
		this.db.close();
	}
}
