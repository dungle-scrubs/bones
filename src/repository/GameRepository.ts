import { randomBytes } from "node:crypto";
import { Game } from "../domain/Game.js";
import { type GameConfig, type GameRow, Phase } from "../domain/types.js";
import type { Database } from "./Database.js";

function extractProjectName(projectUrl: string): string {
	// Handle GitHub URLs: https://github.com/owner/repo or git@github.com:owner/repo
	const githubMatch = projectUrl.match(
		/github\.com[:/][\w-]+\/([\w.-]+?)(?:\.git)?$/,
	);
	if (githubMatch) {
		return githubMatch[1].toLowerCase();
	}

	// Handle local paths: /path/to/project or ./project
	const pathParts = projectUrl.replace(/\/$/, "").split("/");
	const lastPart = pathParts[pathParts.length - 1];
	if (lastPart) {
		return lastPart.toLowerCase().replace(/[^a-z0-9-]/g, "-");
	}

	return "project";
}

function generateGameId(projectUrl: string): string {
	const projectName = extractProjectName(projectUrl);
	const shortId = randomBytes(3).toString("hex"); // 6 chars
	return `${projectName}-${shortId}`;
}

export class GameRepository {
	constructor(private db: Database) {}

	create(config: GameConfig): Game {
		const id = generateGameId(config.projectUrl);
		const now = new Date().toISOString();

		const stmt = this.db.connection.prepare(`
      INSERT INTO games (
        id, project_url, category, user_prompt, target_score, hunt_duration,
        review_duration, num_agents, max_rounds, current_round, phase, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'setup', ?)
    `);

		stmt.run(
			id,
			config.projectUrl,
			config.category,
			config.userPrompt,
			config.targetScore,
			config.huntDuration,
			config.reviewDuration,
			config.numAgents,
			config.maxRounds,
			now,
		);

		return new Game(
			id,
			config,
			Phase.Setup,
			0,
			null,
			null,
			new Date(now),
			null,
		);
	}

	findById(id: string): Game | null {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM games WHERE id = ?
    `);
		const row = stmt.get(id) as GameRow | undefined;
		return row ? Game.fromRow(row) : null;
	}

	findActiveByProject(projectUrl: string): Game | null {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM games
      WHERE project_url = ? AND phase != 'complete'
      ORDER BY created_at DESC
      LIMIT 1
    `);
		const row = stmt.get(projectUrl) as GameRow | undefined;
		return row ? Game.fromRow(row) : null;
	}

	findMostRecent(): Game | null {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM games
      ORDER BY created_at DESC
      LIMIT 1
    `);
		const row = stmt.get() as GameRow | undefined;
		return row ? Game.fromRow(row) : null;
	}

	findAll(limit: number = 50): Game[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM games
      ORDER BY created_at DESC
      LIMIT ?
    `);
		const rows = stmt.all(limit) as GameRow[];
		return rows.map((row) => Game.fromRow(row));
	}

	update(game: Game): void {
		const row = game.toRow();
		const stmt = this.db.connection.prepare(`
      UPDATE games SET
        current_round = ?,
        phase = ?,
        phase_ends_at = ?,
        winner_agent_id = ?,
        completed_at = ?
      WHERE id = ?
    `);

		stmt.run(
			row.current_round,
			row.phase,
			row.phase_ends_at,
			row.winner_agent_id,
			row.completed_at,
			row.id,
		);
	}

	delete(id: string): void {
		const stmt = this.db.connection.prepare(`
      DELETE FROM games WHERE id = ?
    `);
		stmt.run(id);
	}
}
