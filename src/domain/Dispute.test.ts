import { describe, expect, it } from "vitest";
import { Dispute } from "./Dispute.js";
import { DisputeStatus, SCORING } from "./types.js";

function createDispute(status: DisputeStatus = DisputeStatus.Pending): Dispute {
	return new Dispute(
		1,
		"game-1",
		1,
		42, // findingId
		"disputer-agent",
		"This finding is not actually a bug because...",
		status,
		null,
		0,
		new Date(),
		null,
	);
}

describe("Dispute", () => {
	describe("resolveSuccessful", () => {
		it("transitions to Successful status with points", () => {
			const dispute = createDispute();
			const points = dispute.resolveSuccessful("Disputer was correct");

			expect(dispute.status).toBe(DisputeStatus.Successful);
			expect(dispute.isSuccessful).toBe(true);
			expect(dispute.refereeVerdict).toBe("Disputer was correct");
			expect(points).toBe(SCORING.DISPUTE_WON);
			expect(points).toBeGreaterThan(0);
		});

		it("sets resolvedAt timestamp", () => {
			const dispute = createDispute();
			const before = Date.now();
			dispute.resolveSuccessful("Correct");
			const after = Date.now();

			expect(dispute.resolvedAt).not.toBeNull();
			expect(dispute.resolvedAt?.getTime()).toBeGreaterThanOrEqual(before);
			expect(dispute.resolvedAt?.getTime()).toBeLessThanOrEqual(after);
		});

		it("throws when not pending", () => {
			const dispute = createDispute(DisputeStatus.Failed);
			expect(() => dispute.resolveSuccessful("test")).toThrow(
				"Cannot resolve dispute with status: failed",
			);
		});
	});

	describe("resolveFailed", () => {
		it("transitions to Failed status with penalty", () => {
			const dispute = createDispute();
			const points = dispute.resolveFailed("Original finding was correct");

			expect(dispute.status).toBe(DisputeStatus.Failed);
			expect(dispute.isFailed).toBe(true);
			expect(dispute.refereeVerdict).toBe("Original finding was correct");
			expect(points).toBe(SCORING.DISPUTE_LOST);
			expect(points).toBeLessThan(0);
		});

		it("sets resolvedAt timestamp", () => {
			const dispute = createDispute();
			const before = Date.now();
			dispute.resolveFailed("Failed");
			const after = Date.now();

			expect(dispute.resolvedAt).not.toBeNull();
			expect(dispute.resolvedAt?.getTime()).toBeGreaterThanOrEqual(before);
			expect(dispute.resolvedAt?.getTime()).toBeLessThanOrEqual(after);
		});

		it("throws when not pending", () => {
			const dispute = createDispute(DisputeStatus.Successful);
			expect(() => dispute.resolveFailed("test")).toThrow(
				"Cannot resolve dispute with status: successful",
			);
		});
	});

	describe("status helpers", () => {
		it("isPending returns true for pending disputes", () => {
			const dispute = createDispute(DisputeStatus.Pending);
			expect(dispute.isPending).toBe(true);
			expect(dispute.isSuccessful).toBe(false);
			expect(dispute.isFailed).toBe(false);
		});

		it("isSuccessful returns true after success resolution", () => {
			const dispute = createDispute();
			dispute.resolveSuccessful("Yes");
			expect(dispute.isPending).toBe(false);
			expect(dispute.isSuccessful).toBe(true);
			expect(dispute.isFailed).toBe(false);
		});

		it("isFailed returns true after failed resolution", () => {
			const dispute = createDispute();
			dispute.resolveFailed("No");
			expect(dispute.isPending).toBe(false);
			expect(dispute.isSuccessful).toBe(false);
			expect(dispute.isFailed).toBe(true);
		});
	});

	describe("create factory", () => {
		it("creates pending dispute", () => {
			const dispute = Dispute.create(
				1,
				"game-1",
				1,
				42,
				"agent-1",
				"Reason for dispute",
			);

			expect(dispute.id).toBe(1);
			expect(dispute.gameId).toBe("game-1");
			expect(dispute.findingId).toBe(42);
			expect(dispute.disputerId).toBe("agent-1");
			expect(dispute.reason).toBe("Reason for dispute");
			expect(dispute.status).toBe(DisputeStatus.Pending);
			expect(dispute.pointsAwarded).toBe(0);
			expect(dispute.resolvedAt).toBeNull();
		});
	});

	describe("fromRow/toRow serialization", () => {
		it("round-trips through database row format", () => {
			const original = createDispute();
			original.resolveSuccessful("Verdict");

			const row = original.toRow();
			const restored = Dispute.fromRow(row);

			expect(restored.id).toBe(original.id);
			expect(restored.gameId).toBe(original.gameId);
			expect(restored.findingId).toBe(original.findingId);
			expect(restored.status).toBe(DisputeStatus.Successful);
			expect(restored.refereeVerdict).toBe("Verdict");
			expect(restored.pointsAwarded).toBe(SCORING.DISPUTE_WON);
		});

		it("handles null resolvedAt", () => {
			const dispute = createDispute();
			const row = dispute.toRow();
			expect(row.resolved_at).toBeNull();

			const restored = Dispute.fromRow(row);
			expect(restored.resolvedAt).toBeNull();
		});
	});
});
