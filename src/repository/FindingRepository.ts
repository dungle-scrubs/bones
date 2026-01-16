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

	findByPatternHash(
		gameId: string,
		patternHash: string,
		validOnly = false,
	): Finding | null {
		// When validOnly is true, only check against validated findings
		// When false, include both valid AND pending to prevent duplicate submissions
		const statusClause = validOnly
			? "status = 'valid'"
			: "status IN ('valid', 'pending')";
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings
      WHERE game_id = ? AND pattern_hash = ? AND ${statusClause}
      ORDER BY id ASC
      LIMIT 1
    `);
		const row = stmt.get(gameId, patternHash) as FindingRow | undefined;
		return row ? Finding.fromRow(row) : null;
	}

	// Find potential duplicates using overlap detection
	// Returns findings in same file with overlapping line ranges
	findPotentialDuplicates(
		gameId: string,
		filePath: string,
		lineStart: number,
		lineEnd: number,
	): Finding[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM findings
      WHERE game_id = ?
        AND file_path = ?
        AND status IN ('valid', 'pending')
        AND line_start <= ?
        AND line_end >= ?
      ORDER BY id ASC
    `);
		const rows = stmt.all(gameId, filePath, lineEnd, lineStart) as FindingRow[];
		return rows.map(Finding.fromRow);
	}

	// Find best duplicate match using similarity scoring
	findBestDuplicateMatch(
		gameId: string,
		newFinding: Finding,
		threshold = 0.5,
	): Finding | null {
		const candidates = this.findPotentialDuplicates(
			gameId,
			newFinding.filePath,
			newFinding.lineStart,
			newFinding.lineEnd,
		);

		let bestMatch: Finding | null = null;
		let bestScore = threshold;

		for (const candidate of candidates) {
			if (candidate.id === newFinding.id) continue;
			const score = newFinding.similarityScore(candidate);
			if (score > bestScore) {
				bestScore = score;
				bestMatch = candidate;
			}
		}

		return bestMatch;
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
