import { createHash } from "node:crypto";
import {
	type Confidence,
	type FindingRow,
	FindingStatus,
	type ImpactTier,
	type IssueType,
	type RejectionReason,
	SCORING,
	VerificationStatus,
} from "./types.js";

/** All fields needed to construct a Finding. Used by constructor and factories. */
export interface FindingInit {
	id: number;
	gameId: string;
	roundNumber: number;
	agentId: string;
	description: string;
	filePath: string;
	lineStart: number;
	lineEnd: number;
	codeSnippet: string | null;
	patternHash: string;
	status: FindingStatus;
	duplicateOf: number | null;
	refereeVerdict: string | null;
	confidence: Confidence | null;
	pointsAwarded: number;
	createdAt: Date;
	validatedAt: Date | null;
	confidenceScore: number | null;
	issueType: IssueType | null;
	impactTier: ImpactTier | null;
	rejectionReason: RejectionReason | null;
	verificationStatus: VerificationStatus;
	verifierExplanation: string | null;
}

/**
 * Represents an issue discovered by an agent during the hunt phase.
 * Findings are submitted with a file location, description, and optional code snippet.
 * They go through validation by the referee and can be disputed by other agents.
 */
export class Finding {
	public readonly id: number;
	public readonly gameId: string;
	public readonly roundNumber: number;
	public readonly agentId: string;
	public readonly description: string;
	public readonly filePath: string;
	public readonly lineStart: number;
	public readonly lineEnd: number;
	public readonly codeSnippet: string | null;
	public readonly patternHash: string;
	public readonly createdAt: Date;

	private _status: FindingStatus;
	private _duplicateOf: number | null;
	private _refereeVerdict: string | null;
	private _confidence: Confidence | null;
	private _pointsAwarded: number;
	private _validatedAt: Date | null;
	private _confidenceScore: number | null;
	private _issueType: IssueType | null;
	private _impactTier: ImpactTier | null;
	private _rejectionReason: RejectionReason | null;
	private _verificationStatus: VerificationStatus;
	private _verifierExplanation: string | null;

	constructor(init: FindingInit) {
		this.id = init.id;
		this.gameId = init.gameId;
		this.roundNumber = init.roundNumber;
		this.agentId = init.agentId;
		this.description = init.description;
		this.filePath = init.filePath;
		this.lineStart = init.lineStart;
		this.lineEnd = init.lineEnd;
		this.codeSnippet = init.codeSnippet;
		this.patternHash = init.patternHash;
		this.createdAt = init.createdAt;

		this._status = init.status;
		this._duplicateOf = init.duplicateOf;
		this._refereeVerdict = init.refereeVerdict;
		this._confidence = init.confidence;
		this._pointsAwarded = init.pointsAwarded;
		this._validatedAt = init.validatedAt;
		this._confidenceScore = init.confidenceScore;
		this._issueType = init.issueType;
		this._impactTier = init.impactTier;
		this._rejectionReason = init.rejectionReason;
		this._verificationStatus = init.verificationStatus;
		this._verifierExplanation = init.verifierExplanation;
	}

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

	get confidenceScore(): number | null {
		return this._confidenceScore;
	}

	get issueType(): IssueType | null {
		return this._issueType;
	}

	get impactTier(): ImpactTier | null {
		return this._impactTier;
	}

	get rejectionReason(): RejectionReason | null {
		return this._rejectionReason;
	}

	get verificationStatus(): VerificationStatus {
		return this._verificationStatus;
	}

	get verifierExplanation(): string | null {
		return this._verifierExplanation;
	}

	get needsVerification(): boolean {
		return this._verificationStatus === VerificationStatus.Pending;
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
		const bucketStart = Math.floor(lineStart / 10) * 10;
		const bucketEnd = Math.ceil(lineEnd / 10) * 10;
		const keyTerms = Finding.extractKeyTerms(description);
		const normalized = `${filePath}:${bucketStart}-${bucketEnd}:${keyTerms}`;
		return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
	}

	/**
	 * Extracts meaningful keywords from a description for duplicate matching.
	 * Removes stop words and returns sorted unique terms.
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
		if (this.filePath !== other.filePath) return 0;

		const overlapStart = Math.max(this.lineStart, other.lineStart);
		const overlapEnd = Math.min(this.lineEnd, other.lineEnd);
		const overlapLines = Math.max(0, overlapEnd - overlapStart + 1);
		const totalLines = Math.max(
			this.lineEnd - this.lineStart + 1,
			other.lineEnd - other.lineStart + 1,
			1, // Guard against zero when lineStart > lineEnd
		);
		const lineOverlap = overlapLines / totalLines;

		const thisTermsStr = Finding.extractKeyTerms(this.description);
		const otherTermsStr = Finding.extractKeyTerms(other.description);

		let descOverlap = 0;
		if (thisTermsStr === "" && otherTermsStr === "") {
			descOverlap = 1;
		} else if (thisTermsStr === "" || otherTermsStr === "") {
			descOverlap = 0;
		} else {
			const thisTerms = new Set(thisTermsStr.split(" "));
			const otherTerms = new Set(otherTermsStr.split(" "));
			const commonTerms = [...thisTerms].filter((t) =>
				otherTerms.has(t),
			).length;
			const totalTerms = Math.max(thisTerms.size, otherTerms.size);
			descOverlap = totalTerms > 0 ? commonTerms / totalTerms : 0;
		}

		return lineOverlap * 0.6 + descOverlap * 0.4;
	}

	/**
	 * Marks the finding as valid, awarding points to the submitting agent.
	 *
	 * @param verdict - Referee's explanation of the validation
	 * @param confidence - high/medium/low confidence level
	 * @param confidenceScore - 0-100 numerical confidence
	 * @param issueType - Category-specific issue type
	 * @param impactTier - Severity: critical, major, minor
	 * @param needsVerification - Whether to spawn a verification agent
	 * @returns Points awarded (positive, or 0 if pending verification)
	 * @throws Error if finding is not in pending status
	 */
	validate(
		verdict: string,
		confidence: Confidence,
		confidenceScore?: number,
		issueType?: IssueType,
		impactTier?: ImpactTier,
		needsVerification?: boolean,
	): number {
		if (this._status !== FindingStatus.Pending) {
			throw new Error(`Cannot validate finding with status: ${this._status}`);
		}
		this._status = FindingStatus.Valid;
		this._refereeVerdict = verdict;
		this._confidence = confidence;
		this._confidenceScore = confidenceScore ?? null;
		this._issueType = issueType ?? null;
		this._impactTier = impactTier ?? null;

		if (needsVerification) {
			this._verificationStatus = VerificationStatus.Pending;
			this._pointsAwarded = 0;
		} else {
			this._verificationStatus = VerificationStatus.None;
			this._pointsAwarded = SCORING.VALID_FINDING;
		}

		this._validatedAt = new Date();
		return this._pointsAwarded;
	}

	/**
	 * Records the verification result from a second-pass agent.
	 * If confirmed, awards points. If overridden to false, applies penalty.
	 *
	 * @returns Points to award (may be negative if overridden to false)
	 */
	applyVerification(
		confirmed: boolean,
		explanation: string,
		overriddenIssueType?: IssueType,
		rejectionReason?: RejectionReason,
	): number {
		if (this._verificationStatus !== VerificationStatus.Pending) {
			throw new Error(
				`Cannot verify finding with status: ${this._verificationStatus}`,
			);
		}

		this._verifierExplanation = explanation;

		if (confirmed) {
			this._verificationStatus = VerificationStatus.Confirmed;
			if (overriddenIssueType) {
				this._issueType = overriddenIssueType;
			}
			this._pointsAwarded = SCORING.VALID_FINDING;
			return this._pointsAwarded;
		}

		this._verificationStatus = VerificationStatus.Overridden;
		this._status = FindingStatus.FalseFlag;
		this._rejectionReason = rejectionReason ?? null;
		this._pointsAwarded = SCORING.FALSE_FLAG;
		return this._pointsAwarded;
	}

	/**
	 * Marks the finding as a false positive, penalizing the submitting agent.
	 *
	 * @param verdict - Referee's explanation of why this is invalid
	 * @param rejectionReason - Category of why this was rejected
	 * @returns Points awarded (negative)
	 * @throws Error if finding is not in pending status
	 */
	markFalseFlag(verdict: string, rejectionReason?: RejectionReason): number {
		if (this._status !== FindingStatus.Pending) {
			throw new Error(`Cannot mark false flag with status: ${this._status}`);
		}
		this._status = FindingStatus.FalseFlag;
		this._refereeVerdict = verdict;
		this._rejectionReason = rejectionReason ?? null;
		this._pointsAwarded = SCORING.FALSE_FLAG;
		this._validatedAt = new Date();
		return this._pointsAwarded;
	}

	/**
	 * Revokes a previously valid finding after a successful dispute.
	 *
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
		this._verificationStatus = VerificationStatus.None;
		return this._pointsAwarded;
	}

	/**
	 * Marks the finding as a duplicate of an earlier finding.
	 *
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
		return new Finding({
			id,
			gameId,
			roundNumber,
			agentId,
			description,
			filePath,
			lineStart,
			lineEnd,
			codeSnippet,
			patternHash: Finding.computePatternHash(
				filePath,
				lineStart,
				lineEnd,
				description,
			),
			status: FindingStatus.Pending,
			duplicateOf: null,
			refereeVerdict: null,
			confidence: null,
			pointsAwarded: 0,
			createdAt: new Date(),
			validatedAt: null,
			confidenceScore: null,
			issueType: null,
			impactTier: null,
			rejectionReason: null,
			verificationStatus: VerificationStatus.None,
			verifierExplanation: null,
		});
	}

	/**
	 * Reconstitutes a finding domain object from its database representation.
	 */
	static fromRow(row: FindingRow): Finding {
		return new Finding({
			id: row.id,
			gameId: row.game_id,
			roundNumber: row.round_number,
			agentId: row.agent_id,
			description: row.description,
			filePath: row.file_path,
			lineStart: row.line_start,
			lineEnd: row.line_end,
			codeSnippet: row.code_snippet,
			patternHash: row.pattern_hash,
			status: row.status as FindingStatus,
			duplicateOf: row.duplicate_of,
			refereeVerdict: row.referee_verdict,
			confidence: row.confidence,
			pointsAwarded: row.points_awarded,
			createdAt: new Date(row.created_at),
			validatedAt: row.validated_at ? new Date(row.validated_at) : null,
			confidenceScore: row.confidence_score,
			issueType: row.issue_type as IssueType | null,
			impactTier: row.impact_tier as ImpactTier | null,
			rejectionReason: row.rejection_reason as RejectionReason | null,
			verificationStatus:
				(row.verification_status as VerificationStatus) ||
				VerificationStatus.None,
			verifierExplanation: row.verifier_explanation,
		});
	}

	/**
	 * Serializes the finding to database row format for persistence.
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
			confidence_score: this._confidenceScore,
			issue_type: this._issueType,
			impact_tier: this._impactTier,
			rejection_reason: this._rejectionReason,
			verification_status: this._verificationStatus,
			verifier_explanation: this._verifierExplanation,
		};
	}
}
