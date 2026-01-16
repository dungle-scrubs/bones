import { type DisputeRow, DisputeStatus, SCORING } from "./types.js";

/**
 * Represents a challenge against another agent's finding during the review phase.
 * Disputes allow agents to earn points by identifying false positives in others' findings.
 * Successful disputes overturn the original finding and penalize its submitter.
 */
export class Dispute {
	constructor(
		public readonly id: number,
		public readonly gameId: string,
		public readonly roundNumber: number,
		public readonly findingId: number,
		public readonly disputerId: string,
		public readonly reason: string,
		private _status: DisputeStatus,
		private _refereeVerdict: string | null,
		private _pointsAwarded: number,
		public readonly createdAt: Date,
		private _resolvedAt: Date | null,
	) {}

	get status(): DisputeStatus {
		return this._status;
	}

	get refereeVerdict(): string | null {
		return this._refereeVerdict;
	}

	get pointsAwarded(): number {
		return this._pointsAwarded;
	}

	get resolvedAt(): Date | null {
		return this._resolvedAt;
	}

	get isPending(): boolean {
		return this._status === DisputeStatus.Pending;
	}

	get isSuccessful(): boolean {
		return this._status === DisputeStatus.Successful;
	}

	get isFailed(): boolean {
		return this._status === DisputeStatus.Failed;
	}

	/**
	 * Marks the dispute as successful, awarding points to the disputer.
	 * Called when the referee determines the original finding was incorrect.
	 * The original finding gets revoked and its submitter loses points.
	 * @returns Points awarded to the disputer (positive)
	 * @throws Error if dispute is not in pending status
	 */
	resolveSuccessful(verdict: string): number {
		if (this._status !== DisputeStatus.Pending) {
			throw new Error(`Cannot resolve dispute with status: ${this._status}`);
		}
		this._status = DisputeStatus.Successful;
		this._refereeVerdict = verdict;
		this._pointsAwarded = SCORING.DISPUTE_WON;
		this._resolvedAt = new Date();
		return this._pointsAwarded;
	}

	/**
	 * Marks the dispute as failed, penalizing the disputer.
	 * Called when the referee confirms the original finding was valid.
	 * The disputer loses points for the frivolous challenge.
	 * @returns Points awarded to the disputer (negative)
	 * @throws Error if dispute is not in pending status
	 */
	resolveFailed(verdict: string): number {
		if (this._status !== DisputeStatus.Pending) {
			throw new Error(`Cannot resolve dispute with status: ${this._status}`);
		}
		this._status = DisputeStatus.Failed;
		this._refereeVerdict = verdict;
		this._pointsAwarded = SCORING.DISPUTE_LOST;
		this._resolvedAt = new Date();
		return this._pointsAwarded;
	}

	/**
	 * Creates a new pending dispute against an existing finding.
	 * Called when an agent challenges another agent's finding during review phase.
	 */
	static create(
		id: number,
		gameId: string,
		roundNumber: number,
		findingId: number,
		disputerId: string,
		reason: string,
	): Dispute {
		return new Dispute(
			id,
			gameId,
			roundNumber,
			findingId,
			disputerId,
			reason,
			DisputeStatus.Pending,
			null,
			0,
			new Date(),
			null,
		);
	}

	/**
	 * Reconstitutes a dispute domain object from its database representation.
	 * Maps snake_case columns to camelCase properties and parses dates.
	 */
	static fromRow(row: DisputeRow): Dispute {
		return new Dispute(
			row.id,
			row.game_id,
			row.round_number,
			row.finding_id,
			row.disputer_id,
			row.reason,
			row.status as DisputeStatus,
			row.referee_verdict,
			row.points_awarded,
			new Date(row.created_at),
			row.resolved_at ? new Date(row.resolved_at) : null,
		);
	}

	/**
	 * Serializes the dispute to database row format for persistence.
	 * Maps camelCase properties to snake_case columns and formats dates as ISO strings.
	 */
	toRow(): DisputeRow {
		return {
			id: this.id,
			game_id: this.gameId,
			round_number: this.roundNumber,
			finding_id: this.findingId,
			disputer_id: this.disputerId,
			reason: this.reason,
			status: this._status,
			referee_verdict: this._refereeVerdict,
			points_awarded: this._pointsAwarded,
			created_at: this.createdAt.toISOString(),
			resolved_at: this._resolvedAt?.toISOString() ?? null,
		};
	}
}
