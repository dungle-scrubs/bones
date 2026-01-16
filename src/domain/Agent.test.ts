import { describe, expect, it } from "vitest";
import { Agent } from "./Agent.js";
import { AgentStatus } from "./types.js";

function createAgent(status: AgentStatus = AgentStatus.Active): Agent {
	return new Agent(
		"agent-1",
		"game-1",
		0,
		{
			findingsSubmitted: 0,
			findingsValid: 0,
			findingsFalse: 0,
			findingsDuplicate: 0,
			disputesWon: 0,
			disputesLost: 0,
		},
		0,
		0,
		status,
		null,
		new Date(),
	);
}

describe("Agent", () => {
	describe("scoring", () => {
		it("starts with zero score", () => {
			const agent = createAgent();
			expect(agent.score).toBe(0);
		});

		it("awards positive points", () => {
			const agent = createAgent();
			agent.awardPoints(5);
			expect(agent.score).toBe(5);
		});

		it("awards negative points", () => {
			const agent = createAgent();
			agent.awardPoints(-2);
			expect(agent.score).toBe(-2);
		});

		it("accumulates points", () => {
			const agent = createAgent();
			agent.awardPoints(3);
			agent.awardPoints(2);
			agent.awardPoints(-1);
			expect(agent.score).toBe(4);
		});
	});

	describe("stats tracking", () => {
		it("records valid findings", () => {
			const agent = createAgent();
			agent.recordValidFinding();
			agent.recordValidFinding();
			expect(agent.stats.findingsValid).toBe(2);
		});

		it("records false findings", () => {
			const agent = createAgent();
			agent.recordFalseFinding();
			expect(agent.stats.findingsFalse).toBe(1);
		});

		it("records duplicate findings", () => {
			const agent = createAgent();
			agent.recordDuplicateFinding();
			expect(agent.stats.findingsDuplicate).toBe(1);
		});

		it("records disputes won", () => {
			const agent = createAgent();
			agent.recordDisputeWon();
			agent.recordDisputeWon();
			expect(agent.stats.disputesWon).toBe(2);
		});

		it("records disputes lost", () => {
			const agent = createAgent();
			agent.recordDisputeLost();
			expect(agent.stats.disputesLost).toBe(1);
		});

		it("returns defensive copy of stats", () => {
			const agent = createAgent();
			const stats = agent.stats;
			stats.findingsValid = 999;
			expect(agent.stats.findingsValid).toBe(0);
		});
	});

	describe("revertValidToFalse", () => {
		it("decrements valid and increments false", () => {
			const agent = createAgent();
			agent.recordValidFinding();
			agent.recordValidFinding();
			expect(agent.stats.findingsValid).toBe(2);
			expect(agent.stats.findingsFalse).toBe(0);

			agent.revertValidToFalse();
			expect(agent.stats.findingsValid).toBe(1);
			expect(agent.stats.findingsFalse).toBe(1);
		});

		it("throws when no valid findings to revert", () => {
			const agent = createAgent();
			expect(() => agent.revertValidToFalse()).toThrow(
				"Cannot revert: findingsValid is already 0",
			);
		});
	});

	describe("phase tracking", () => {
		it("tracks hunt completion by round", () => {
			const agent = createAgent();
			expect(agent.hasFinishedHunt(1)).toBe(false);

			agent.finishHunt(1);
			expect(agent.hasFinishedHunt(1)).toBe(true);
			expect(agent.hasFinishedHunt(2)).toBe(false);
		});

		it("tracks review completion by round", () => {
			const agent = createAgent();
			expect(agent.hasFinishedReview(1)).toBe(false);

			agent.finishReview(1);
			expect(agent.hasFinishedReview(1)).toBe(true);
			expect(agent.hasFinishedReview(2)).toBe(false);
		});
	});

	describe("status", () => {
		it("starts as Active", () => {
			const agent = Agent.create("id", "game");
			expect(agent.status).toBe(AgentStatus.Active);
			expect(agent.isActive).toBe(true);
			expect(agent.isEliminated).toBe(false);
		});

		it("can be eliminated", () => {
			const agent = createAgent();
			agent.eliminate();
			expect(agent.status).toBe(AgentStatus.Eliminated);
			expect(agent.isEliminated).toBe(true);
			expect(agent.isActive).toBe(false);
		});

		it("can be declared winner", () => {
			const agent = createAgent();
			agent.declareWinner();
			expect(agent.status).toBe(AgentStatus.Winner);
		});
	});

	describe("heartbeat", () => {
		it("updates lastHeartbeat timestamp", () => {
			const agent = createAgent();
			expect(agent.lastHeartbeat).toBeNull();

			const before = Date.now();
			agent.heartbeat();
			const after = Date.now();

			expect(agent.lastHeartbeat).not.toBeNull();
			expect(agent.lastHeartbeat?.getTime()).toBeGreaterThanOrEqual(before);
			expect(agent.lastHeartbeat?.getTime()).toBeLessThanOrEqual(after);
		});
	});

	describe("create factory", () => {
		it("creates agent with default values", () => {
			const agent = Agent.create("agent-id", "game-id");

			expect(agent.id).toBe("agent-id");
			expect(agent.gameId).toBe("game-id");
			expect(agent.score).toBe(0);
			expect(agent.status).toBe(AgentStatus.Active);
			expect(agent.huntDoneRound).toBe(0);
			expect(agent.reviewDoneRound).toBe(0);
			expect(agent.stats.findingsSubmitted).toBe(0);
		});
	});

	describe("fromRow/toRow serialization", () => {
		it("round-trips through database row format", () => {
			const original = createAgent();
			original.awardPoints(5);
			original.recordValidFinding();
			original.recordDisputeWon();
			original.finishHunt(1);

			const row = original.toRow();
			const restored = Agent.fromRow(row);

			expect(restored.id).toBe(original.id);
			expect(restored.score).toBe(5);
			expect(restored.stats.findingsValid).toBe(1);
			expect(restored.stats.disputesWon).toBe(1);
			expect(restored.huntDoneRound).toBe(1);
		});
	});
});
