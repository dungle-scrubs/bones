import { Agent } from "../domain/Agent.js";
import type {
	AgentRow,
	AgentStatus,
	ScoreboardEntry,
} from "../domain/types.js";
import { generateAgentNames } from "../utils/names.js";
import type { Database } from "./Database.js";

/**
 * Handles persistence of Agent entities to SQLite.
 * Provides scoreboard generation and phase completion tracking.
 */
export class AgentRepository {
	constructor(private db: Database) {}

	/** Creates a single agent with the specified ID. */
	create(id: string, gameId: string): Agent {
		const now = new Date().toISOString();

		const stmt = this.db.connection.prepare(`
      INSERT INTO agents (id, game_id, created_at)
      VALUES (?, ?, ?)
    `);

		stmt.run(id, gameId, now);

		return Agent.create(id, gameId);
	}

	/**
	 * Creates multiple agents with generated human-readable names.
	 * IDs are prefixed with gameId to prevent collisions across games.
	 */
	createMany(gameId: string, count: number): Agent[] {
		const agents: Agent[] = [];
		const stmt = this.db.connection.prepare(`
      INSERT INTO agents (id, game_id, created_at)
      VALUES (?, ?, ?)
    `);

		const now = new Date().toISOString();
		const names = generateAgentNames(count);

		for (const name of names) {
			// Prefix with gameId to avoid collisions across games
			const id = `${gameId}-${name}`;
			stmt.run(id, gameId, now);
			agents.push(Agent.create(id, gameId));
		}

		return agents;
	}

	/** Retrieves an agent by their full ID (gameId-name). */
	findById(id: string): Agent | null {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents WHERE id = ?
    `);
		const row = stmt.get(id) as AgentRow | undefined;
		return row ? Agent.fromRow(row) : null;
	}

	/** Lists all agents participating in a game. */
	findByGameId(gameId: string): Agent[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents WHERE game_id = ?
    `);
		const rows = stmt.all(gameId) as AgentRow[];
		return rows.map(Agent.fromRow);
	}

	/** Lists agents still competing (not eliminated or won). */
	findActiveByGameId(gameId: string): Agent[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents WHERE game_id = ? AND status = 'active'
    `);
		const rows = stmt.all(gameId) as AgentRow[];
		return rows.map(Agent.fromRow);
	}

	/**
	 * Persists all agent state changes (score, stats, phase completion).
	 * Called after scoring or phase transitions.
	 */
	update(agent: Agent): void {
		const row = agent.toRow();
		const stmt = this.db.connection.prepare(`
      UPDATE agents SET
        score = ?,
        findings_submitted = ?,
        findings_valid = ?,
        findings_false = ?,
        findings_duplicate = ?,
        disputes_won = ?,
        disputes_lost = ?,
        hunt_done_round = ?,
        review_done_round = ?,
        status = ?,
        last_heartbeat = ?
      WHERE id = ?
    `);

		const result = stmt.run(
			row.score,
			row.findings_submitted,
			row.findings_valid,
			row.findings_false,
			row.findings_duplicate,
			row.disputes_won,
			row.disputes_lost,
			row.hunt_done_round,
			row.review_done_round,
			row.status,
			row.last_heartbeat,
			row.id,
		);
		if (result.changes === 0) {
			throw new Error(`Agent not found for update: ${row.id}`);
		}
	}

	/**
	 * Returns agents formatted for scoreboard display.
	 * Ordered by score descending, then by valid findings as tiebreaker.
	 */
	getScoreboard(gameId: string): ScoreboardEntry[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents
      WHERE game_id = ?
      ORDER BY score DESC, findings_valid DESC
    `);
		const rows = stmt.all(gameId) as AgentRow[];

		return rows.map((row) => ({
			id: row.id,
			score: row.score,
			findingsSubmitted: row.findings_submitted,
			findingsValid: row.findings_valid,
			findingsFalse: row.findings_false,
			findingsDuplicate: row.findings_duplicate,
			disputesWon: row.disputes_won,
			disputesLost: row.disputes_lost,
			status: row.status as AgentStatus,
		}));
	}

	/**
	 * Returns agents who haven't marked themselves done for the current hunt.
	 * Used to check if hunt phase can proceed to scoring.
	 */
	getPendingHuntAgents(gameId: string, round: number): Agent[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents
      WHERE game_id = ? AND status = 'active' AND hunt_done_round < ?
    `);
		const rows = stmt.all(gameId, round) as AgentRow[];
		return rows.map(Agent.fromRow);
	}

	/**
	 * Returns agents who haven't marked themselves done for the current review.
	 * Used to check if review phase can proceed to scoring.
	 */
	getPendingReviewAgents(gameId: string, round: number): Agent[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents
      WHERE game_id = ? AND status = 'active' AND review_done_round < ?
    `);
		const rows = stmt.all(gameId, round) as AgentRow[];
		return rows.map(Agent.fromRow);
	}
}
