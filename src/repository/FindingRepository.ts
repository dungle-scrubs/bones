import { Finding } from "../domain/Finding.js";
import type { FindingRow } from "../domain/types.js";
import type { Database } from "./Database.js";

export interface CreateFindingInput {
	gameId: string;
	roundNumber: number;
	agentId: string;
	description: string;
	filePath: string;
	lineStart: number;
	lineEnd: number;
	codeSnippet?: string;
}

export class FindingRepository {
	constructor(private db: Database) {}

	create(input: CreateFindingInput): Finding {
		const patternHash = Finding.computePatternHash(
			input.filePath,
			input.lineStart,
			input.lineEnd,
			input.description,
		);
		const now = new Date().toISOString();

		const insertStmt = this.db.connection.prepare(`
      INSERT INTO findings (
        game_id, round_number, agent_id, description,
        file_path, line_start, line_end, code_snippet,
        pattern_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		const updateAgentStmt = this.db.connection.prepare(`
      UPDATE agents SET findings_submitted = findings_submitted + 1 WHERE id = ?
    `);

		const result = this.db.transaction(() => {
			const insertResult = insertStmt.run(
				input.gameId,
				input.roundNumber,
				input.agentId,
				input.description,
				input.filePath,
				input.lineStart,
				input.lineEnd,
				input.codeSnippet ?? null,
				patternHash,
				now,
			);
			updateAgentStmt.run(input.agentId);
			return insertResult;
		});

		return Finding.create(
			Number(result.lastInsertRowid),
			input.gameId,
			input.roundNumber,
			input.agentId,
			input.description,
			input.filePath,
			input.lineStart,
			input.lineEnd,
			input.codeSnippet ?? null,
		);
	}

	findById(id: number): Finding | null {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings WHERE id = ?
    `);
		const row = stmt.get(id) as FindingRow | undefined;
		return row ? Finding.fromRow(row) : null;
	}

	findByGameId(gameId: string): Finding[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings WHERE game_id = ?
      ORDER BY created_at DESC
    `);
		const rows = stmt.all(gameId) as FindingRow[];
		return rows.map(Finding.fromRow);
	}

	findByAgentId(agentId: string): Finding[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings WHERE agent_id = ?
      ORDER BY created_at DESC
    `);
		const rows = stmt.all(agentId) as FindingRow[];
		return rows.map(Finding.fromRow);
	}

	findPendingByGameId(gameId: string): Finding[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings
      WHERE game_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `);
		const rows = stmt.all(gameId) as FindingRow[];
		return rows.map(Finding.fromRow);
	}

	findPendingByRound(gameId: string, round: number): Finding[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings
      WHERE game_id = ? AND round_number = ? AND status = 'pending'
      ORDER BY created_at ASC
    `);
		const rows = stmt.all(gameId, round) as FindingRow[];
		return rows.map(Finding.fromRow);
	}

	findValidByGameId(gameId: string): Finding[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings
      WHERE game_id = ? AND status = 'valid'
      ORDER BY created_at DESC
    `);
		const rows = stmt.all(gameId) as FindingRow[];
		return rows.map(Finding.fromRow);
	}

	findByPatternHash(gameId: string, patternHash: string): Finding | null {
		// Include both valid AND pending findings for duplicate detection
		// This prevents two agents submitting the same bug before validation
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings
      WHERE game_id = ? AND pattern_hash = ? AND status IN ('valid', 'pending')
      ORDER BY id ASC
      LIMIT 1
    `);
		const row = stmt.get(gameId, patternHash) as FindingRow | undefined;
		return row ? Finding.fromRow(row) : null;
	}

	// Find findings eligible for review (valid findings not submitted by agent)
	findReviewableForAgent(gameId: string, agentId: string): Finding[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings
      WHERE game_id = ? AND status = 'valid' AND agent_id != ?
      ORDER BY created_at ASC
    `);
		const rows = stmt.all(gameId, agentId) as FindingRow[];
		return rows.map(Finding.fromRow);
	}

	update(finding: Finding): void {
		const row = finding.toRow();
		const stmt = this.db.connection.prepare(`
      UPDATE findings SET
        status = ?,
        duplicate_of = ?,
        referee_verdict = ?,
        confidence = ?,
        points_awarded = ?,
        validated_at = ?
      WHERE id = ?
    `);

		stmt.run(
			row.status,
			row.duplicate_of,
			row.referee_verdict,
			row.confidence,
			row.points_awarded,
			row.validated_at,
			row.id,
		);
	}

	countByGameId(gameId: string): number {
		const stmt = this.db.connection.prepare(`
      SELECT COUNT(*) as count FROM findings WHERE game_id = ?
    `);
		const result = stmt.get(gameId) as { count: number };
		return result.count;
	}

	countPendingByGameId(gameId: string): number {
		const stmt = this.db.connection.prepare(`
      SELECT COUNT(*) as count FROM findings
      WHERE game_id = ? AND status = 'pending'
    `);
		const result = stmt.get(gameId) as { count: number };
		return result.count;
	}

	countByRound(gameId: string, round: number): number {
		const stmt = this.db.connection.prepare(`
      SELECT COUNT(*) as count FROM findings
      WHERE game_id = ? AND round_number = ?
    `);
		const result = stmt.get(gameId, round) as { count: number };
		return result.count;
	}
}
