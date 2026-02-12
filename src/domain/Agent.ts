import { type AgentRow, type AgentStats, AgentStatus } from "./types.js";

/**
 * Represents a competing agent in the Bones game.
 * Tracks the agent's score, statistics, and lifecycle through hunt/review phases.
 * Agents compete by submitting findings and disputing others' findings.
 */
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

	/**
	 * Checks if agent has signaled completion for the hunt phase of a given round.
	 * Prevents agents from continuing to submit after declaring done.
	 */
	hasFinishedHunt(round: number): boolean {
		return this._huntDoneRound >= round;
	}

	/**
	 * Checks if agent has signaled completion for the review phase of a given round.
	 * Prevents agents from continuing to dispute after declaring done.
	 */
	hasFinishedReview(round: number): boolean {
		return this._reviewDoneRound >= round;
	}

	/**
	 * Modifies the agent's score by the given point delta.
	 * Can be positive (valid findings, successful disputes) or negative (false flags, failed disputes).
	 */
	awardPoints(points: number): void {
		this._score += points;
	}

	/**
	 * Increments the valid findings counter after referee confirms a finding.
	 * Note: findingsSubmitted is incremented separately by FindingRepository.create().
	 */
	recordValidFinding(): void {
		this._stats.findingsValid++;
	}

	/**
	 * Increments the false findings counter after referee rejects a finding.
	 * Note: findingsSubmitted is incremented separately by FindingRepository.create().
	 */
	recordFalseFinding(): void {
		this._stats.findingsFalse++;
	}

	/**
	 * Increments the duplicate findings counter after referee identifies a duplicate.
	 * Note: findingsSubmitted is incremented separately by FindingRepository.create().
	 */
	recordDuplicateFinding(): void {
		this._stats.findingsDuplicate++;
	}

	/**
	 * Increments the disputes won counter after a successful challenge.
	 * Called when this agent's dispute overturns another agent's finding.
	 */
	recordDisputeWon(): void {
		this._stats.disputesWon++;
	}

	/**
	 * Increments the disputes lost counter after a failed challenge.
	 * Called when this agent's dispute is rejected by the referee.
	 */
	recordDisputeLost(): void {
		this._stats.disputesLost++;
	}

	/**
	 * Adjusts stats when a previously valid finding is overturned by dispute.
	 * Moves one count from findingsValid to findingsFalse to maintain accuracy.
	 * @throws Error if findingsValid is already 0 (invariant violation)
	 */
	revertValidToFalse(): void {
		if (this._stats.findingsValid <= 0) {
			throw new Error("Cannot revert: findingsValid is already 0");
		}
		this._stats.findingsValid--;
		this._stats.findingsFalse++;
	}

	/**
	 * Marks the agent as done with the hunt phase for the specified round.
	 * Once called, agent cannot submit more findings until next round.
	 */
	finishHunt(round: number): void {
		this._huntDoneRound = round;
	}

	/**
	 * Marks the agent as done with the review phase for the specified round.
	 * Once called, agent cannot submit more disputes until next round.
	 */
	finishReview(round: number): void {
		this._reviewDoneRound = round;
	}

	/**
	 * Removes the agent from active competition.
	 * Eliminated agents cannot submit findings or disputes.
	 */
	eliminate(): void {
		this._status = AgentStatus.Eliminated;
	}

	/**
	 * Marks this agent as the game winner.
	 * Called when agent reaches target score or wins tiebreaker.
	 */
	declareWinner(): void {
		this._status = AgentStatus.Winner;
	}

	/**
	 * Updates the last heartbeat timestamp to now.
	 * Used to detect stalled/crashed agents during timed phases.
	 */
	heartbeat(): void {
		this._lastHeartbeat = new Date();
	}

	/**
	 * Creates a new agent with zeroed stats and active status.
	 * Called at game setup to initialize the competing agents.
	 */
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

	/**
	 * Reconstitutes an agent domain object from its database representation.
	 * Maps snake_case columns to camelCase properties and parses dates.
	 */
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

	/**
	 * Serializes the agent to database row format for persistence.
	 * Maps camelCase properties to snake_case columns and formats dates as ISO strings.
	 */
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
