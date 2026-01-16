// Game phases - mirrors CLI types
export type Phase =
	| "setup"
	| "hunt"
	| "hunt_scoring"
	| "review"
	| "review_scoring"
	| "complete";

export type AgentStatus = "active" | "eliminated" | "winner";

// API response types
export interface GameState {
	id: string;
	phase: Phase;
	round: number;
	targetScore: number;
	huntDuration: number;
	reviewDuration: number;
	phaseEndsAt: string | null;
	timeRemaining: number;
	winner: string | null;
	isComplete: boolean;
	createdAt: string;
	completedAt: string | null;
}

export interface ScoreboardEntry {
	id: string;
	score: number;
	findingsSubmitted: number;
	findingsValid: number;
	findingsFalse: number;
	findingsDuplicate: number;
	disputesWon: number;
	disputesLost: number;
	status: AgentStatus;
}

export interface GameStats {
	totalFindings: number;
	validFindings: number;
	pendingFindings: number;
	totalDisputes: number;
	pendingDisputes: number;
}

export interface GameResponse {
	game: GameState;
	scoreboard: ScoreboardEntry[];
	stats: GameStats;
	timestamp: string;
}

// Phase display metadata
export const PHASE_CONFIG: Record<
	Phase,
	{ label: string; color: string; description: string }
> = {
	setup: {
		label: "Setup",
		color: "var(--color-muted-foreground)",
		description: "Game is being configured",
	},
	hunt: {
		label: "Hunt",
		color: "var(--color-hunt)",
		description: "Agents are hunting for issues",
	},
	hunt_scoring: {
		label: "Scoring",
		color: "var(--color-scoring)",
		description: "Validating hunt findings",
	},
	review: {
		label: "Review",
		color: "var(--color-review)",
		description: "Agents are reviewing findings",
	},
	review_scoring: {
		label: "Scoring",
		color: "var(--color-scoring)",
		description: "Resolving disputes",
	},
	complete: {
		label: "Complete",
		color: "var(--color-complete)",
		description: "Game has ended",
	},
};
