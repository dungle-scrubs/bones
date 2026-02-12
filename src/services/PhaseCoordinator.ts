/**
 * Manages game phase transitions, timer checks, and prompt generation.
 * Extracted from Orchestrator to keep phase lifecycle logic focused.
 */

import type { Game } from "../domain/Game.js";
import {
	type DisputeScoringResult,
	type HuntCheckResult,
	type HuntPhaseResult,
	Phase,
	type ReviewCheckResult,
	type ReviewPhaseResult,
	type ScoringPhaseResult,
	type WinnerCheckResult,
} from "../domain/types.js";
import type { AgentRepository } from "../repository/AgentRepository.js";
import type { DisputeRepository } from "../repository/DisputeRepository.js";
import type { FindingRepository } from "../repository/FindingRepository.js";
import type { GameRepository } from "../repository/GameRepository.js";
import { PromptRenderer } from "./PromptRenderer.js";

/**
 * Coordinates game phase transitions and generates prompts for each phase.
 * Does not handle submissions or scoring — those live in SubmissionService and Scorer.
 */
export class PhaseCoordinator {
	private promptRenderer = new PromptRenderer();

	constructor(
		private gameRepo: GameRepository,
		private agentRepo: AgentRepository,
		private findingRepo: FindingRepository,
		private disputeRepo: DisputeRepository,
		private scriptsPath: string,
	) {}

	/**
	 * Begins the hunt phase, generating prompts for each agent.
	 *
	 * @throws Error if game is not in Setup or ReviewScoring phase
	 */
	startHunt(game: Game): HuntPhaseResult {
		if (game.phase !== Phase.Setup && game.phase !== Phase.ReviewScoring) {
			throw new Error(`Cannot start hunt from phase: ${game.phase}`);
		}

		game.startHuntPhase();
		this.gameRepo.update(game);

		const agents = this.agentRepo.findActiveByGameId(game.id);
		const scoreboard = this.agentRepo.getScoreboard(game.id);
		const existingFindings = this.findingRepo.findValidByGameId(game.id);

		const agentPrompts = agents.map((agent) => ({
			agentId: agent.id,
			prompt: this.promptRenderer.renderHunt({
				gameId: game.id,
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
				`Check status with: check-hunt ${game.id}`,
			],
		};
	}

	/**
	 * Checks hunt phase status.
	 *
	 * @throws Error if not in Hunt phase
	 */
	checkHunt(game: Game): HuntCheckResult {
		if (game.phase !== Phase.Hunt) {
			throw new Error(`Not in hunt phase: ${game.phase}`);
		}

		const pendingAgents = this.agentRepo.getPendingHuntAgents(
			game.id,
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
					? `Start scoring with: start-hunt-scoring ${game.id}`
					: `Wait for agents or timeout. Check again with: check-hunt ${game.id}`,
		};
	}

	/**
	 * Transitions to hunt scoring phase and returns validation prompts.
	 *
	 * @throws Error if not in Hunt phase
	 */
	startHuntScoring(game: Game): ScoringPhaseResult {
		if (game.phase !== Phase.Hunt) {
			throw new Error(`Cannot start hunt scoring from phase: ${game.phase}`);
		}

		game.transitionTo(Phase.HuntScoring);
		this.gameRepo.update(game);

		const pendingFindings = this.findingRepo.findPendingByRound(
			game.id,
			game.round,
		);

		const validations = pendingFindings.map((finding) => ({
			findingId: finding.id,
			type: "finding_validation" as const,
			prompt: this.promptRenderer.renderFindingValidation({
				gameId: game.id,
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
				`When all validated: start-review ${game.id}`,
			],
		};
	}

	/**
	 * Begins the review phase where agents can dispute findings.
	 *
	 * @throws Error if not in HuntScoring phase
	 */
	startReview(game: Game): ReviewPhaseResult {
		if (game.phase !== Phase.HuntScoring) {
			throw new Error(`Cannot start review from phase: ${game.phase}`);
		}

		game.startReviewPhase();
		this.gameRepo.update(game);

		const agents = this.agentRepo.findActiveByGameId(game.id);
		const scoreboard = this.agentRepo.getScoreboard(game.id);
		const validFindings = this.findingRepo.findValidByGameId(game.id);

		const agentPrompts = agents.map((agent) => {
			const reviewableFindings = validFindings.filter(
				(f) => f.agentId !== agent.id,
			);
			return {
				agentId: agent.id,
				prompt: this.promptRenderer.renderReview({
					gameId: game.id,
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
				`Check status with: check-review ${game.id}`,
			],
		};
	}

	/**
	 * Checks review phase status.
	 *
	 * @throws Error if not in Review phase
	 */
	checkReview(game: Game): ReviewCheckResult {
		if (game.phase !== Phase.Review) {
			throw new Error(`Not in review phase: ${game.phase}`);
		}

		const pendingAgents = this.agentRepo.getPendingReviewAgents(
			game.id,
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
					? `Start scoring with: start-review-scoring ${game.id}`
					: `Wait for agents or timeout. Check again with: check-review ${game.id}`,
		};
	}

	/**
	 * Transitions to review scoring phase and returns dispute resolution prompts.
	 *
	 * @throws Error if not in Review phase
	 */
	startReviewScoring(game: Game): DisputeScoringResult {
		if (game.phase !== Phase.Review) {
			throw new Error(`Cannot start review scoring from phase: ${game.phase}`);
		}

		game.transitionTo(Phase.ReviewScoring);
		this.gameRepo.update(game);

		const pendingDisputes = this.disputeRepo.findPendingByRound(
			game.id,
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
					gameId: game.id,
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
				`When all resolved: check-winner ${game.id}`,
			],
		};
	}

	/**
	 * Determines if the game should end or continue to another round.
	 * Handles target score, ties, and max rounds.
	 *
	 * @throws Error if not in ReviewScoring phase
	 */
	checkWinner(game: Game): WinnerCheckResult {
		if (game.phase !== Phase.ReviewScoring) {
			throw new Error(`Cannot check winner from phase: ${game.phase}`);
		}

		const scoreboard = this.agentRepo.getScoreboard(game.id);
		const targetScore = game.config.targetScore;

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
			return {
				action: "TIE_BREAKER",
				tiedAgents: winners.map((w) => w.id),
				reason: `Multiple agents reached ${targetScore}: ${winners.map((w) => w.id).join(", ")}`,
				scores: scoreboard,
				next: `Continue with another round: start-hunt ${game.id}`,
			};
		}

		const maxRounds = game.config.maxRounds;
		if (maxRounds > 0 && game.round >= maxRounds) {
			const leader = scoreboard[0];
			if (leader) {
				const tiedForFirst = scoreboard.filter((e) => e.score === leader.score);
				if (tiedForFirst.length > 1) {
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

		return {
			action: "CONTINUE",
			reason: `No agent has reached ${targetScore} yet. Highest: ${scoreboard[0]?.score ?? 0}`,
			scores: scoreboard,
			next: `Continue with another round: start-hunt ${game.id}`,
		};
	}

	/**
	 * Returns findings needing verification with prompts for verifier agents.
	 */
	getPendingVerifications(game: Game): {
		findings: Array<{ findingId: number; prompt: string }>;
	} {
		const pendingFindings = this.findingRepo.findPendingVerificationByRound(
			game.id,
			game.round,
		);

		return {
			findings: pendingFindings.map((finding) => ({
				findingId: finding.id,
				prompt: this.promptRenderer.renderVerificationPrompt({
					gameId: game.id,
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
			})),
		};
	}
}
