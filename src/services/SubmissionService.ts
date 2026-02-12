/**
 * Handles finding/dispute submissions, validation, and verification.
 * Extracted from Orchestrator to isolate submission logic from phase management.
 */

import type {
	Confidence,
	ImpactTier,
	IssueType,
	RejectionReason,
} from "../domain/types.js";
import { HuntCategory, Phase, VerificationStatus } from "../domain/types.js";
import type { AgentRepository } from "../repository/AgentRepository.js";
import type { Database } from "../repository/Database.js";
import type { DisputeRepository } from "../repository/DisputeRepository.js";
import type { FindingRepository } from "../repository/FindingRepository.js";
import type { GameRepository } from "../repository/GameRepository.js";
import { Scorer } from "./Scorer.js";

/**
 * Manages the submission and validation lifecycle for findings and disputes.
 * All scoring operations delegate to Scorer for transactional consistency.
 */
export class SubmissionService {
	private scorer: Scorer;

	constructor(
		private db: Database,
		private gameRepo: GameRepository,
		private agentRepo: AgentRepository,
		private findingRepo: FindingRepository,
		private disputeRepo: DisputeRepository,
	) {
		this.scorer = new Scorer(db, agentRepo, findingRepo, disputeRepo);
	}

	/**
	 * Records a finding submitted by an agent during hunt phase.
	 *
	 * @returns The new finding's ID
	 * @throws Error if not in hunt phase, agent not found, or evidence missing for doc_drift
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
	 * Records the referee's validation decision for a finding.
	 * Automatically checks for duplicates when marking as VALID.
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
	 * Records the verification agent's decision on a finding.
	 *
	 * @returns Whether confirmed and points awarded
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

		const points = this.db.transaction(() => {
			// Fetch agent inside transaction to prevent lost updates
			const agent = this.agentRepo.findById(finding.agentId);
			if (!agent) {
				throw new Error(`Agent not found: ${finding.agentId}`);
			}

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
	 * Records a dispute filed by an agent against another's finding.
	 *
	 * @returns The new dispute's ID
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
	 * Marks an agent as done with the current phase.
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

	/**
	 * @throws Error if game not found
	 */
	private requireGame(gameId: string) {
		const game = this.gameRepo.findById(gameId);
		if (!game) {
			throw new Error(`Game not found: ${gameId}`);
		}
		return game;
	}
}
