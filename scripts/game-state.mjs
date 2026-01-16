#!/usr/bin/env node

/**
 * Bug Hunt Game State CLI v3
 * Round-based: Hunt phase → Review phase → Score → Repeat until target
 *
 * Scoring:
 *   Valid unique bug: +1
 *   False positive: -2
 *   Duplicate: -3
 *   Successful dispute: +2
 *   Failed dispute: -1
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "../../../.data/bugs.db");
const schemaPath = resolve(__dirname, "schema.sql");

const POINTS = {
	VALID_BUG: 1,
	FALSE_POSITIVE: -2,
	DUPLICATE: -3,
	DISPUTE_WON: 2,
	DISPUTE_LOST: -1,
};

async function getDb() {
	const SQL = await initSqlJs();
	const dataDir = dirname(dbPath);
	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true });
	}

	let db;
	if (existsSync(dbPath)) {
		const buffer = readFileSync(dbPath);
		db = new SQL.Database(buffer);
	} else {
		db = new SQL.Database();
		const schema = readFileSync(schemaPath, "utf-8");
		db.run(schema);
		saveDb(db);
	}
	return db;
}

function saveDb(db) {
	const data = db.export();
	writeFileSync(dbPath, Buffer.from(data));
}

function rowsToObjects(result) {
	if (!result || result.length === 0) return [];
	const [first] = result;
	return first.values.map((row) => {
		const obj = {};
		first.columns.forEach((col, i) => (obj[col] = row[i]));
		return obj;
	});
}

function singleRow(result) {
	const rows = rowsToObjects(result);
	return rows[0] || null;
}

function generatePatternHash(category, description) {
	const terms = `${category}:${description.toLowerCase()}`
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 3)
		.sort()
		.join("|");
	return createHash("md5").update(terms).digest("hex").substring(0, 12);
}

function findDuplicate(db, gameId, patternHash, bugId) {
	if (!bugId) return null;
	const result = db.exec(
		`
        SELECT id, agent_id, description FROM bugs
        WHERE game_id = ? AND pattern_hash = ? AND id < ?
        ORDER BY created_at ASC LIMIT 1
    `,
		[gameId, patternHash, bugId],
	);
	return singleRow(result);
}

const commands = {
	// === GAME LIFECYCLE ===

	"create-game": async (
		projectUrl,
		numAgents,
		targetScore,
		huntDuration,
		reviewDuration,
		categoriesJson,
	) => {
		const db = await getDb();
		const id = randomUUID();
		db.run(
			`
            INSERT INTO games (id, project_url, num_agents, target_score, hunt_duration, review_duration, categories, phase)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'setup')
        `,
			[
				id,
				projectUrl,
				parseInt(numAgents, 10),
				parseInt(targetScore, 10),
				parseInt(huntDuration, 10),
				parseInt(reviewDuration, 10),
				categoriesJson,
			],
		);
		saveDb(db);
		return {
			id,
			projectUrl,
			numAgents: parseInt(numAgents, 10),
			targetScore: parseInt(targetScore, 10),
			WARNING:
				"Use orchestrator.mjs for game flow! Run: node orchestrator.mjs start-hunt " +
				id,
		};
	},

	"add-agent": async (gameId, agentId) => {
		const db = await getDb();
		db.run(`INSERT INTO agents (id, game_id) VALUES (?, ?)`, [agentId, gameId]);
		saveDb(db);
		return { agentId, gameId };
	},

	// === ROUND CONTROL ===

	"start-round": async (gameId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT * FROM games WHERE id = ?", [gameId]),
		);
		if (!game) return { error: "Game not found" };

		// ENFORCE: Can only start new round from setup (first) or review_scoring (after review scoring complete)
		if (game.phase !== "setup" && game.phase !== "review_scoring") {
			return {
				error: "Cannot start new round - current round not complete",
				currentPhase: game.phase,
				hint: "Complete: hunt → hunt_scoring → review → review_scoring → then start next round",
			};
		}

		const newRound = game.current_round + 1;
		const endsAt = new Date(
			Date.now() + game.hunt_duration * 1000,
		).toISOString();

		db.run(
			`UPDATE games SET current_round = ?, phase = 'hunt', phase_ends_at = ? WHERE id = ?`,
			[newRound, endsAt, gameId],
		);
		saveDb(db);

		return {
			gameId,
			round: newRound,
			phase: "hunt",
			endsAt,
			durationSeconds: game.hunt_duration,
		};
	},

	"finish-hunt": async (gameId, agentId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec(
				"SELECT phase, current_round, phase_ends_at FROM games WHERE id = ?",
				[gameId],
			),
		);
		if (!game) return { error: "Game not found" };
		if (game.phase !== "hunt")
			return { error: "Not in hunt phase", phase: game.phase };

		// Can only finish after phase time expires
		const now = new Date();
		const endsAt = game.phase_ends_at ? new Date(game.phase_ends_at) : null;
		if (endsAt && now < endsAt) {
			const remaining = Math.ceil((endsAt - now) / 1000);
			return {
				error: "Hunt phase not ended yet",
				remainingSeconds: remaining,
				canFinishAt: game.phase_ends_at,
			};
		}

		db.run(
			`UPDATE agents SET hunt_done_round = ? WHERE game_id = ? AND id = ?`,
			[game.current_round, gameId, agentId],
		);
		saveDb(db);

		return { agentId, round: game.current_round, huntComplete: true };
	},

	"check-hunt-complete": async (gameId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT current_round, phase_ends_at FROM games WHERE id = ?", [
				gameId,
			]),
		);
		if (!game) return { error: "Game not found" };

		const now = new Date();
		const endsAt = game.phase_ends_at ? new Date(game.phase_ends_at) : null;
		const timeExpired = endsAt ? now >= endsAt : true;
		const remainingSeconds = endsAt
			? Math.max(0, Math.ceil((endsAt - now) / 1000))
			: 0;

		const incomplete = rowsToObjects(
			db.exec(
				`
            SELECT id FROM agents WHERE game_id = ? AND status = 'active' AND hunt_done_round < ?
        `,
				[gameId, game.current_round],
			),
		);

		return {
			round: game.current_round,
			timeExpired,
			remainingSeconds,
			allAgentsFinished: incomplete.length === 0,
			readyForReview: timeExpired && incomplete.length === 0,
			pending: incomplete.map((a) => a.id),
		};
	},

	"start-hunt-scoring": async (gameId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT * FROM games WHERE id = ?", [gameId]),
		);
		if (!game) return { error: "Game not found" };
		if (game.phase !== "hunt")
			return { error: "Not in hunt phase", currentPhase: game.phase };

		// Check all agents finished hunt
		const incomplete = rowsToObjects(
			db.exec(
				`
            SELECT id FROM agents WHERE game_id = ? AND status = 'active' AND hunt_done_round < ?
        `,
				[gameId, game.current_round],
			),
		);
		if (incomplete.length > 0) {
			return {
				error: "Not all agents finished hunting",
				pending: incomplete.map((a) => a.id),
			};
		}

		db.run(
			`UPDATE games SET phase = 'hunt_scoring', phase_ends_at = NULL WHERE id = ?`,
			[gameId],
		);
		saveDb(db);

		return { gameId, round: game.current_round, phase: "hunt_scoring" };
	},

	"start-review": async (gameId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT * FROM games WHERE id = ?", [gameId]),
		);
		if (!game) return { error: "Game not found" };
		if (game.phase !== "hunt_scoring")
			return {
				error: "Not in hunt_scoring phase - must score hunt bugs first",
				currentPhase: game.phase,
			};

		const endsAt = new Date(
			Date.now() + game.review_duration * 1000,
		).toISOString();

		db.run(
			`UPDATE games SET phase = 'review', phase_ends_at = ? WHERE id = ?`,
			[endsAt, gameId],
		);
		saveDb(db);

		return {
			gameId,
			round: game.current_round,
			phase: "review",
			endsAt,
			durationSeconds: game.review_duration,
		};
	},

	"start-review-scoring": async (gameId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT * FROM games WHERE id = ?", [gameId]),
		);
		if (!game) return { error: "Game not found" };
		if (game.phase !== "review")
			return { error: "Not in review phase", currentPhase: game.phase };

		// Check all agents finished review
		const incomplete = rowsToObjects(
			db.exec(
				`
            SELECT id FROM agents WHERE game_id = ? AND status = 'active' AND review_done_round < ?
        `,
				[gameId, game.current_round],
			),
		);
		if (incomplete.length > 0) {
			return {
				error: "Not all agents finished reviewing",
				pending: incomplete.map((a) => a.id),
			};
		}

		db.run(
			`UPDATE games SET phase = 'review_scoring', phase_ends_at = NULL WHERE id = ?`,
			[gameId],
		);
		saveDb(db);

		return { gameId, round: game.current_round, phase: "review_scoring" };
	},

	"finish-review": async (gameId, agentId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec(
				"SELECT phase, current_round, phase_ends_at FROM games WHERE id = ?",
				[gameId],
			),
		);
		if (!game) return { error: "Game not found" };
		if (game.phase !== "review")
			return { error: "Not in review phase", phase: game.phase };

		// Can only finish after phase time expires
		const now = new Date();
		const endsAt = game.phase_ends_at ? new Date(game.phase_ends_at) : null;
		if (endsAt && now < endsAt) {
			const remaining = Math.ceil((endsAt - now) / 1000);
			return {
				error: "Review phase not ended yet",
				remainingSeconds: remaining,
				canFinishAt: game.phase_ends_at,
			};
		}

		db.run(
			`UPDATE agents SET review_done_round = ? WHERE game_id = ? AND id = ?`,
			[game.current_round, gameId, agentId],
		);
		saveDb(db);

		return { agentId, round: game.current_round, reviewComplete: true };
	},

	"check-review-complete": async (gameId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT current_round, phase_ends_at FROM games WHERE id = ?", [
				gameId,
			]),
		);
		if (!game) return { error: "Game not found" };

		const now = new Date();
		const endsAt = game.phase_ends_at ? new Date(game.phase_ends_at) : null;
		const timeExpired = endsAt ? now >= endsAt : true;
		const remainingSeconds = endsAt
			? Math.max(0, Math.ceil((endsAt - now) / 1000))
			: 0;

		const incomplete = rowsToObjects(
			db.exec(
				`
            SELECT id FROM agents WHERE game_id = ? AND status = 'active' AND review_done_round < ?
        `,
				[gameId, game.current_round],
			),
		);

		return {
			round: game.current_round,
			timeExpired,
			remainingSeconds,
			allAgentsFinished: incomplete.length === 0,
			readyForScoring: timeExpired && incomplete.length === 0,
			pending: incomplete.map((a) => a.id),
		};
	},

	// end-round removed - use start-hunt-scoring and start-review-scoring instead

	"check-phase": async (gameId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT * FROM games WHERE id = ?", [gameId]),
		);
		if (!game) return { error: "Game not found" };

		const now = new Date();
		const endsAt = game.phase_ends_at ? new Date(game.phase_ends_at) : null;
		const remaining = endsAt
			? Math.max(0, Math.floor((endsAt - now) / 1000))
			: 0;

		return {
			phase: game.phase,
			round: game.current_round,
			remainingSeconds: remaining,
			endsAt: game.phase_ends_at,
			expired: endsAt ? now >= endsAt : false,
		};
	},

	// === HUNT PHASE: BUG SUBMISSION ===

	"submit-bug": async (
		gameId,
		agentId,
		category,
		description,
		filePath,
		lineStart,
		lineEnd,
		codeSnippet = null,
	) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT phase, current_round FROM games WHERE id = ?", [gameId]),
		);

		if (!game) return { error: "Game not found", accepted: false };
		if (game.phase !== "hunt")
			return {
				error: "Can only submit bugs during HUNT phase",
				accepted: false,
			};

		const patternHash = generatePatternHash(category, description);

		db.run(
			`
            INSERT INTO bugs (game_id, round_number, agent_id, category, description, file_path, line_start, line_end, code_snippet, pattern_hash, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `,
			[
				gameId,
				game.current_round,
				agentId,
				category,
				description,
				filePath,
				parseInt(lineStart, 10),
				parseInt(lineEnd, 10),
				codeSnippet,
				patternHash,
			],
		);

		const bugId = singleRow(db.exec("SELECT last_insert_rowid() as id"))?.id;
		db.run(
			`UPDATE agents SET bugs_submitted = bugs_submitted + 1 WHERE game_id = ? AND id = ?`,
			[gameId, agentId],
		);
		saveDb(db);

		return { bugId, round: game.current_round, patternHash, accepted: true };
	},

	// === REVIEW PHASE: DISPUTE SUBMISSION ===

	"submit-dispute": async (gameId, bugId, disputerId, reason) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT phase, current_round FROM games WHERE id = ?", [gameId]),
		);

		if (!game) return { error: "Game not found", accepted: false };
		if (game.phase !== "review")
			return {
				error: "Can only submit disputes during REVIEW phase",
				accepted: false,
			};

		const bug = singleRow(
			db.exec("SELECT * FROM bugs WHERE id = ?", [parseInt(bugId, 10)]),
		);
		if (!bug) return { error: "Bug not found", accepted: false };
		if (bug.agent_id === disputerId)
			return { error: "Cannot dispute your own bug", accepted: false };

		const existing = singleRow(
			db.exec("SELECT id FROM disputes WHERE bug_id = ? AND disputer_id = ?", [
				parseInt(bugId, 10),
				disputerId,
			]),
		);
		if (existing)
			return { error: "Already disputed this bug", accepted: false };

		db.run(
			`
            INSERT INTO disputes (game_id, round_number, bug_id, disputer_id, reason, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `,
			[gameId, game.current_round, parseInt(bugId, 10), disputerId, reason],
		);
		saveDb(db);

		return {
			disputeId: singleRow(db.exec("SELECT last_insert_rowid() as id"))?.id,
			bugId: parseInt(bugId, 10),
			accepted: true,
		};
	},

	// === SCORING PHASE: VALIDATION ===

	"get-pending-bugs": async (gameId, round = null) => {
		const db = await getDb();
		let query = `SELECT * FROM bugs WHERE game_id = ? AND status = 'pending'`;
		const params = [gameId];
		if (round !== null) {
			query += ` AND round_number = ?`;
			params.push(parseInt(round, 10));
		}
		query += ` ORDER BY created_at ASC`;
		return rowsToObjects(db.exec(query, params));
	},

	"get-pending-disputes": async (gameId, round = null) => {
		const db = await getDb();
		let query = `
            SELECT d.*, b.description as bug_description, b.file_path, b.category, b.agent_id as bug_author
            FROM disputes d JOIN bugs b ON d.bug_id = b.id
            WHERE d.game_id = ? AND d.status = 'pending'
        `;
		const params = [gameId];
		if (round !== null) {
			query += ` AND d.round_number = ?`;
			params.push(parseInt(round, 10));
		}
		query += ` ORDER BY d.created_at ASC`;
		return rowsToObjects(db.exec(query, params));
	},

	"validate-bug": async (
		bugId,
		verdict,
		refereeVerdict = "",
		confidence = "medium",
	) => {
		const db = await getDb();
		const bug = singleRow(
			db.exec("SELECT * FROM bugs WHERE id = ?", [parseInt(bugId, 10)]),
		);
		if (!bug) return { error: "Bug not found" };
		if (bug.status !== "pending") return { error: "Bug already validated" };

		// ENFORCE: Can only validate during hunt_scoring phase
		const game = singleRow(
			db.exec("SELECT phase FROM games WHERE id = ?", [bug.game_id]),
		);
		if (game.phase !== "hunt_scoring") {
			return {
				error: "Can only validate bugs during HUNT_SCORING phase",
				currentPhase: game.phase,
				hint: "Flow: hunt → start-hunt-scoring → validate bugs → start-review",
			};
		}

		// Normalize confidence to valid values
		const validConfidence = ["high", "medium", "low"].includes(
			confidence?.toLowerCase(),
		)
			? confidence.toLowerCase()
			: "medium";

		const duplicate = findDuplicate(db, bug.game_id, bug.pattern_hash, bug.id);

		let status, points;
		if (duplicate) {
			status = "duplicate";
			points = POINTS.DUPLICATE;
			db.run(
				`UPDATE bugs SET status = 'duplicate', duplicate_of = ?, points_awarded = ?, validated_at = datetime('now') WHERE id = ?`,
				[duplicate.id, points, parseInt(bugId, 10)],
			);
			db.run(
				`UPDATE agents SET bugs_duplicate = bugs_duplicate + 1, score = score + ? WHERE game_id = ? AND id = ?`,
				[points, bug.game_id, bug.agent_id],
			);
		} else if (verdict.toUpperCase() === "VALID") {
			status = "valid";
			points = POINTS.VALID_BUG;
			db.run(
				`UPDATE bugs SET status = 'valid', referee_verdict = ?, confidence = ?, points_awarded = ?, validated_at = datetime('now') WHERE id = ?`,
				[refereeVerdict, validConfidence, points, parseInt(bugId, 10)],
			);
			db.run(
				`UPDATE agents SET bugs_valid = bugs_valid + 1, score = score + ? WHERE game_id = ? AND id = ?`,
				[points, bug.game_id, bug.agent_id],
			);
		} else {
			status = "false_flag";
			points = POINTS.FALSE_POSITIVE;
			db.run(
				`UPDATE bugs SET status = 'false_flag', referee_verdict = ?, points_awarded = ?, validated_at = datetime('now') WHERE id = ?`,
				[refereeVerdict, points, parseInt(bugId, 10)],
			);
			db.run(
				`UPDATE agents SET bugs_false = bugs_false + 1, score = score + ? WHERE game_id = ? AND id = ?`,
				[points, bug.game_id, bug.agent_id],
			);
		}

		saveDb(db);
		return {
			bugId: parseInt(bugId, 10),
			status,
			points,
			confidence: status === "valid" ? validConfidence : null,
			duplicateOf: duplicate?.id,
		};
	},

	"resolve-dispute": async (disputeId, verdict, refereeVerdict = "") => {
		const db = await getDb();
		const dispute = singleRow(
			db.exec("SELECT * FROM disputes WHERE id = ?", [parseInt(disputeId, 10)]),
		);
		if (!dispute) return { error: "Dispute not found" };
		if (dispute.status !== "pending")
			return { error: "Dispute already resolved" };

		// ENFORCE: Can only resolve during review_scoring phase
		const game = singleRow(
			db.exec("SELECT phase FROM games WHERE id = ?", [dispute.game_id]),
		);
		if (game.phase !== "review_scoring") {
			return {
				error: "Can only resolve disputes during REVIEW_SCORING phase",
				currentPhase: game.phase,
				hint: "Flow: review → start-review-scoring → resolve disputes → start-round",
			};
		}

		const successful =
			verdict.toUpperCase() === "SUCCESSFUL" ||
			verdict.toUpperCase() === "VALID";
		const status = successful ? "successful" : "failed";
		const points = successful ? POINTS.DISPUTE_WON : POINTS.DISPUTE_LOST;

		db.run(
			`UPDATE disputes SET status = ?, referee_verdict = ?, points_awarded = ?, resolved_at = datetime('now') WHERE id = ?`,
			[status, refereeVerdict, points, parseInt(disputeId, 10)],
		);

		const statField = successful ? "disputes_won" : "disputes_lost";
		db.run(
			`UPDATE agents SET ${statField} = ${statField} + 1, score = score + ? WHERE game_id = ? AND id = ?`,
			[points, dispute.game_id, dispute.disputer_id],
		);

		saveDb(db);
		return { disputeId: parseInt(disputeId, 10), status, points };
	},

	// === GAME COMPLETION ===

	"check-winner": async (gameId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT target_score FROM games WHERE id = ?", [gameId]),
		);
		if (!game) return { error: "Game not found" };

		const agents = rowsToObjects(
			db.exec(
				'SELECT * FROM agents WHERE game_id = ? AND status = "active" ORDER BY score DESC',
				[gameId],
			),
		);

		const atTarget = agents.filter((a) => a.score >= game.target_score);

		if (atTarget.length === 0) {
			return {
				winner: null,
				reason: "No agent reached target",
				continueGame: true,
			};
		}

		if (atTarget.length === 1) {
			return {
				winner: atTarget[0].id,
				score: atTarget[0].score,
				reason: "Reached target",
				continueGame: false,
			};
		}

		// Multiple reached target - highest wins
		const maxScore = Math.max(...atTarget.map((a) => a.score));
		const tied = atTarget.filter((a) => a.score === maxScore);

		if (tied.length === 1) {
			return {
				winner: tied[0].id,
				score: tied[0].score,
				reason: "Highest score above target",
				continueGame: false,
			};
		}

		// Still tied - continue with only tied agents
		return {
			winner: null,
			reason: `Tie at ${maxScore}`,
			tiedAgents: tied.map((a) => a.id),
			continueGame: true,
			tieBreaker: true,
		};
	},

	"complete-game": async (gameId, winnerId) => {
		const db = await getDb();
		db.run(
			`UPDATE games SET phase = 'complete', winner_agent_id = ?, completed_at = datetime('now') WHERE id = ?`,
			[winnerId, gameId],
		);
		db.run(`UPDATE agents SET status = 'winner' WHERE game_id = ? AND id = ?`, [
			gameId,
			winnerId,
		]);
		saveDb(db);

		const agents = rowsToObjects(
			db.exec("SELECT * FROM agents WHERE game_id = ? ORDER BY score DESC", [
				gameId,
			]),
		);
		return { gameId, winner: winnerId, finalScores: agents };
	},

	// === QUERIES ===

	scoreboard: async (gameId) => {
		const db = await getDb();
		return rowsToObjects(
			db.exec(
				`
            SELECT id, score, bugs_submitted, bugs_valid, bugs_false, bugs_duplicate, disputes_won, disputes_lost, status
            FROM agents WHERE game_id = ? ORDER BY score DESC
        `,
				[gameId],
			),
		);
	},

	bugs: async (gameId, agentId = null) => {
		const db = await getDb();
		const query = agentId
			? `SELECT * FROM bugs WHERE game_id = ? AND agent_id = ? ORDER BY created_at DESC`
			: `SELECT * FROM bugs WHERE game_id = ? ORDER BY created_at DESC`;
		const params = agentId ? [gameId, agentId] : [gameId];
		return rowsToObjects(db.exec(query, params));
	},

	"game-state": async (gameId) => {
		const db = await getDb();
		const game = singleRow(
			db.exec("SELECT * FROM games WHERE id = ?", [gameId]),
		);
		if (!game) return { error: "Game not found" };

		const agents = rowsToObjects(
			db.exec("SELECT * FROM agents WHERE game_id = ? ORDER BY score DESC", [
				gameId,
			]),
		);
		const bugs = rowsToObjects(
			db.exec("SELECT * FROM bugs WHERE game_id = ?", [gameId]),
		);
		const disputes = rowsToObjects(
			db.exec("SELECT * FROM disputes WHERE game_id = ?", [gameId]),
		);

		return { game, agents, bugs, disputes };
	},

	"active-game": async (projectUrl) => {
		const db = await getDb();
		const game = singleRow(
			db.exec(
				`
            SELECT * FROM games WHERE project_url = ? AND phase != 'complete' ORDER BY created_at DESC LIMIT 1
        `,
				[projectUrl],
			),
		);
		if (game) {
			return {
				...game,
				WARNING:
					"Use orchestrator.mjs for game flow! Run: node orchestrator.mjs status " +
					game.id,
			};
		}
		return {
			active: false,
			TIP: "To start a new game, run: node orchestrator.mjs setup <project_url>",
		};
	},

	heartbeat: async (gameId, agentId) => {
		const db = await getDb();
		db.run(
			`UPDATE agents SET last_heartbeat = datetime('now') WHERE game_id = ? AND id = ?`,
			[gameId, agentId],
		);
		saveDb(db);
		return { agentId, heartbeat: new Date().toISOString() };
	},

	"cleanup-game": async (gameId) => {
		const db = await getDb();
		db.run("DELETE FROM disputes WHERE game_id = ?", [gameId]);
		db.run("DELETE FROM bugs WHERE game_id = ?", [gameId]);
		db.run("DELETE FROM agents WHERE game_id = ?", [gameId]);
		db.run("DELETE FROM games WHERE id = ?", [gameId]);
		saveDb(db);
		return { cleaned: true, gameId };
	},
};

// CLI
const [, , command, ...args] = process.argv;

if (!command || command === "help") {
	console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  STOP! Use orchestrator.mjs instead of this file directly.       ║
║                                                                  ║
║  Run: node orchestrator.mjs help                                 ║
╚══════════════════════════════════════════════════════════════════╝

Phase flow: setup → hunt → hunt_scoring → review → review_scoring → (repeat)

AGENT COMMANDS:
  submit-bug, submit-dispute, finish-hunt, finish-review

PHASE TRANSITIONS (use orchestrator instead):
  start-round          setup|review_scoring → hunt
  start-hunt-scoring   hunt → hunt_scoring
  start-review         hunt_scoring → review
  start-review-scoring review → review_scoring
    `);
	process.exit(0);
}

if (commands[command]) {
	commands[command](...args)
		.then((r) => console.log(JSON.stringify(r, null, 2)))
		.catch((e) => {
			console.error(JSON.stringify({ error: e.message }));
			process.exit(1);
		});
} else {
	console.error(JSON.stringify({ error: `Unknown command: ${command}` }));
	process.exit(1);
}
