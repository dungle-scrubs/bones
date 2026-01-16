import { createHash } from "node:crypto";
import {
	type Confidence,
	type FindingRow,
	FindingStatus,
	SCORING,
} from "./types.js";

export class Finding {
	constructor(
		public readonly id: number,
		public readonly gameId: string,
		public readonly roundNumber: number,
		public readonly agentId: string,
		public readonly description: string,
		public readonly filePath: string,
		public readonly lineStart: number,
		public readonly lineEnd: number,
		public readonly codeSnippet: string | null,
		public readonly patternHash: string,
		private _status: FindingStatus,
		private _duplicateOf: number | null,
		private _refereeVerdict: string | null,
		private _confidence: Confidence | null,
		private _pointsAwarded: number,
		public readonly createdAt: Date,
		private _validatedAt: Date | null,
	) {}

	get status(): FindingStatus {
		return this._status;
	}

	get duplicateOf(): number | null {
		return this._duplicateOf;
	}

	get refereeVerdict(): string | null {
		return this._refereeVerdict;
	}

	get pointsAwarded(): number {
		return this._pointsAwarded;
	}

	get confidence(): Confidence | null {
		return this._confidence;
	}

	get validatedAt(): Date | null {
		return this._validatedAt;
	}

	get isPending(): boolean {
		return this._status === FindingStatus.Pending;
	}

	get isValid(): boolean {
		return this._status === FindingStatus.Valid;
	}

	get isDuplicate(): boolean {
		return this._status === FindingStatus.Duplicate;
	}

	get isFalseFlag(): boolean {
		return this._status === FindingStatus.FalseFlag;
	}

	// Compute pattern hash for duplicate detection
	// Normalizes whitespace and lowercases for fuzzy matching
	static computePatternHash(
		filePath: string,
		lineStart: number,
		lineEnd: number,
		description: string,
	): string {
		const normalized = `${filePath}:${lineStart}-${lineEnd}:${description
			.toLowerCase()
			.replace(/\s+/g, " ")
			.trim()}`;
		return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
	}

	// Validate as a legitimate finding
	validate(verdict: string, confidence: Confidence): number {
		if (this._status !== FindingStatus.Pending) {
			throw new Error(`Cannot validate finding with status: ${this._status}`);
		}
		this._status = FindingStatus.Valid;
		this._refereeVerdict = verdict;
		this._confidence = confidence;
		this._pointsAwarded = SCORING.VALID_FINDING;
		this._validatedAt = new Date();
		return this._pointsAwarded;
	}

	// Mark as false flag (from Pending)
	markFalseFlag(verdict: string): number {
		if (this._status !== FindingStatus.Pending) {
			throw new Error(`Cannot mark false flag with status: ${this._status}`);
		}
		this._status = FindingStatus.FalseFlag;
		this._refereeVerdict = verdict;
		this._pointsAwarded = SCORING.FALSE_FLAG;
		this._validatedAt = new Date();
		return this._pointsAwarded;
	}

	// Revoke validation after successful dispute (Valid → FalseFlag)
	revokeValidation(verdict: string): number {
		if (this._status !== FindingStatus.Valid) {
			throw new Error(`Cannot revoke validation with status: ${this._status}`);
		}
		this._status = FindingStatus.FalseFlag;
		this._refereeVerdict = verdict;
		this._pointsAwarded = SCORING.FALSE_FLAG;
		return this._pointsAwarded;
	}

	// Mark as duplicate of another finding
	markDuplicate(originalId: number, verdict: string): number {
		if (this._status !== FindingStatus.Pending) {
			throw new Error(`Cannot mark duplicate with status: ${this._status}`);
		}
		this._status = FindingStatus.Duplicate;
		this._duplicateOf = originalId;
		this._refereeVerdict = verdict;
		this._pointsAwarded = SCORING.DUPLICATE;
		this._validatedAt = new Date();
		return this._pointsAwarded;
	}

	// Factory method to create new finding
	static create(
		id: number,
		gameId: string,
		roundNumber: number,
		agentId: string,
		description: string,
		filePath: string,
		lineStart: number,
		lineEnd: number,
		codeSnippet: string | null,
	): Finding {
		const patternHash = Finding.computePatternHash(
			filePath,
			lineStart,
			lineEnd,
			description,
		);
		return new Finding(
			id,
			gameId,
			roundNumber,
			agentId,
			description,
			filePath,
			lineStart,
			lineEnd,
			codeSnippet,
			patternHash,
			FindingStatus.Pending,
			null,
			null,
			null, // confidence
			0,
			new Date(),
			null,
		);
	}

	// Factory method from database row
	static fromRow(row: FindingRow): Finding {
		return new Finding(
			row.id,
			row.game_id,
			row.round_number,
			row.agent_id,
			row.description,
			row.file_path,
			row.line_start,
			row.line_end,
			row.code_snippet,
			row.pattern_hash,
			row.status as FindingStatus,
			row.duplicate_of,
			row.referee_verdict,
			row.confidence,
			row.points_awarded,
			new Date(row.created_at),
			row.validated_at ? new Date(row.validated_at) : null,
		);
	}

	// Convert to database row format
	toRow(): FindingRow {
		return {
			id: this.id,
			game_id: this.gameId,
			round_number: this.roundNumber,
			agent_id: this.agentId,
			description: this.description,
			file_path: this.filePath,
			line_start: this.lineStart,
			line_end: this.lineEnd,
			code_snippet: this.codeSnippet,
			pattern_hash: this.patternHash,
			status: this._status,
			duplicate_of: this._duplicateOf,
			referee_verdict: this._refereeVerdict,
			confidence: this._confidence,
			points_awarded: this._pointsAwarded,
			created_at: this.createdAt.toISOString(),
			validated_at: this._validatedAt?.toISOString() ?? null,
		};
	}
}
