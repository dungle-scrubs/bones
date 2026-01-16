import { type AgentRow, type AgentStats, AgentStatus } from "./types.js";

export class Agent {
	constructor(
		public readonly id: string,
		public readonly gameId: string,
		private _score: number,
		private _stats: AgentStats,
		private _huntDoneRound: number,
		private _reviewDoneRound: number,
		private _status: AgentStatus,
		private _lastHeartbeat: Date | null,
		public readonly createdAt: Date,
	) {}

	get score(): number {
		return this._score;
	}

	get stats(): AgentStats {
		return { ...this._stats };
	}

	get status(): AgentStatus {
		return this._status;
	}

	get huntDoneRound(): number {
		return this._huntDoneRound;
	}

	get reviewDoneRound(): number {
		return this._reviewDoneRound;
	}

	get lastHeartbeat(): Date | null {
		return this._lastHeartbeat;
	}

	get isActive(): boolean {
		return this._status === AgentStatus.Active;
	}

	get isEliminated(): boolean {
		return this._status === AgentStatus.Eliminated;
	}

	hasFinishedHunt(round: number): boolean {
		return this._huntDoneRound >= round;
	}

	hasFinishedReview(round: number): boolean {
		return this._reviewDoneRound >= round;
	}

	awardPoints(points: number): void {
		this._score += points;
	}

	recordValidFinding(): void {
		// Note: findingsSubmitted is incremented by FindingRepository.create()
		this._stats.findingsValid++;
	}

	recordFalseFinding(): void {
		// Note: findingsSubmitted is incremented by FindingRepository.create()
		this._stats.findingsFalse++;
	}

	recordDuplicateFinding(): void {
		// Note: findingsSubmitted is incremented by FindingRepository.create()
		this._stats.findingsDuplicate++;
	}

	recordDisputeWon(): void {
		this._stats.disputesWon++;
	}

	recordDisputeLost(): void {
		this._stats.disputesLost++;
	}

	// Called when a valid finding is overturned by a successful dispute
	revertValidToFalse(): void {
		if (this._stats.findingsValid <= 0) {
			throw new Error("Cannot revert: findingsValid is already 0");
		}
		this._stats.findingsValid--;
		this._stats.findingsFalse++;
	}

	finishHunt(round: number): void {
		this._huntDoneRound = round;
	}

	finishReview(round: number): void {
		this._reviewDoneRound = round;
	}

	eliminate(): void {
		this._status = AgentStatus.Eliminated;
	}

	declareWinner(): void {
		this._status = AgentStatus.Winner;
	}

	heartbeat(): void {
		this._lastHeartbeat = new Date();
	}

	// Factory method to create new agent
	static create(id: string, gameId: string): Agent {
		return new Agent(
			id,
			gameId,
			0,
			{
				findingsSubmitted: 0,
				findingsValid: 0,
				findingsFalse: 0,
				findingsDuplicate: 0,
				disputesWon: 0,
				disputesLost: 0,
			},
			0,
			0,
			AgentStatus.Active,
			null,
			new Date(),
		);
	}

	// Factory method from database row
	static fromRow(row: AgentRow): Agent {
		return new Agent(
			row.id,
			row.game_id,
			row.score,
			{
				findingsSubmitted: row.findings_submitted,
				findingsValid: row.findings_valid,
				findingsFalse: row.findings_false,
				findingsDuplicate: row.findings_duplicate,
				disputesWon: row.disputes_won,
				disputesLost: row.disputes_lost,
			},
			row.hunt_done_round,
			row.review_done_round,
			row.status as AgentStatus,
			row.last_heartbeat ? new Date(row.last_heartbeat) : null,
			new Date(row.created_at),
		);
	}

	// Convert to database row format
	toRow(): AgentRow {
		return {
			id: this.id,
			game_id: this.gameId,
			score: this._score,
			findings_submitted: this._stats.findingsSubmitted,
			findings_valid: this._stats.findingsValid,
			findings_false: this._stats.findingsFalse,
			findings_duplicate: this._stats.findingsDuplicate,
			disputes_won: this._stats.disputesWon,
			disputes_lost: this._stats.disputesLost,
			hunt_done_round: this._huntDoneRound,
			review_done_round: this._reviewDoneRound,
			status: this._status,
			last_heartbeat: this._lastHeartbeat?.toISOString() ?? null,
			created_at: this.createdAt.toISOString(),
		};
	}
}
