import { describe, expect, it } from "vitest";
import { Finding } from "./Finding.js";
import { FindingStatus, SCORING, VerificationStatus } from "./types.js";

function createFinding(status: FindingStatus = FindingStatus.Pending): Finding {
	return new Finding(
		1,
		"game-1",
		1,
		"agent-1",
		"Null pointer dereference in handleRequest",
		"src/server.ts",
		42,
		45,
		"const x = obj.value; // obj can be null",
		Finding.computePatternHash(
			"src/server.ts",
			42,
			45,
			"Null pointer dereference in handleRequest",
		),
		status,
		null,
		null,
		null,
		0,
		new Date(),
		null,
		null, // confidenceScore
		null, // issueType
		null, // impactTier
		null, // rejectionReason
		VerificationStatus.None,
		null, // verifierExplanation
	);
}

describe("Finding", () => {
	describe("computePatternHash", () => {
		it("produces consistent hash for same inputs", () => {
			const hash1 = Finding.computePatternHash(
				"src/file.ts",
				10,
				20,
				"Bug description",
			);
			const hash2 = Finding.computePatternHash(
				"src/file.ts",
				10,
				20,
				"Bug description",
			);
			expect(hash1).toBe(hash2);
		});

		it("normalizes whitespace in description", () => {
			const hash1 = Finding.computePatternHash(
				"src/file.ts",
				10,
				20,
				"Bug   description",
			);
			const hash2 = Finding.computePatternHash(
				"src/file.ts",
				10,
				20,
				"Bug description",
			);
			expect(hash1).toBe(hash2);
		});

		it("normalizes case in description", () => {
			const hash1 = Finding.computePatternHash(
				"src/file.ts",
				10,
				20,
				"BUG DESCRIPTION",
			);
			const hash2 = Finding.computePatternHash(
				"src/file.ts",
				10,
				20,
				"bug description",
			);
			expect(hash1).toBe(hash2);
		});

		it("buckets nearby line ranges together", () => {
			// Lines 42-45 and 43-46 should bucket to same range (40-50)
			const hash1 = Finding.computePatternHash(
				"src/file.ts",
				42,
				45,
				"Null pointer bug",
			);
			const hash2 = Finding.computePatternHash(
				"src/file.ts",
				43,
				46,
				"Null pointer bug",
			);
			expect(hash1).toBe(hash2);
		});

		it("produces different hash for distant line ranges", () => {
			const hash1 = Finding.computePatternHash("src/file.ts", 10, 15, "Bug");
			const hash2 = Finding.computePatternHash("src/file.ts", 100, 105, "Bug");
			expect(hash1).not.toBe(hash2);
		});

		it("produces different hash for different files", () => {
			const hash1 = Finding.computePatternHash("src/a.ts", 10, 20, "Bug");
			const hash2 = Finding.computePatternHash("src/b.ts", 10, 20, "Bug");
			expect(hash1).not.toBe(hash2);
		});

		it("returns 16-character hex string", () => {
			const hash = Finding.computePatternHash("file.ts", 1, 2, "bug");
			expect(hash).toMatch(/^[a-f0-9]{16}$/);
		});

		it("extracts key terms and ignores stop words", () => {
			// Same key terms, different phrasing
			const hash1 = Finding.computePatternHash(
				"src/file.ts",
				10,
				15,
				"null pointer crash handler",
			);
			const hash2 = Finding.computePatternHash(
				"src/file.ts",
				10,
				15,
				"The handler has a null pointer crash",
			);
			expect(hash1).toBe(hash2);
		});
	});

	describe("overlapsWithLines", () => {
		it("returns true for overlapping ranges", () => {
			const finding = createFinding();
			// finding is lines 42-45
			expect(finding.overlapsWithLines(40, 43)).toBe(true);
			expect(finding.overlapsWithLines(44, 50)).toBe(true);
			expect(finding.overlapsWithLines(43, 44)).toBe(true);
		});

		it("returns false for non-overlapping ranges", () => {
			const finding = createFinding();
			// finding is lines 42-45
			expect(finding.overlapsWithLines(10, 20)).toBe(false);
			expect(finding.overlapsWithLines(50, 60)).toBe(false);
		});

		it("returns true for exact match", () => {
			const finding = createFinding();
			expect(finding.overlapsWithLines(42, 45)).toBe(true);
		});
	});

	describe("similarityScore", () => {
		it("returns 0 for different files", () => {
			const finding1 = createFinding();
			const finding2 = new Finding(
				2,
				"game-1",
				1,
				"agent-2",
				"Same description",
				"src/other.ts", // different file
				42,
				45,
				null,
				"hash",
				FindingStatus.Pending,
				null,
				null,
				null,
				0,
				new Date(),
				null,
				null, // confidenceScore
				null, // issueType
				null, // impactTier
				null, // rejectionReason
				VerificationStatus.None,
				null,
			);
			expect(finding1.similarityScore(finding2)).toBe(0);
		});

		it("returns high score for same file and overlapping lines", () => {
			const finding1 = createFinding();
			const finding2 = new Finding(
				2,
				"game-1",
				1,
				"agent-2",
				"Null pointer dereference in handleRequest function",
				"src/server.ts", // same file
				43,
				46, // overlapping lines
				null,
				"hash",
				FindingStatus.Pending,
				null,
				null,
				null,
				0,
				new Date(),
				null,
				null, // confidenceScore
				null, // issueType
				null, // impactTier
				null, // rejectionReason
				VerificationStatus.None,
				null,
			);
			const score = finding1.similarityScore(finding2);
			expect(score).toBeGreaterThan(0.5);
		});

		it("returns lower score for non-overlapping lines", () => {
			const finding1 = createFinding();
			const finding2 = new Finding(
				2,
				"game-1",
				1,
				"agent-2",
				"Different bug entirely",
				"src/server.ts",
				100,
				105, // non-overlapping
				null,
				"hash",
				FindingStatus.Pending,
				null,
				null,
				null,
				0,
				new Date(),
				null,
				null, // confidenceScore
				null, // issueType
				null, // impactTier
				null, // rejectionReason
				VerificationStatus.None,
				null,
			);
			const score = finding1.similarityScore(finding2);
			expect(score).toBeLessThan(0.5);
		});
	});

	describe("validate", () => {
		it("transitions to Valid status", () => {
			const finding = createFinding();
			const points = finding.validate("Confirmed null dereference", "high");

			expect(finding.status).toBe(FindingStatus.Valid);
			expect(finding.isValid).toBe(true);
			expect(finding.refereeVerdict).toBe("Confirmed null dereference");
			expect(finding.confidence).toBe("high");
			expect(points).toBe(SCORING.VALID_FINDING);
		});

		it("sets validatedAt timestamp", () => {
			const finding = createFinding();
			const before = Date.now();
			finding.validate("Valid", "medium");
			const after = Date.now();

			expect(finding.validatedAt).not.toBeNull();
			expect(finding.validatedAt?.getTime()).toBeGreaterThanOrEqual(before);
			expect(finding.validatedAt?.getTime()).toBeLessThanOrEqual(after);
		});

		it("throws when already validated", () => {
			const finding = createFinding(FindingStatus.Valid);
			expect(() => finding.validate("test", "high")).toThrow(
				"Cannot validate finding with status: valid",
			);
		});
	});

	describe("markFalseFlag", () => {
		it("transitions to FalseFlag status with penalty", () => {
			const finding = createFinding();
			const points = finding.markFalseFlag("Not a real bug");

			expect(finding.status).toBe(FindingStatus.FalseFlag);
			expect(finding.isFalseFlag).toBe(true);
			expect(finding.refereeVerdict).toBe("Not a real bug");
			expect(points).toBe(SCORING.FALSE_FLAG);
			expect(points).toBeLessThan(0);
		});

		it("throws when not pending", () => {
			const finding = createFinding(FindingStatus.Valid);
			expect(() => finding.markFalseFlag("test")).toThrow(
				"Cannot mark false flag with status: valid",
			);
		});
	});

	describe("markDuplicate", () => {
		it("transitions to Duplicate status with penalty", () => {
			const finding = createFinding();
			const points = finding.markDuplicate(99, "Same as finding #99");

			expect(finding.status).toBe(FindingStatus.Duplicate);
			expect(finding.isDuplicate).toBe(true);
			expect(finding.duplicateOf).toBe(99);
			expect(finding.refereeVerdict).toBe("Same as finding #99");
			expect(points).toBe(SCORING.DUPLICATE);
			expect(points).toBeLessThan(SCORING.FALSE_FLAG); // Duplicate is worse
		});

		it("throws when not pending", () => {
			const finding = createFinding(FindingStatus.Valid);
			expect(() => finding.markDuplicate(99, "test")).toThrow(
				"Cannot mark duplicate with status: valid",
			);
		});
	});

	describe("revokeValidation", () => {
		it("revokes valid finding after dispute", () => {
			const finding = createFinding(FindingStatus.Valid);
			// Manually set points to simulate validation
			(finding as unknown as { _pointsAwarded: number })._pointsAwarded =
				SCORING.VALID_FINDING;

			const points = finding.revokeValidation("Dispute upheld");

			expect(finding.status).toBe(FindingStatus.FalseFlag);
			expect(finding.refereeVerdict).toBe("Dispute upheld");
			expect(points).toBe(SCORING.FALSE_FLAG);
		});

		it("throws when not valid", () => {
			const finding = createFinding(FindingStatus.Pending);
			expect(() => finding.revokeValidation("test")).toThrow(
				"Cannot revoke validation with status: pending",
			);
		});
	});

	describe("create factory", () => {
		it("creates pending finding with computed hash", () => {
			const finding = Finding.create(
				1,
				"game-1",
				1,
				"agent-1",
				"Test bug",
				"file.ts",
				10,
				20,
				"code snippet",
			);

			expect(finding.id).toBe(1);
			expect(finding.status).toBe(FindingStatus.Pending);
			expect(finding.isPending).toBe(true);
			expect(finding.patternHash).toMatch(/^[a-f0-9]{16}$/);
			expect(finding.pointsAwarded).toBe(0);
		});
	});

	describe("fromRow/toRow serialization", () => {
		it("round-trips through database row format", () => {
			const original = createFinding();
			original.validate("Valid bug", "high");

			const row = original.toRow();
			const restored = Finding.fromRow(row);

			expect(restored.id).toBe(original.id);
			expect(restored.gameId).toBe(original.gameId);
			expect(restored.agentId).toBe(original.agentId);
			expect(restored.status).toBe(FindingStatus.Valid);
			expect(restored.confidence).toBe("high");
			expect(restored.pointsAwarded).toBe(SCORING.VALID_FINDING);
		});
	});
});
