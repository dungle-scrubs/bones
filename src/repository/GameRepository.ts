import { randomBytes } from "node:crypto";
import { Game } from "../domain/Game.js";
import { type GameConfig, type GameRow, Phase } from "../domain/types.js";
import type { Database } from "./Database.js";

/**
 * Extracts a readable project name from a URL or path for use in game IDs.
 * Handles GitHub URLs, local paths, and falls back to "project".
 */
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

/**
 * Generates a human-readable game ID combining project name and random suffix.
 * Format: {project-name}-{6-char-hex} (e.g., "my-repo-a1b2c3")
 */
function generateGameId(projectUrl: string): string {
	const projectName = extractProjectName(projectUrl);
	const shortId = randomBytes(3).toString("hex"); // 6 chars
	return `${projectName}-${shortId}`;
}

/**
 * Handles persistence of Game entities to SQLite.
 * Provides CRUD operations and queries for game state.
 */
export class GameRepository {
	constructor(private db: Database) {}

	/**
	 * Creates a new game in the database with Setup phase.
	 * Generates a unique game ID from the project URL.
	 */
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

	/** Retrieves a game by its unique ID. Returns null if not found. */
	findById(id: string): Game | null {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM games WHERE id = ?
    `);
		const row = stmt.get(id) as GameRow | undefined;
		return row ? Game.fromRow(row) : null;
	}

	/**
	 * Finds an incomplete game for a project URL.
	 * Used to prevent creating duplicate games for the same project.
	 */
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

	/** Returns the most recently created game, regardless of status. */
	findMostRecent(): Game | null {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM games
      ORDER BY created_at DESC
      LIMIT 1
    `);
		const row = stmt.get() as GameRow | undefined;
		return row ? Game.fromRow(row) : null;
	}

	/** Lists games ordered by creation date, most recent first. */
	findAll(limit: number = 50): Game[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM games
      ORDER BY created_at DESC
      LIMIT ?
    `);
		const rows = stmt.all(limit) as GameRow[];
		return rows.map((row) => Game.fromRow(row));
	}

	/**
	 * Persists changes to game state (phase, round, winner, etc.).
	 * Does not update immutable config fields.
	 */
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

	/**
	 * Deletes a game and all related data (agents, findings, disputes).
	 * Uses CASCADE delete defined in schema foreign keys.
	 */
	delete(id: string): void {
		const stmt = this.db.connection.prepare(`
      DELETE FROM games WHERE id = ?
    `);
		stmt.run(id);
	}
}
