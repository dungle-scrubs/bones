import type { Dispute } from "../domain/Dispute.js";
import type { Finding } from "../domain/Finding.js";
import type {
	Confidence,
	ImpactTier,
	IssueType,
	RejectionReason,
} from "../domain/types.js";
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
		issueType?: IssueType,
		impactTier?: ImpactTier,
		rejectionReason?: RejectionReason,
		needsVerification?: boolean,
		gameId?: string,
	): { verdict: "VALID" | "FALSE" | "DUPLICATE"; duplicateOfId?: number } {
		const agent = this.agentRepo.findById(finding.agentId);
		if (!agent) {
			throw new Error(`Agent not found: ${finding.agentId}`);
		}

		let finalVerdict = verdict;
		let finalDuplicateOfId = duplicateOfId;
		let finalExplanation = explanation;

		this.db.transaction(() => {
			// TOCTOU fix: check for duplicates inside transaction when marking as VALID
			if (finalVerdict === "VALID" && gameId) {
				const duplicate = this.checkForDuplicate(finding, gameId, true);
				if (duplicate && duplicate.id !== finding.id) {
					finalVerdict = "DUPLICATE";
					finalDuplicateOfId = duplicate.id;
					finalExplanation = `Duplicate of finding #${duplicate.id}: ${explanation}`;
					needsVerification = false;
				}
			}

			let points: number;

			switch (finalVerdict) {
				case "VALID":
					points = finding.validate(
						finalExplanation,
						confidence ?? "medium",
						confidenceScore,
						issueType,
						impactTier,
						needsVerification,
					);
					// Only record stats if not pending verification
					if (!needsVerification) {
						agent.recordValidFinding();
					}
					break;
				case "FALSE":
					points = finding.markFalseFlag(finalExplanation, rejectionReason);
					agent.recordFalseFinding();
					break;
				case "DUPLICATE":
					if (finalDuplicateOfId === undefined) {
						throw new Error("Duplicate verdict requires duplicateOfId");
					}
					points = finding.markDuplicate(finalDuplicateOfId, finalExplanation);
					agent.recordDuplicateFinding();
					break;
			}

			// Only award points if not pending verification
			if (!needsVerification || finalVerdict !== "VALID") {
				agent.awardPoints(points);
			}
			this.findingRepo.update(finding);
			this.agentRepo.update(agent);
		});

		return { verdict: finalVerdict, duplicateOfId: finalDuplicateOfId };
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
					// Check if finding was pending verification (stats never recorded)
					const wasPendingVerification = finding.needsVerification;

					// Reverse the finder's points (they lose the valid finding points)
					// and get false flag penalty instead
					finder.awardPoints(-finding.pointsAwarded); // Remove original points
					finding.revokeValidation(`Disputed: ${explanation}`); // Valid → FalseFlag
					finder.awardPoints(finding.pointsAwarded); // Apply new (negative) points

					// Update stats based on whether verification was pending
					if (wasPendingVerification) {
						// Stats were never recorded, just add the false finding
						finder.recordFalseFinding();
					} else {
						// Stats were recorded, revert valid to false
						finder.revertValidToFalse();
					}
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
