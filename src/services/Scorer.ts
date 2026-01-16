import type { Dispute } from "../domain/Dispute.js";
import type { Finding } from "../domain/Finding.js";
import type { BugCategory, Confidence } from "../domain/types.js";
import type { AgentRepository } from "../repository/AgentRepository.js";
import type { Database } from "../repository/Database.js";
import type { DisputeRepository } from "../repository/DisputeRepository.js";
import type { FindingRepository } from "../repository/FindingRepository.js";

/**
 * Handles score calculations and state updates when findings/disputes are validated.
 * All scoring operations are transactional to ensure consistency.
 */
export class Scorer {
	constructor(
		private db: Database,
		private agentRepo: AgentRepository,
		private findingRepo: FindingRepository,
		private disputeRepo: DisputeRepository,
	) {}

	/**
	 * Applies a referee's finding validation to the submitting agent's score.
	 * Updates finding status, agent score, and agent statistics atomically.
	 * If needsVerification is true, defers scoring until verification completes.
	 */
	applyFindingValidation(
		finding: Finding,
		verdict: "VALID" | "FALSE" | "DUPLICATE",
		explanation: string,
		confidence?: Confidence,
		duplicateOfId?: number,
		confidenceScore?: number,
		bugCategory?: BugCategory,
		needsVerification?: boolean,
	): void {
		const agent = this.agentRepo.findById(finding.agentId);
		if (!agent) {
			throw new Error(`Agent not found: ${finding.agentId}`);
		}

		this.db.transaction(() => {
			let points: number;

			switch (verdict) {
				case "VALID":
					points = finding.validate(
						explanation,
						confidence ?? "medium",
						confidenceScore,
						bugCategory,
						needsVerification,
					);
					// Only record stats if not pending verification
					if (!needsVerification) {
						agent.recordValidFinding();
					}
					break;
				case "FALSE":
					points = finding.markFalseFlag(explanation);
					agent.recordFalseFinding();
					break;
				case "DUPLICATE":
					if (duplicateOfId === undefined) {
						throw new Error("Duplicate verdict requires duplicateOfId");
					}
					points = finding.markDuplicate(duplicateOfId, explanation);
					agent.recordDuplicateFinding();
					break;
			}

			// Only award points if not pending verification
			if (!needsVerification || verdict !== "VALID") {
				agent.awardPoints(points);
			}
			this.findingRepo.update(finding);
			this.agentRepo.update(agent);
		});
	}

	/**
	 * Applies a referee's dispute resolution, affecting both parties.
	 * On success: disputer gains points, finder loses points and finding is revoked.
	 * On failure: disputer loses points, finder keeps their valid finding.
	 */
	applyDisputeResolution(
		dispute: Dispute,
		finding: Finding,
		verdict: "SUCCESSFUL" | "FAILED",
		explanation: string,
	): void {
		const disputer = this.agentRepo.findById(dispute.disputerId);
		const finder = this.agentRepo.findById(finding.agentId);

		if (!disputer || !finder) {
			throw new Error("Agent not found for dispute resolution");
		}

		this.db.transaction(() => {
			if (verdict === "SUCCESSFUL") {
				// Disputer was right - finding was actually invalid
				const disputerPoints = dispute.resolveSuccessful(explanation);
				disputer.awardPoints(disputerPoints);
				disputer.recordDisputeWon();

				// Only revoke if finding is still valid (another dispute may have already revoked it)
				if (finding.isValid) {
					// Reverse the finder's points (they lose the valid finding points)
					// and get false flag penalty instead
					finder.awardPoints(-finding.pointsAwarded); // Remove original points
					finding.revokeValidation(`Disputed: ${explanation}`); // Valid → FalseFlag
					finder.awardPoints(finding.pointsAwarded); // Apply new (negative) points
					finder.revertValidToFalse(); // Update stats: valid-- , false++
				}
				// If already revoked, disputer still gets points but finding already penalized
			} else {
				// Dispute failed - original finding was correct
				const disputerPoints = dispute.resolveFailed(explanation);
				disputer.awardPoints(disputerPoints);
				disputer.recordDisputeLost();
			}

			this.disputeRepo.update(dispute);
			this.findingRepo.update(finding);
			this.agentRepo.update(disputer);
			this.agentRepo.update(finder);
		});
	}

	/**
	 * Checks if a finding is a duplicate of an existing one by pattern hash.
	 * @param validOnly When true, only matches against validated findings.
	 *                  When false, also matches pending findings.
	 */
	checkForDuplicate(
		finding: Finding,
		gameId: string,
		validOnly = false,
	): Finding | null {
		return this.findingRepo.findByPatternHash(
			gameId,
			finding.patternHash,
			validOnly,
		);
	}
}
