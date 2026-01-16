import { Dispute } from "../domain/Dispute.js";
import type { DisputeRow } from "../domain/types.js";
import type { Database } from "./Database.js";

export interface CreateDisputeInput {
	gameId: string;
	roundNumber: number;
	findingId: number;
	disputerId: string;
	reason: string;
}

export class DisputeRepository {
	constructor(private db: Database) {}

	create(input: CreateDisputeInput): Dispute {
		const now = new Date().toISOString();

		const stmt = this.db.connection.prepare(`
      INSERT INTO disputes (
        game_id, round_number, finding_id, disputer_id, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

		const result = stmt.run(
			input.gameId,
			input.roundNumber,
			input.findingId,
			input.disputerId,
			input.reason,
			now,
		);

		return Dispute.create(
			Number(result.lastInsertRowid),
			input.gameId,
			input.roundNumber,
			input.findingId,
			input.disputerId,
			input.reason,
		);
	}

	findById(id: number): Dispute | null {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM disputes WHERE id = ?
    `);
		const row = stmt.get(id) as DisputeRow | undefined;
		return row ? Dispute.fromRow(row) : null;
	}

	findByGameId(gameId: string): Dispute[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM disputes WHERE game_id = ?
      ORDER BY created_at DESC
    `);
		const rows = stmt.all(gameId) as DisputeRow[];
		return rows.map(Dispute.fromRow);
	}

	findByFindingId(findingId: number): Dispute[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM disputes WHERE finding_id = ?
      ORDER BY created_at DESC
    `);
		const rows = stmt.all(findingId) as DisputeRow[];
		return rows.map(Dispute.fromRow);
	}

	findPendingByGameId(gameId: string): Dispute[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM disputes
      WHERE game_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `);
		const rows = stmt.all(gameId) as DisputeRow[];
		return rows.map(Dispute.fromRow);
	}

	findPendingByRound(gameId: string, round: number): Dispute[] {
		const stmt = this.db.connection.prepare(`
      SELECT * FROM disputes
      WHERE game_id = ? AND round_number = ? AND status = 'pending'
      ORDER BY created_at ASC
    `);
		const rows = stmt.all(gameId, round) as DisputeRow[];
		return rows.map(Dispute.fromRow);
	}

	// Check if agent already disputed a finding
	hasAgentDisputed(findingId: number, disputerId: string): boolean {
		const stmt = this.db.connection.prepare(`
      SELECT 1 FROM disputes
      WHERE finding_id = ? AND disputer_id = ?
      LIMIT 1
    `);
		const result = stmt.get(findingId, disputerId);
		return result !== undefined;
	}

	update(dispute: Dispute): void {
		const row = dispute.toRow();
		const stmt = this.db.connection.prepare(`
      UPDATE disputes SET
        status = ?,
        referee_verdict = ?,
        points_awarded = ?,
        resolved_at = ?
      WHERE id = ?
    `);

		stmt.run(
			row.status,
			row.referee_verdict,
			row.points_awarded,
			row.resolved_at,
			row.id,
		);
	}

	countPendingByGameId(gameId: string): number {
		const stmt = this.db.connection.prepare(`
      SELECT COUNT(*) as count FROM disputes
      WHERE game_id = ? AND status = 'pending'
    `);
		const result = stmt.get(gameId) as { count: number };
		return result.count;
	}
}
