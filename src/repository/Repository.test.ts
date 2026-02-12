import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FindingStatus,
	HuntCategory,
	Phase,
	RejectionReason,
} from "../domain/types.js";
import { AgentRepository } from "./AgentRepository.js";
import { Database } from "./Database.js";
import { DisputeRepository } from "./DisputeRepository.js";
import { FindingRepository } from "./FindingRepository.js";
import { GameRepository } from "./GameRepository.js";

let db: Database;
let gameRepo: GameRepository;
let agentRepo: AgentRepository;
let findingRepo: FindingRepository;
let disputeRepo: DisputeRepository;
let dbPath: string;

beforeEach(() => {
	dbPath = join(
		tmpdir(),
		`bones-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
	);
	db = new Database(dbPath);
	gameRepo = new GameRepository(db);
	agentRepo = new AgentRepository(db);
	findingRepo = new FindingRepository(db);
	disputeRepo = new DisputeRepository(db);
});

afterEach(() => {
	db.close();
	try {
		unlinkSync(dbPath);
	} catch {}
	try {
		unlinkSync(`${dbPath}-wal`);
	} catch {}
	try {
		unlinkSync(`${dbPath}-shm`);
	} catch {}
});

describe("Database", () => {
	it("creates tables on initialization", () => {
		const tables = db.connection
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
			)
			.all() as Array<{ name: string }>;
		const names = tables.map((t) => t.name);
		expect(names).toContain("games");
		expect(names).toContain("agents");
		expect(names).toContain("findings");
		expect(names).toContain("disputes");
	});

	it("enables WAL mode", () => {
		const result = db.connection.prepare("PRAGMA journal_mode").get() as {
			journal_mode: string;
		};
		expect(result.journal_mode).toBe("wal");
	});

	it("enables foreign keys", () => {
		const result = db.connection.prepare("PRAGMA foreign_keys").get() as {
			foreign_keys: number;
		};
		expect(result.foreign_keys).toBe(1);
	});

	it("wraps transactions with rollback on error", () => {
		const game = gameRepo.create({
			projectUrl: "/test",
			category: HuntCategory.Bugs,
			userPrompt: null,
			targetScore: 10,
			huntDuration: 300,
			reviewDuration: 180,
			numAgents: 2,
			maxRounds: 3,
		});

		expect(() => {
			db.transaction(() => {
				agentRepo.create("test-agent", game.id);
				throw new Error("intentional failure");
			});
		}).toThrow("intentional failure");

		// Agent should not exist after rollback
		expect(agentRepo.findById("test-agent")).toBeNull();
	});
});

describe("GameRepository", () => {
	const config = {
		projectUrl: "/test/project",
		category: HuntCategory.Bugs,
		userPrompt: "focus on auth",
		targetScore: 10,
		huntDuration: 300,
		reviewDuration: 180,
		numAgents: 3,
		maxRounds: 3,
	};

	it("creates and retrieves a game", () => {
		const game = gameRepo.create(config);
		expect(game.id).toContain("project");
		expect(game.phase).toBe(Phase.Setup);
		expect(game.round).toBe(0);

		const retrieved = gameRepo.findById(game.id);
		expect(retrieved).not.toBeNull();
		expect(retrieved!.id).toBe(game.id);
		expect(retrieved!.config.targetScore).toBe(10);
		expect(retrieved!.config.userPrompt).toBe("focus on auth");
	});

	it("updates game phase and round", () => {
		const game = gameRepo.create(config);
		game.startHuntPhase();
		gameRepo.update(game);

		const retrieved = gameRepo.findById(game.id)!;
		expect(retrieved.phase).toBe(Phase.Hunt);
		expect(retrieved.round).toBe(1);
		expect(retrieved.phaseEndsAt).not.toBeNull();
	});

	it("finds most recent game", () => {
		const first = gameRepo.create(config);
		const second = gameRepo.create({ ...config, projectUrl: "/test/second" });

		const recent = gameRepo.findMostRecent();
		expect(recent).not.toBeNull();
		// Both created same millisecond — just verify one of them is returned
		expect([first.id, second.id]).toContain(recent!.id);
	});

	it("finds active game by project", () => {
		const game = gameRepo.create(config);
		const active = gameRepo.findActiveByProject("/test/project");
		expect(active).not.toBeNull();
		expect(active!.id).toBe(game.id);
	});

	it("lists all games", () => {
		gameRepo.create(config);
		gameRepo.create({ ...config, projectUrl: "/test/other" });

		const all = gameRepo.findAll();
		expect(all.length).toBe(2);
	});

	it("deletes a game", () => {
		const game = gameRepo.create(config);
		gameRepo.delete(game.id);
		expect(gameRepo.findById(game.id)).toBeNull();
	});
});

describe("AgentRepository", () => {
	let gameId: string;

	beforeEach(() => {
		const game = gameRepo.create({
			projectUrl: "/test",
			category: HuntCategory.Bugs,
			userPrompt: null,
			targetScore: 10,
			huntDuration: 300,
			reviewDuration: 180,
			numAgents: 3,
			maxRounds: 3,
		});
		gameId = game.id;
	});

	it("creates multiple agents with names", () => {
		const agents = agentRepo.createMany(gameId, 3);
		expect(agents).toHaveLength(3);

		// Each has a unique ID prefixed with gameId
		const ids = agents.map((a) => a.id);
		expect(new Set(ids).size).toBe(3);
		for (const id of ids) {
			expect(id).toContain(gameId);
		}
	});

	it("retrieves agent by ID", () => {
		const agents = agentRepo.createMany(gameId, 2);
		const retrieved = agentRepo.findById(agents[0].id);
		expect(retrieved).not.toBeNull();
		expect(retrieved!.id).toBe(agents[0].id);
		expect(retrieved!.gameId).toBe(gameId);
	});

	it("updates agent score and stats", () => {
		const agents = agentRepo.createMany(gameId, 1);
		const agent = agents[0];

		agent.awardPoints(5);
		agent.recordValidFinding();
		agent.recordValidFinding();
		agent.recordFalseFinding();
		agentRepo.update(agent);

		const retrieved = agentRepo.findById(agent.id)!;
		expect(retrieved.score).toBe(5);
		expect(retrieved.stats.findingsValid).toBe(2);
		expect(retrieved.stats.findingsFalse).toBe(1);
	});

	it("generates scoreboard ordered by score", () => {
		const agents = agentRepo.createMany(gameId, 3);

		agents[0].awardPoints(3);
		agents[1].awardPoints(7);
		agents[2].awardPoints(1);
		for (const a of agents) agentRepo.update(a);

		const scoreboard = agentRepo.getScoreboard(gameId);
		expect(scoreboard[0].score).toBe(7);
		expect(scoreboard[1].score).toBe(3);
		expect(scoreboard[2].score).toBe(1);
	});

	it("finds pending hunt agents", () => {
		const agents = agentRepo.createMany(gameId, 3);
		agents[0].finishHunt(1);
		agentRepo.update(agents[0]);

		const pending = agentRepo.getPendingHuntAgents(gameId, 1);
		expect(pending).toHaveLength(2);
	});

	it("finds active agents only", () => {
		const agents = agentRepo.createMany(gameId, 3);
		agents[0].eliminate();
		agentRepo.update(agents[0]);

		const active = agentRepo.findActiveByGameId(gameId);
		expect(active).toHaveLength(2);
	});

	it("cascade-deletes agents when game is deleted", () => {
		const agents = agentRepo.createMany(gameId, 3);
		gameRepo.delete(gameId);

		expect(agentRepo.findById(agents[0].id)).toBeNull();
		expect(agentRepo.findByGameId(gameId)).toHaveLength(0);
	});
});

describe("FindingRepository", () => {
	let gameId: string;
	let agentId: string;

	beforeEach(() => {
		const game = gameRepo.create({
			projectUrl: "/test",
			category: HuntCategory.Bugs,
			userPrompt: null,
			targetScore: 10,
			huntDuration: 300,
			reviewDuration: 180,
			numAgents: 2,
			maxRounds: 3,
		});
		gameId = game.id;
		const agents = agentRepo.createMany(gameId, 2);
		agentId = agents[0].id;
	});

	it("creates a finding and returns correct ID", () => {
		const finding = findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "Null pointer",
			filePath: "src/server.ts",
			lineStart: 10,
			lineEnd: 15,
		});
		expect(finding.id).toBeGreaterThan(0);
		expect(finding.filePath).toBe("src/server.ts");
		expect(finding.status).toBe(FindingStatus.Pending);
	});

	it("increments agent findingsSubmitted on create", () => {
		findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "Bug 1",
			filePath: "a.ts",
			lineStart: 1,
			lineEnd: 5,
		});
		findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "Bug 2",
			filePath: "b.ts",
			lineStart: 1,
			lineEnd: 5,
		});

		const agent = agentRepo.findById(agentId)!;
		expect(agent.stats.findingsSubmitted).toBe(2);
	});

	it("retrieves finding by ID with all fields", () => {
		const created = findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "Desc",
			filePath: "f.ts",
			lineStart: 1,
			lineEnd: 10,
			codeSnippet: "const x = 1;",
		});

		const retrieved = findingRepo.findById(created.id)!;
		expect(retrieved.description).toBe("Desc");
		expect(retrieved.codeSnippet).toBe("const x = 1;");
		expect(retrieved.patternHash).toMatch(/^[a-f0-9]{16}$/);
	});

	it("finds pending findings by round", () => {
		findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "R1",
			filePath: "a.ts",
			lineStart: 1,
			lineEnd: 5,
		});
		findingRepo.create({
			gameId,
			roundNumber: 2,
			agentId,
			description: "R2",
			filePath: "b.ts",
			lineStart: 1,
			lineEnd: 5,
		});

		const round1 = findingRepo.findPendingByRound(gameId, 1);
		expect(round1).toHaveLength(1);
		expect(round1[0].description).toBe("R1");
	});

	it("finds valid findings only", () => {
		const f1 = findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "Valid",
			filePath: "a.ts",
			lineStart: 1,
			lineEnd: 5,
		});
		findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "Pending",
			filePath: "b.ts",
			lineStart: 1,
			lineEnd: 5,
		});

		// Manually validate f1
		const finding = findingRepo.findById(f1.id)!;
		finding.validate("Confirmed", "high");
		findingRepo.update(finding);

		const valid = findingRepo.findValidByGameId(gameId);
		expect(valid).toHaveLength(1);
		expect(valid[0].description).toBe("Valid");
	});

	it("updates finding status after validation", () => {
		const created = findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "Bug",
			filePath: "a.ts",
			lineStart: 1,
			lineEnd: 5,
		});

		const finding = findingRepo.findById(created.id)!;
		finding.markFalseFlag("Not a real bug", RejectionReason.Speculative);
		findingRepo.update(finding);

		const retrieved = findingRepo.findById(created.id)!;
		expect(retrieved.status).toBe(FindingStatus.FalseFlag);
		expect(retrieved.refereeVerdict).toBe("Not a real bug");
		expect(retrieved.rejectionReason).toBe(RejectionReason.Speculative);
	});

	it("finds by pattern hash for duplicate detection", () => {
		const f1 = findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "Null pointer in handler",
			filePath: "src/server.ts",
			lineStart: 42,
			lineEnd: 45,
		});
		const finding = findingRepo.findById(f1.id)!;
		finding.validate("Valid", "high");
		findingRepo.update(finding);

		const dup = findingRepo.findByPatternHash(gameId, f1.patternHash, true);
		expect(dup).not.toBeNull();
		expect(dup!.id).toBe(f1.id);
	});

	it("counts findings correctly", () => {
		findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "A",
			filePath: "a.ts",
			lineStart: 1,
			lineEnd: 5,
		});
		findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId,
			description: "B",
			filePath: "b.ts",
			lineStart: 1,
			lineEnd: 5,
		});

		expect(findingRepo.countByGameId(gameId)).toBe(2);
		expect(findingRepo.countPendingByGameId(gameId)).toBe(2);
		expect(findingRepo.countByRound(gameId, 1)).toBe(2);
		expect(findingRepo.countByRound(gameId, 2)).toBe(0);
	});
});

describe("DisputeRepository", () => {
	let gameId: string;
	let agentIds: string[];
	let findingId: number;

	beforeEach(() => {
		const game = gameRepo.create({
			projectUrl: "/test",
			category: HuntCategory.Bugs,
			userPrompt: null,
			targetScore: 10,
			huntDuration: 300,
			reviewDuration: 180,
			numAgents: 2,
			maxRounds: 3,
		});
		gameId = game.id;
		const agents = agentRepo.createMany(gameId, 2);
		agentIds = agents.map((a) => a.id);

		const finding = findingRepo.create({
			gameId,
			roundNumber: 1,
			agentId: agentIds[0],
			description: "Bug",
			filePath: "a.ts",
			lineStart: 1,
			lineEnd: 5,
		});
		findingId = finding.id;
	});

	it("creates a dispute and returns correct ID", () => {
		const dispute = disputeRepo.create({
			gameId,
			roundNumber: 1,
			findingId,
			disputerId: agentIds[1],
			reason: "Not a bug",
		});
		expect(dispute.id).toBeGreaterThan(0);
		expect(dispute.findingId).toBe(findingId);
		expect(dispute.disputerId).toBe(agentIds[1]);
	});

	it("retrieves dispute by ID", () => {
		const created = disputeRepo.create({
			gameId,
			roundNumber: 1,
			findingId,
			disputerId: agentIds[1],
			reason: "Wrong",
		});
		const retrieved = disputeRepo.findById(created.id)!;
		expect(retrieved.reason).toBe("Wrong");
		expect(retrieved.isPending).toBe(true);
	});

	it("finds pending disputes by round", () => {
		disputeRepo.create({
			gameId,
			roundNumber: 1,
			findingId,
			disputerId: agentIds[1],
			reason: "R1",
		});

		const pending = disputeRepo.findPendingByRound(gameId, 1);
		expect(pending).toHaveLength(1);
		expect(disputeRepo.findPendingByRound(gameId, 2)).toHaveLength(0);
	});

	it("detects duplicate disputes from same agent", () => {
		disputeRepo.create({
			gameId,
			roundNumber: 1,
			findingId,
			disputerId: agentIds[1],
			reason: "First",
		});

		expect(disputeRepo.hasAgentDisputed(findingId, agentIds[1])).toBe(true);
		expect(disputeRepo.hasAgentDisputed(findingId, agentIds[0])).toBe(false);
	});

	it("updates dispute after resolution", () => {
		const created = disputeRepo.create({
			gameId,
			roundNumber: 1,
			findingId,
			disputerId: agentIds[1],
			reason: "Wrong",
		});

		const dispute = disputeRepo.findById(created.id)!;
		dispute.resolveSuccessful("Disputer was right");
		disputeRepo.update(dispute);

		const retrieved = disputeRepo.findById(created.id)!;
		expect(retrieved.isSuccessful).toBe(true);
		expect(retrieved.refereeVerdict).toBe("Disputer was right");
		expect(retrieved.resolvedAt).not.toBeNull();
	});

	it("counts pending disputes", () => {
		disputeRepo.create({
			gameId,
			roundNumber: 1,
			findingId,
			disputerId: agentIds[1],
			reason: "A",
		});
		expect(disputeRepo.countPendingByGameId(gameId)).toBe(1);
	});
});

describe("Cross-repository integration", () => {
	it("full game lifecycle: create → agents → findings → validation → disputes", () => {
		// Setup
		const game = gameRepo.create({
			projectUrl: "/test/lifecycle",
			category: HuntCategory.Bugs,
			userPrompt: null,
			targetScore: 5,
			huntDuration: 300,
			reviewDuration: 180,
			numAgents: 2,
			maxRounds: 3,
		});
		const agents = agentRepo.createMany(game.id, 2);
		const [hunter, reviewer] = agents;

		// Hunt phase
		game.startHuntPhase();
		gameRepo.update(game);
		expect(game.phase).toBe(Phase.Hunt);

		const f1 = findingRepo.create({
			gameId: game.id,
			roundNumber: 1,
			agentId: hunter.id,
			description: "Null pointer",
			filePath: "src/a.ts",
			lineStart: 10,
			lineEnd: 15,
		});

		// Validate finding
		const finding = findingRepo.findById(f1.id)!;
		finding.validate("Confirmed", "high");
		hunter.awardPoints(finding.pointsAwarded);
		hunter.recordValidFinding();
		findingRepo.update(finding);
		agentRepo.update(hunter);

		const updatedHunter = agentRepo.findById(hunter.id)!;
		expect(updatedHunter.score).toBe(1);
		expect(updatedHunter.stats.findingsValid).toBe(1);

		// Review phase — dispute the finding
		const dispute = disputeRepo.create({
			gameId: game.id,
			roundNumber: 1,
			findingId: f1.id,
			disputerId: reviewer.id,
			reason: "Code is actually unreachable",
		});

		dispute.resolveSuccessful("Disputer proved unreachability");
		reviewer.awardPoints(dispute.pointsAwarded);
		reviewer.recordDisputeWon();
		disputeRepo.update(dispute);
		agentRepo.update(reviewer);

		const updatedReviewer = agentRepo.findById(reviewer.id)!;
		expect(updatedReviewer.score).toBe(2);
		expect(updatedReviewer.stats.disputesWon).toBe(1);

		// Scoreboard reflects final state
		const scoreboard = agentRepo.getScoreboard(game.id);
		expect(scoreboard[0].id).toBe(reviewer.id);
		expect(scoreboard[0].score).toBe(2);
	});

	it("cascade delete removes all related entities", () => {
		const game = gameRepo.create({
			projectUrl: "/test/cascade",
			category: HuntCategory.Bugs,
			userPrompt: null,
			targetScore: 10,
			huntDuration: 300,
			reviewDuration: 180,
			numAgents: 2,
			maxRounds: 3,
		});
		const agents = agentRepo.createMany(game.id, 2);
		const finding = findingRepo.create({
			gameId: game.id,
			roundNumber: 1,
			agentId: agents[0].id,
			description: "Bug",
			filePath: "a.ts",
			lineStart: 1,
			lineEnd: 5,
		});
		disputeRepo.create({
			gameId: game.id,
			roundNumber: 1,
			findingId: finding.id,
			disputerId: agents[1].id,
			reason: "Not a bug",
		});

		gameRepo.delete(game.id);

		expect(agentRepo.findByGameId(game.id)).toHaveLength(0);
		expect(findingRepo.findByGameId(game.id)).toHaveLength(0);
		expect(disputeRepo.findByGameId(game.id)).toHaveLength(0);
	});

	it("transactions are atomic across repositories", () => {
		const game = gameRepo.create({
			projectUrl: "/test/txn",
			category: HuntCategory.Bugs,
			userPrompt: null,
			targetScore: 10,
			huntDuration: 300,
			reviewDuration: 180,
			numAgents: 1,
			maxRounds: 3,
		});
		const agents = agentRepo.createMany(game.id, 1);

		const f = findingRepo.create({
			gameId: game.id,
			roundNumber: 1,
			agentId: agents[0].id,
			description: "Test",
			filePath: "a.ts",
			lineStart: 1,
			lineEnd: 5,
		});

		// Validate + award points atomically
		db.transaction(() => {
			const finding = findingRepo.findById(f.id)!;
			finding.validate("Valid", "high");
			findingRepo.update(finding);

			const agent = agentRepo.findById(agents[0].id)!;
			agent.awardPoints(1);
			agent.recordValidFinding();
			agentRepo.update(agent);
		});

		const finding = findingRepo.findById(f.id)!;
		expect(finding.isValid).toBe(true);

		const agent = agentRepo.findById(agents[0].id)!;
		expect(agent.score).toBe(1);
		expect(agent.stats.findingsValid).toBe(1);
	});
});
