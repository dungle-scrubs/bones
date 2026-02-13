import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FindingStatus, HuntCategory, Phase } from "../domain/types.js";
import { Orchestrator } from "./Orchestrator.js";

let orchestrator: Orchestrator;
let dbPath: string;

/**
 * Creates a temp DB and Orchestrator for each test.
 * scriptsPath is irrelevant — we never spawn agents in these tests.
 */
beforeEach(() => {
	dbPath = join(
		tmpdir(),
		`bones-integ-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
	);
	orchestrator = new Orchestrator(dbPath, "/dev/null");
});

afterEach(() => {
	orchestrator.close();
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(`${dbPath}${suffix}`);
		} catch {}
	}
});

/** Creates a game with 2 agents, transitions to hunt, and returns IDs. */
function setupHuntGame(category = HuntCategory.Bugs) {
	const result = orchestrator.setup({
		projectUrl: "/test/project",
		category,
		targetScore: 5,
		numAgents: 2,
		maxRounds: 3,
		huntDuration: 300,
		reviewDuration: 180,
	});
	const gameId = result.gameId;
	const [agent1, agent2] = result.agents;

	orchestrator.startHunt(gameId);

	return { gameId, agent1, agent2 };
}

/** Submits a finding and advances the game through hunt scoring. */
function submitAndValidate(
	gameId: string,
	agentId: string,
	verdict: "VALID" | "FALSE" | "DUPLICATE" = "VALID",
	opts: {
		filePath?: string;
		description?: string;
		duplicateOfId?: number;
	} = {},
) {
	const findingId = orchestrator.submitFinding(
		gameId,
		agentId,
		opts.filePath ?? "src/bug.ts",
		10,
		20,
		opts.description ?? "Found a bug",
	);
	// Transition: Hunt → HuntScoring
	const game = orchestrator.getGame(gameId)!;
	if (game.phase === Phase.Hunt) {
		orchestrator.startHuntScoring(gameId);
	}
	orchestrator.validateFinding(
		gameId,
		findingId,
		verdict,
		`Referee says: ${verdict}`,
		undefined,
		opts.duplicateOfId,
	);
	return findingId;
}

// =============================================================================
// Game Setup
// =============================================================================

describe("Game Setup", () => {
	it("creates a game with agents and correct config", () => {
		const result = orchestrator.setup({
			projectUrl: "/my/project",
			category: HuntCategory.Security,
			targetScore: 15,
			numAgents: 3,
		});

		expect(result.action).toBe("GAME_CREATED");
		expect(result.agents).toHaveLength(3);
		expect(result.config.category).toBe(HuntCategory.Security);
		expect(result.config.targetScore).toBe(15);

		const game = orchestrator.getGame(result.gameId)!;
		expect(game.phase).toBe(Phase.Setup);
		expect(game.round).toBe(0);
	});

	it("uses sensible defaults when no options given", () => {
		const result = orchestrator.setup({ projectUrl: "/test" });

		expect(result.config.category).toBe(HuntCategory.Bugs);
		expect(result.config.targetScore).toBe(10);
		expect(result.config.numAgents).toBe(3);
		expect(result.config.maxRounds).toBe(3);
		expect(result.config.huntDuration).toBe(300);
		expect(result.config.reviewDuration).toBe(180);
	});

	it("rejects starting hunt from wrong phase", () => {
		const { gameId } = setupHuntGame();
		// Already in Hunt — can't start hunt again
		expect(() => orchestrator.startHunt(gameId)).toThrow();
	});
});

// =============================================================================
// Finding Submission
// =============================================================================

describe("Finding Submission", () => {
	it("submits a finding during hunt phase", () => {
		const { gameId, agent1 } = setupHuntGame();

		const findingId = orchestrator.submitFinding(
			gameId,
			agent1,
			"src/server.ts",
			42,
			50,
			"Null pointer dereference",
			"const x = obj.y.z;",
		);

		expect(findingId).toBeGreaterThan(0);
		const findings = orchestrator.getFindings(gameId);
		expect(findings).toHaveLength(1);
		expect(findings[0].filePath).toBe("src/server.ts");
		expect(findings[0].description).toBe("Null pointer dereference");
	});

	it("rejects submissions outside hunt phase", () => {
		const result = orchestrator.setup({
			projectUrl: "/test",
			numAgents: 2,
		});
		// Still in Setup phase
		expect(() =>
			orchestrator.submitFinding(
				result.gameId,
				result.agents[0],
				"a.ts",
				1,
				5,
				"bug",
			),
		).toThrow("Cannot submit finding outside hunt phase");
	});

	it("rejects submissions from unknown agents", () => {
		const { gameId } = setupHuntGame();
		expect(() =>
			orchestrator.submitFinding(gameId, "fake-agent", "a.ts", 1, 5, "bug"),
		).toThrow("Agent not found");
	});

	it("rejects submissions after agent marked done", () => {
		const { gameId, agent1 } = setupHuntGame();
		orchestrator.markAgentDone(gameId, agent1, "hunt");

		expect(() =>
			orchestrator.submitFinding(gameId, agent1, "a.ts", 1, 5, "bug"),
		).toThrow("already finished hunt");
	});
});

// =============================================================================
// Finding Validation & Scoring
// =============================================================================

describe("Finding Validation", () => {
	it("awards +1 for valid finding", () => {
		const { gameId, agent1 } = setupHuntGame();
		submitAndValidate(gameId, agent1, "VALID");

		const scoreboard = orchestrator.getScoreboard(gameId);
		const agent = scoreboard.find((a) => a.id === agent1)!;
		expect(agent.score).toBe(1);
	});

	it("penalizes -2 for false flag", () => {
		const { gameId, agent1 } = setupHuntGame();
		submitAndValidate(gameId, agent1, "FALSE");

		const scoreboard = orchestrator.getScoreboard(gameId);
		const agent = scoreboard.find((a) => a.id === agent1)!;
		expect(agent.score).toBe(-2);
	});

	it("penalizes -3 for duplicate", () => {
		const { gameId, agent1 } = setupHuntGame();

		// Submit first finding — valid
		const f1 = orchestrator.submitFinding(
			gameId,
			agent1,
			"src/a.ts",
			10,
			20,
			"First finding",
		);
		orchestrator.startHuntScoring(gameId);
		orchestrator.validateFinding(gameId, f1, "VALID", "Good catch");

		// Submit second finding (same agent, different file) — marked duplicate
		// Need to go back to Hunt for another submission
		const { gameId: g2, agent1: a2 } = setupHuntGame();
		const f2 = orchestrator.submitFinding(g2, a2, "src/a.ts", 10, 20, "Dup");
		orchestrator.startHuntScoring(g2);
		orchestrator.validateFinding(
			g2,
			f2,
			"DUPLICATE",
			"Same issue",
			undefined,
			f1,
		);

		const scoreboard = orchestrator.getScoreboard(g2);
		const agent = scoreboard.find((a) => a.id === a2)!;
		expect(agent.score).toBe(-3);
	});

	it("tracks agent stats through validation", () => {
		const { gameId, agent1, agent2 } = setupHuntGame();

		// agent1 submits 2 findings
		orchestrator.submitFinding(gameId, agent1, "a.ts", 1, 5, "Bug A");
		orchestrator.submitFinding(gameId, agent1, "b.ts", 1, 5, "Bug B");
		// agent2 submits 1 finding
		orchestrator.submitFinding(gameId, agent2, "c.ts", 1, 5, "Bug C");

		orchestrator.startHuntScoring(gameId);

		const findings = orchestrator.getFindings(gameId);
		// Validate: A=VALID, B=FALSE, C=VALID
		for (const f of findings) {
			const verdict =
				f.description === "Bug B" ? ("FALSE" as const) : ("VALID" as const);
			orchestrator.validateFinding(gameId, f.id, verdict, "Referee decision");
		}

		const scoreboard = orchestrator.getScoreboard(gameId);
		const a1 = scoreboard.find((a) => a.id === agent1)!;
		const a2 = scoreboard.find((a) => a.id === agent2)!;

		// agent1: +1 (valid) + -2 (false) = -1
		expect(a1.score).toBe(-1);
		// agent2: +1 (valid) = 1
		expect(a2.score).toBe(1);
	});
});

// =============================================================================
// Dispute Flow
// =============================================================================

describe("Dispute Flow", () => {
	/** Sets up a game with a valid finding ready for dispute. */
	function setupForDispute() {
		const { gameId, agent1, agent2 } = setupHuntGame();
		const findingId = orchestrator.submitFinding(
			gameId,
			agent1,
			"src/bug.ts",
			10,
			20,
			"Found a real bug",
		);
		orchestrator.startHuntScoring(gameId);
		orchestrator.validateFinding(gameId, findingId, "VALID", "Confirmed");
		orchestrator.startReview(gameId);
		return { gameId, agent1, agent2, findingId };
	}

	it("allows disputing another agent's valid finding", () => {
		const { gameId, agent2, findingId } = setupForDispute();

		const disputeId = orchestrator.submitDispute(
			gameId,
			agent2,
			findingId,
			"This code is actually unreachable",
		);

		expect(disputeId).toBeGreaterThan(0);
		const disputes = orchestrator.getDisputes(gameId);
		expect(disputes).toHaveLength(1);
		expect(disputes[0].reason).toBe("This code is actually unreachable");
	});

	it("rejects disputing own finding", () => {
		const { gameId, agent1, findingId } = setupForDispute();
		expect(() =>
			orchestrator.submitDispute(gameId, agent1, findingId, "Self-dispute"),
		).toThrow("Cannot dispute your own finding");
	});

	it("rejects duplicate disputes", () => {
		const { gameId, agent2, findingId } = setupForDispute();
		orchestrator.submitDispute(gameId, agent2, findingId, "First dispute");
		expect(() =>
			orchestrator.submitDispute(gameId, agent2, findingId, "Second"),
		).toThrow("Already disputed");
	});

	it("rejects disputes outside review phase", () => {
		const { gameId, agent1, agent2 } = setupHuntGame();
		const fid = orchestrator.submitFinding(gameId, agent1, "a.ts", 1, 5, "Bug");
		orchestrator.startHuntScoring(gameId);
		orchestrator.validateFinding(gameId, fid, "VALID", "Yes");
		// Still in HuntScoring — haven't started review
		expect(() =>
			orchestrator.submitDispute(gameId, agent2, fid, "Nope"),
		).toThrow("Cannot submit dispute outside review phase");
	});
});

// =============================================================================
// Dispute Resolution & Scoring
// =============================================================================

describe("Dispute Resolution", () => {
	function setupResolvedDispute(disputeVerdict: "SUCCESSFUL" | "FAILED") {
		const { gameId, agent1, agent2 } = setupHuntGame();
		const findingId = orchestrator.submitFinding(
			gameId,
			agent1,
			"src/bug.ts",
			10,
			20,
			"Found a bug",
		);
		orchestrator.startHuntScoring(gameId);
		orchestrator.validateFinding(gameId, findingId, "VALID", "Confirmed");

		// agent1 score is now +1
		orchestrator.startReview(gameId);
		const disputeId = orchestrator.submitDispute(
			gameId,
			agent2,
			findingId,
			"Not actually a bug",
		);
		orchestrator.startReviewScoring(gameId);
		orchestrator.resolveDispute(
			gameId,
			disputeId,
			disputeVerdict,
			"Referee says",
		);

		return { gameId, agent1, agent2, findingId, disputeId };
	}

	it("successful dispute: disputer +2, finder revoked to -2", () => {
		const { gameId, agent1, agent2 } = setupResolvedDispute("SUCCESSFUL");
		const scoreboard = orchestrator.getScoreboard(gameId);

		const finder = scoreboard.find((a) => a.id === agent1)!;
		const disputer = scoreboard.find((a) => a.id === agent2)!;

		// Finder: +1 (valid) then revoked → -2 (false flag). Net: -2
		expect(finder.score).toBe(-2);
		// Disputer: +2 (successful dispute)
		expect(disputer.score).toBe(2);
	});

	it("failed dispute: disputer -1, finder keeps +1", () => {
		const { gameId, agent1, agent2 } = setupResolvedDispute("FAILED");
		const scoreboard = orchestrator.getScoreboard(gameId);

		const finder = scoreboard.find((a) => a.id === agent1)!;
		const disputer = scoreboard.find((a) => a.id === agent2)!;

		// Finder keeps their +1
		expect(finder.score).toBe(1);
		// Disputer penalized -1
		expect(disputer.score).toBe(-1);
	});

	it("revoked finding status changes to FalseFlag", () => {
		const { gameId, findingId } = setupResolvedDispute("SUCCESSFUL");
		const findings = orchestrator.getFindings(gameId);
		const finding = findings.find((f) => f.id === findingId)!;
		expect(finding.status).toBe(FindingStatus.FalseFlag);
	});
});

// =============================================================================
// Full Game Lifecycle
// =============================================================================

describe("Full Game Lifecycle", () => {
	it("runs a complete round: setup → hunt → score → review → resolve → winner check", () => {
		const { gameId, agent1, agent2 } = setupHuntGame();

		// === Hunt Phase ===
		// agent1 submits 3 good findings
		orchestrator.submitFinding(gameId, agent1, "a.ts", 1, 5, "Bug 1");
		orchestrator.submitFinding(gameId, agent1, "b.ts", 1, 5, "Bug 2");
		orchestrator.submitFinding(gameId, agent1, "c.ts", 1, 5, "Bug 3");
		// agent2 submits 2: one good, one false
		orchestrator.submitFinding(gameId, agent2, "d.ts", 1, 5, "Bug 4");
		orchestrator.submitFinding(gameId, agent2, "e.ts", 1, 5, "Not a bug");

		// === Hunt Scoring ===
		orchestrator.startHuntScoring(gameId);
		const findings = orchestrator.getFindings(gameId);
		for (const f of findings) {
			const verdict =
				f.description === "Not a bug" ? ("FALSE" as const) : ("VALID" as const);
			orchestrator.validateFinding(gameId, f.id, verdict, "Decision");
		}

		// agent1: 3 valid = 3 points
		// agent2: 1 valid + 1 false = 1 + (-2) = -1
		let scoreboard = orchestrator.getScoreboard(gameId);
		expect(scoreboard.find((a) => a.id === agent1)!.score).toBe(3);
		expect(scoreboard.find((a) => a.id === agent2)!.score).toBe(-1);

		// === Review Phase ===
		orchestrator.startReview(gameId);
		const game = orchestrator.getGame(gameId)!;
		expect(game.phase).toBe(Phase.Review);

		// agent2 disputes one of agent1's findings
		const validFindings = findings.filter(
			(f) => f.agentId === agent1 && f.description === "Bug 1",
		);
		const disputeId = orchestrator.submitDispute(
			gameId,
			agent2,
			validFindings[0].id,
			"This is actually correct behavior",
		);

		// === Review Scoring ===
		orchestrator.startReviewScoring(gameId);
		orchestrator.resolveDispute(
			gameId,
			disputeId,
			"SUCCESSFUL",
			"Disputer proved it",
		);

		// agent1: 3 - 1 (revoked) - 2 (false flag penalty) = 0... wait:
		// agent1 had +3 from 3 valid findings
		// One gets revoked: the +1 swings to -2, net change is -3
		// New score: 3 + (-3) = 0
		// agent2: -1 + 2 (dispute won) = 1
		scoreboard = orchestrator.getScoreboard(gameId);
		expect(scoreboard.find((a) => a.id === agent1)!.score).toBe(0);
		expect(scoreboard.find((a) => a.id === agent2)!.score).toBe(1);

		// === Winner Check ===
		const winnerCheck = orchestrator.checkWinner(gameId);
		// Target is 5, nobody there yet
		expect(winnerCheck.action).toBe("CONTINUE");
	});

	it("detects a winner when target score is reached", () => {
		// Set target to 2 for a quick win
		const result = orchestrator.setup({
			projectUrl: "/test",
			targetScore: 2,
			numAgents: 2,
		});
		const gameId = result.gameId;
		const [agent1, agent2] = result.agents;

		orchestrator.startHunt(gameId);
		orchestrator.submitFinding(gameId, agent1, "a.ts", 1, 5, "Bug A");
		orchestrator.submitFinding(gameId, agent1, "b.ts", 1, 5, "Bug B");

		orchestrator.startHuntScoring(gameId);
		const findings = orchestrator.getFindings(gameId);
		for (const f of findings) {
			orchestrator.validateFinding(gameId, f.id, "VALID", "Good");
		}

		// agent1 has 2 points = target
		orchestrator.startReview(gameId);
		orchestrator.startReviewScoring(gameId);
		const winnerCheck = orchestrator.checkWinner(gameId);
		expect(winnerCheck.action).toBe("GAME_COMPLETE");
	});
});

// =============================================================================
// Phase Transition Guards
// =============================================================================

describe("Phase Transition Guards", () => {
	it("enforces Setup → Hunt → HuntScoring → Review → ReviewScoring", () => {
		const result = orchestrator.setup({ projectUrl: "/test", numAgents: 2 });
		const gameId = result.gameId;
		const [a1] = result.agents;

		// Can't skip to review from setup
		expect(() => orchestrator.startReview(gameId)).toThrow();
		// Can't score hunt before hunt starts
		expect(() => orchestrator.startHuntScoring(gameId)).toThrow();

		orchestrator.startHunt(gameId);
		// Can't start review from hunt (must score first)
		expect(() => orchestrator.startReview(gameId)).toThrow();

		orchestrator.submitFinding(gameId, a1, "a.ts", 1, 5, "Bug");
		orchestrator.startHuntScoring(gameId);

		// Can't start review scoring before review
		expect(() => orchestrator.startReviewScoring(gameId)).toThrow();

		// Validate the finding so we can proceed
		const findings = orchestrator.getFindings(gameId);
		orchestrator.validateFinding(gameId, findings[0].id, "VALID", "Ok");

		orchestrator.startReview(gameId);
		// Can't start hunt scoring during review
		expect(() => orchestrator.startHuntScoring(gameId)).toThrow();

		orchestrator.startReviewScoring(gameId);
	});

	it("rejects marking agent done in wrong phase", () => {
		const result = orchestrator.setup({ projectUrl: "/test", numAgents: 1 });
		const gameId = result.gameId;
		const [a1] = result.agents;

		// Can't mark hunt done before hunt starts
		expect(() => orchestrator.markAgentDone(gameId, a1, "hunt")).toThrow();

		orchestrator.startHunt(gameId);
		// Can't mark review done during hunt
		expect(() => orchestrator.markAgentDone(gameId, a1, "review")).toThrow();
	});
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
	it("handles game not found", () => {
		expect(() => orchestrator.startHunt("nonexistent")).toThrow(
			"Game not found",
		);
	});

	it("handles finding not found during validation", () => {
		const { gameId } = setupHuntGame();
		orchestrator.startHuntScoring(gameId);
		expect(() =>
			orchestrator.validateFinding(gameId, 99999, "VALID", "Ghost"),
		).toThrow("Finding not found");
	});

	it("handles dispute not found during resolution", () => {
		const { gameId } = setupHuntGame();
		expect(() =>
			orchestrator.resolveDispute(gameId, 99999, "SUCCESSFUL", "Ghost"),
		).toThrow("Dispute not found");
	});

	it("multiple agents submit to same game without interference", () => {
		const { gameId, agent1, agent2 } = setupHuntGame();

		orchestrator.submitFinding(gameId, agent1, "a.ts", 1, 5, "Agent1 Bug");
		orchestrator.submitFinding(gameId, agent2, "b.ts", 1, 5, "Agent2 Bug");
		orchestrator.submitFinding(gameId, agent1, "c.ts", 1, 5, "Agent1 Bug 2");

		const findings = orchestrator.getFindings(gameId);
		expect(findings).toHaveLength(3);

		const a1Findings = findings.filter((f) => f.agentId === agent1);
		const a2Findings = findings.filter((f) => f.agentId === agent2);
		expect(a1Findings).toHaveLength(2);
		expect(a2Findings).toHaveLength(1);
	});
});
