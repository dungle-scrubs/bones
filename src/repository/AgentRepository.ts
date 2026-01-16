import { Agent } from "../domain/Agent.js";
import type {
	AgentRow,
	AgentStatus,
	ScoreboardEntry,
} from "../domain/types.js";
import { generateAgentNames } from "../utils/names.js";
import type { Database } from "./Database.js";

export class AgentRepository {
	constructor(private db: Database) {}

	create(id: string, gameId: string): Agent {
		const now = new Date().toISOString();

		const stmt = this.db.connection.prepare(`
      INSERT INTO agents (id, game_id, created_at)
      VALUES (?, ?, ?)
    `);

		stmt.run(id, gameId, now);

		return Agent.create(id, gameId);
	}

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

	findById(id: string): Agent | null {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents WHERE id = ?
    `);
		const row = stmt.get(id) as AgentRow | undefined;
		return row ? Agent.fromRow(row) : null;
	}

	findByGameId(gameId: string): Agent[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents WHERE game_id = ?
    `);
		const rows = stmt.all(gameId) as AgentRow[];
		return rows.map(Agent.fromRow);
	}

	findActiveByGameId(gameId: string): Agent[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents WHERE game_id = ? AND status = 'active'
    `);
		const rows = stmt.all(gameId) as AgentRow[];
		return rows.map(Agent.fromRow);
	}

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

		stmt.run(
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
	}

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

	getPendingHuntAgents(gameId: string, round: number): Agent[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents
      WHERE game_id = ? AND status = 'active' AND hunt_done_round < ?
    `);
		const rows = stmt.all(gameId, round) as AgentRow[];
		return rows.map(Agent.fromRow);
	}

	getPendingReviewAgents(gameId: string, round: number): Agent[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM agents
      WHERE game_id = ? AND status = 'active' AND review_done_round < ?
    `);
		const rows = stmt.all(gameId, round) as AgentRow[];
		return rows.map(Agent.fromRow);
	}
}
