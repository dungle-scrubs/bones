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
import { PromptRenderer } from "./PromptRenderer.js";
import { Scorer } from "./Scorer.js";

export interface SetupConfig {
	projectUrl: string;
	category?: HuntCategory;
	userPrompt?: string | null;
	targetScore?: number;
	huntDuration?: number;
	reviewDuration?: number;
	numAgents?: number;
	maxRounds?: number; // 0 = no limit, default 3
}

export interface ClarificationNeeded {
	action: "CLARIFICATION_NEEDED";
	conflicts: ConflictDetectionResult["conflicts"];
}

export interface ExportResult {
	gameId: string;
	outputDir: string;
	files: string[];
}

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

		const game = this.gameRepo.create(gameConfig);
		const agents = this.agentRepo.createMany(game.id, gameConfig.numAgents);

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

	validateFinding(
		gameId: string,
		findingId: number,
		verdict: "VALID" | "FALSE" | "DUPLICATE",
		explanation: string,
		confidence?: Confidence,
		duplicateOfId?: number,
	): { verdict: "VALID" | "FALSE" | "DUPLICATE"; duplicateOfId?: number } {
		const finding = this.findingRepo.findById(findingId);
		if (!finding || finding.gameId !== gameId) {
			throw new Error(`Finding not found: ${findingId}`);
		}

		// Check for duplicates if marking as valid
		if (verdict === "VALID") {
			const duplicate = this.scorer.checkForDuplicate(finding, gameId);
			if (duplicate && duplicate.id !== finding.id) {
				verdict = "DUPLICATE";
				duplicateOfId = duplicate.id;
				explanation = `Duplicate of finding #${duplicate.id}: ${explanation}`;
			}
		}

		this.scorer.applyFindingValidation(
			finding,
			verdict,
			explanation,
			confidence,
			duplicateOfId,
		);

		return { verdict, duplicateOfId };
	}

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
				const tiedForFirst = scoreboard.filter(
					(e) => e.score === leader.score,
				);
				if (tiedForFirst.length > 1) {
					return {
						action: "TIE_BREAKER",
						tiedAgents: tiedForFirst.map((w) => w.id),
						reason: `Max rounds (${maxRounds}) reached with tie at ${leader.score} points: ${tiedForFirst.map((w) => w.id).join(", ")}`,
						scores: scoreboard,
						next: `Continue with another round: start-hunt ${gameId}`,
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

	// Agent actions
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

	// Query methods
	getGame(gameId: string): Game | null {
		return this.gameRepo.findById(gameId);
	}

	getAllGames(): Game[] {
		return this.gameRepo.findAll();
	}

	getScoreboard(gameId: string) {
		return this.agentRepo.getScoreboard(gameId);
	}

	getFindings(gameId: string) {
		return this.findingRepo.findByGameId(gameId);
	}

	getDisputes(gameId: string) {
		return this.disputeRepo.findByGameId(gameId);
	}

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

	private requireGame(gameId: string): Game {
		const game = this.gameRepo.findById(gameId);
		if (!game) {
			throw new Error(`Game not found: ${gameId}`);
		}
		return game;
	}

	close(): void {
		this.db.close();
	}
}
