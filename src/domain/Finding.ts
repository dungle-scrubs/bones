import { createHash } from "node:crypto";
import {
	type Confidence,
	type FindingRow,
	FindingStatus,
	SCORING,
} from "./types.js";

/**
 * Represents a bug/issue discovered by an agent during the hunt phase.
 * Findings are submitted with a file location, description, and optional code snippet.
 * They go through validation by the referee and can be disputed by other agents.
 */
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

	/**
	 * Generates a fuzzy hash for detecting duplicate findings.
	 * Uses file path, bucketed line ranges (10-line granularity), and normalized keywords.
	 * Two findings with the same hash are considered likely duplicates requiring referee review.
	 */
	static computePatternHash(
		filePath: string,
		lineStart: number,
		lineEnd: number,
		description: string,
	): string {
		// Bucket line ranges to ~10 line granularity for fuzzy matching
		const bucketStart = Math.floor(lineStart / 10) * 10;
		const bucketEnd = Math.ceil(lineEnd / 10) * 10;

		// Extract key terms from description (remove common words)
		const keyTerms = Finding.extractKeyTerms(description);

		const normalized = `${filePath}:${bucketStart}-${bucketEnd}:${keyTerms}`;
		return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
	}

	/**
	 * Extracts meaningful keywords from a description for duplicate matching.
	 * Removes stop words (articles, prepositions, etc.) and returns sorted unique terms.
	 * Sorting ensures consistent hashing regardless of word order.
	 */
	private static extractKeyTerms(description: string): string {
		const stopWords = new Set([
			"a",
			"an",
			"the",
			"is",
			"are",
			"was",
			"were",
			"be",
			"been",
			"being",
			"have",
			"has",
			"had",
			"do",
			"does",
			"did",
			"will",
			"would",
			"could",
			"should",
			"may",
			"might",
			"must",
			"can",
			"this",
			"that",
			"these",
			"those",
			"it",
			"its",
			"of",
			"in",
			"to",
			"for",
			"on",
			"with",
			"at",
			"by",
			"from",
			"as",
			"into",
			"through",
			"and",
			"or",
			"but",
			"if",
			"because",
			"when",
			"where",
			"which",
			"while",
			"not",
			"no",
		]);

		return description
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 2 && !stopWords.has(w))
			.sort()
			.join(" ");
	}

	/**
	 * Checks if this finding's line range overlaps with another range.
	 * Used in duplicate detection to find findings targeting the same code.
	 */
	overlapsWithLines(otherStart: number, otherEnd: number): boolean {
		return this.lineStart <= otherEnd && this.lineEnd >= otherStart;
	}

	/**
	 * Computes a similarity score (0-1) between this finding and another.
	 * Combines line overlap (60%) and description keyword overlap (40%).
	 * Returns 0 if findings are in different files.
	 */
	similarityScore(other: Finding): number {
		// Must be same file
		if (this.filePath !== other.filePath) return 0;

		// Calculate line overlap ratio
		const overlapStart = Math.max(this.lineStart, other.lineStart);
		const overlapEnd = Math.min(this.lineEnd, other.lineEnd);
		const overlapLines = Math.max(0, overlapEnd - overlapStart + 1);
		const totalLines = Math.max(
			this.lineEnd - this.lineStart + 1,
			other.lineEnd - other.lineStart + 1,
		);
		const lineOverlap = overlapLines / totalLines;

		// Calculate description keyword overlap
		const thisTermsStr = Finding.extractKeyTerms(this.description);
		const otherTermsStr = Finding.extractKeyTerms(other.description);

		// Handle empty key terms - if both empty, consider descriptions equal for overlap
		// If only one is empty, there's no description overlap
		let descOverlap = 0;
		if (thisTermsStr === "" && otherTermsStr === "") {
			descOverlap = 1; // Both have no key terms, treat as matching
		} else if (thisTermsStr === "" || otherTermsStr === "") {
			descOverlap = 0; // One has terms, one doesn't - no overlap
		} else {
			const thisTerms = new Set(thisTermsStr.split(" "));
			const otherTerms = new Set(otherTermsStr.split(" "));
			const commonTerms = [...thisTerms].filter((t) =>
				otherTerms.has(t),
			).length;
			const totalTerms = Math.max(thisTerms.size, otherTerms.size);
			descOverlap = totalTerms > 0 ? commonTerms / totalTerms : 0;
		}

		// Weight: 60% line overlap, 40% description overlap
		return lineOverlap * 0.6 + descOverlap * 0.4;
	}

	/**
	 * Marks the finding as valid, awarding points to the submitting agent.
	 * Called by the referee when the finding represents a real issue.
	 * @returns Points awarded (positive)
	 * @throws Error if finding is not in pending status
	 */
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

	/**
	 * Marks the finding as a false positive, penalizing the submitting agent.
	 * Called by the referee when the finding is not a real issue.
	 * @returns Points awarded (negative)
	 * @throws Error if finding is not in pending status
	 */
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

	/**
	 * Revokes a previously valid finding after a successful dispute.
	 * Changes status from Valid to FalseFlag and adjusts points.
	 * Original submitter's stats are updated separately in Agent.revertValidToFalse().
	 * @returns Points awarded (negative)
	 * @throws Error if finding is not currently valid
	 */
	revokeValidation(verdict: string): number {
		if (this._status !== FindingStatus.Valid) {
			throw new Error(`Cannot revoke validation with status: ${this._status}`);
		}
		this._status = FindingStatus.FalseFlag;
		this._refereeVerdict = verdict;
		this._pointsAwarded = SCORING.FALSE_FLAG;
		return this._pointsAwarded;
	}

	/**
	 * Marks the finding as a duplicate of an earlier finding.
	 * Penalizes the submitter for not checking existing findings.
	 * @returns Points awarded (negative, more severe than false flag)
	 * @throws Error if finding is not in pending status
	 */
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

	/**
	 * Creates a new pending finding submitted by an agent.
	 * Automatically computes the pattern hash for duplicate detection.
	 */
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

	/**
	 * Reconstitutes a finding domain object from its database representation.
	 * Maps snake_case columns to camelCase properties and parses dates.
	 */
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

	/**
	 * Serializes the finding to database row format for persistence.
	 * Maps camelCase properties to snake_case columns and formats dates as ISO strings.
	 */
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
