import {
	buildHuntPrompt,
	type GameConfig,
	type GameRow,
	type HuntCategory,
	PHASE_TRANSITIONS,
	Phase,
} from "./types.js";

export class Game {
	constructor(
		public readonly id: string,
		public readonly config: GameConfig,
		private _phase: Phase,
		private _round: number,
		private _phaseEndsAt: Date | null,
		private _winnerId: string | null,
		public readonly createdAt: Date,
		private _completedAt: Date | null,
	) {}

	get phase(): Phase {
		return this._phase;
	}

	get round(): number {
		return this._round;
	}

	get phaseEndsAt(): Date | null {
		return this._phaseEndsAt;
	}

	get winnerId(): string | null {
		return this._winnerId;
	}

	get completedAt(): Date | null {
		return this._completedAt;
	}

	get category(): HuntCategory {
		return this.config.category;
	}

	get huntPrompt(): string {
		return buildHuntPrompt(this.config.category, this.config.userPrompt);
	}

	get isComplete(): boolean {
		return this._phase === Phase.Complete;
	}

	get isTimedPhase(): boolean {
		return this._phase === Phase.Hunt || this._phase === Phase.Review;
	}

	get timeRemaining(): number {
		if (!this._phaseEndsAt) return 0;
		return Math.max(
			0,
			Math.floor((this._phaseEndsAt.getTime() - Date.now()) / 1000),
		);
	}

	get isPhaseExpired(): boolean {
		if (!this._phaseEndsAt) return false;
		return Date.now() >= this._phaseEndsAt.getTime();
	}

	canTransitionTo(phase: Phase): boolean {
		const nextPhase = PHASE_TRANSITIONS[this._phase];
		if (nextPhase === phase) return true;
		// Special case: ReviewScoring can go to Complete
		if (this._phase === Phase.ReviewScoring && phase === Phase.Complete)
			return true;
		return false;
	}

	transitionTo(phase: Phase): void {
		if (!this.canTransitionTo(phase)) {
			throw new Error(`Invalid phase transition: ${this._phase} -> ${phase}`);
		}
		this._phase = phase;
		this._phaseEndsAt = null;
	}

	startHuntPhase(): void {
		if (this._phase !== Phase.Setup && this._phase !== Phase.ReviewScoring) {
			throw new Error(`Cannot start hunt from phase: ${this._phase}`);
		}
		this._phase = Phase.Hunt;
		this._round++;
		this._phaseEndsAt = new Date(Date.now() + this.config.huntDuration * 1000);
	}

	startReviewPhase(): void {
		if (this._phase !== Phase.HuntScoring) {
			throw new Error(`Cannot start review from phase: ${this._phase}`);
		}
		this._phase = Phase.Review;
		this._phaseEndsAt = new Date(
			Date.now() + this.config.reviewDuration * 1000,
		);
	}

	complete(winnerId: string): void {
		if (this._phase !== Phase.ReviewScoring) {
			throw new Error(`Cannot complete game from phase: ${this._phase}`);
		}
		this._phase = Phase.Complete;
		this._winnerId = winnerId;
		this._completedAt = new Date();
		this._phaseEndsAt = null;
	}

	// Factory method from database row
	static fromRow(row: GameRow): Game {
		return new Game(
			row.id,
			{
				projectUrl: row.project_url,
				category: row.category as HuntCategory,
				userPrompt: row.user_prompt,
				targetScore: row.target_score,
				huntDuration: row.hunt_duration,
				reviewDuration: row.review_duration,
				numAgents: row.num_agents,
				maxRounds: row.max_rounds ?? 3,
			},
			row.phase as Phase,
			row.current_round,
			row.phase_ends_at ? new Date(row.phase_ends_at) : null,
			row.winner_agent_id,
			new Date(row.created_at),
			row.completed_at ? new Date(row.completed_at) : null,
		);
	}

	// Convert to database row format
	toRow(): GameRow {
		return {
			id: this.id,
			project_url: this.config.projectUrl,
			category: this.config.category,
			user_prompt: this.config.userPrompt,
			target_score: this.config.targetScore,
			hunt_duration: this.config.huntDuration,
			review_duration: this.config.reviewDuration,
			num_agents: this.config.numAgents,
			max_rounds: this.config.maxRounds,
			current_round: this._round,
			phase: this._phase,
			phase_ends_at: this._phaseEndsAt?.toISOString() ?? null,
			winner_agent_id: this._winnerId,
			created_at: this.createdAt.toISOString(),
			completed_at: this._completedAt?.toISOString() ?? null,
		};
	}
}
