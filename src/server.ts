#!/usr/bin/env bun

/**
 * Bones API Server
 *
 * Provides REST and SSE endpoints for the dashboard to query game state.
 * Runs independently of the CLI, accessing the same SQLite database.
 * Default port: 8019 (configurable via BONES_PORT env var)
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Orchestrator } from "./services/Orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dataDir = process.env.BONES_DATA_DIR ?? join(homedir(), ".bones");
const dbPath = join(dataDir, "game.db");
const scriptsPath =
	process.env.BONES_SCRIPTS_PATH ?? join(__dirname, "..", "scripts");

const orchestrator = new Orchestrator(dbPath, scriptsPath);

const app = new Hono();

app.use("*", cors());

/** Lists all games with summary info (id, phase, winner, etc). */
app.get("/api/games", (c) => {
	const games = orchestrator.getAllGames();

	return c.json({
		games: games.map((g) => ({
			id: g.id,
			projectUrl: g.config.projectUrl,
			category: g.config.category,
			phase: g.phase,
			round: g.round,
			targetScore: g.config.targetScore,
			isComplete: g.isComplete,
			winner: g.winnerId,
			createdAt: g.createdAt.toISOString(),
			completedAt: g.completedAt?.toISOString() ?? null,
		})),
		timestamp: new Date().toISOString(),
	});
});

/** Returns detailed game state including scoreboard and statistics. */
app.get("/api/games/:id", (c) => {
	const gameId = c.req.param("id");

	const game = orchestrator.getGame(gameId);
	if (!game) {
		return c.json({ error: `Game not found: ${gameId}` }, 404);
	}

	const scoreboard = orchestrator.getScoreboard(gameId);
	const findings = orchestrator.getFindings(gameId);
	const disputes = orchestrator.getDisputes(gameId);

	const stats = {
		totalFindings: findings.length,
		validFindings: findings.filter((f) => f.status === "valid").length,
		pendingFindings: findings.filter((f) => f.status === "pending").length,
		totalDisputes: disputes.length,
		pendingDisputes: disputes.filter((d) => d.status === "pending").length,
	};

	return c.json({
		game: {
			id: game.id,
			phase: game.phase,
			round: game.round,
			targetScore: game.config.targetScore,
			huntDuration: game.config.huntDuration,
			reviewDuration: game.config.reviewDuration,
			phaseEndsAt: game.phaseEndsAt?.toISOString() ?? null,
			timeRemaining: game.timeRemaining,
			winner: game.winnerId,
			isComplete: game.isComplete,
			createdAt: game.createdAt.toISOString(),
			completedAt: game.completedAt?.toISOString() ?? null,
		},
		scoreboard,
		stats,
		timestamp: new Date().toISOString(),
	});
});

/** Returns all findings for a game with status and validation details. */
app.get("/api/games/:id/findings", (c) => {
	const gameId = c.req.param("id");

	const game = orchestrator.getGame(gameId);
	if (!game) {
		return c.json({ error: `Game not found: ${gameId}` }, 404);
	}

	const findings = orchestrator.getFindings(gameId);

	return c.json({
		findings: findings.map((f) => ({
			id: f.id,
			round: f.roundNumber,
			agentId: f.agentId,
			description: f.description,
			filePath: f.filePath,
			lineStart: f.lineStart,
			lineEnd: f.lineEnd,
			status: f.status,
			confidence: f.confidence ?? null,
			duplicateOf: f.duplicateOf ?? null,
			invalidReason: f.status === "false_flag" ? f.refereeVerdict : null,
			points: f.pointsAwarded,
			createdAt: f.createdAt.toISOString(),
		})),
		timestamp: new Date().toISOString(),
	});
});

/** Returns all disputes for a game with resolution status. */
app.get("/api/games/:id/disputes", (c) => {
	const gameId = c.req.param("id");

	const game = orchestrator.getGame(gameId);
	if (!game) {
		return c.json({ error: `Game not found: ${gameId}` }, 404);
	}

	const disputes = orchestrator.getDisputes(gameId);

	return c.json({
		disputes: disputes.map((d) => ({
			id: d.id,
			round: d.roundNumber,
			findingId: d.findingId,
			disputerId: d.disputerId,
			reason: d.reason,
			status: d.status,
			points: d.pointsAwarded,
			createdAt: d.createdAt.toISOString(),
		})),
		timestamp: new Date().toISOString(),
	});
});

/**
 * Server-Sent Events endpoint for real-time game updates.
 * Pushes game state every second. Dashboard uses this for live updates.
 */
app.get("/api/games/:id/events", async (c) => {
	const gameId = c.req.param("id");

	const game = orchestrator.getGame(gameId);
	if (!game) {
		return c.json({ error: `Game not found: ${gameId}` }, 404);
	}

	return c.newResponse(
		new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				let interval: ReturnType<typeof setInterval> | null = null;
				let closed = false;

				const sendEvent = (data: object) => {
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
					);
				};

				const sendState = () => {
					if (closed) return;

					const currentGame = orchestrator.getGame(gameId);
					if (!currentGame) {
						if (interval) {
							clearInterval(interval);
							interval = null;
						}
						closed = true;
						controller.close();
						return;
					}

					const scoreboard = orchestrator.getScoreboard(gameId);
					const findings = orchestrator.getFindings(gameId);
					const disputes = orchestrator.getDisputes(gameId);

					const stats = {
						totalFindings: findings.length,
						validFindings: findings.filter((f) => f.status === "valid").length,
						pendingFindings: findings.filter((f) => f.status === "pending")
							.length,
						totalDisputes: disputes.length,
						pendingDisputes: disputes.filter((d) => d.status === "pending")
							.length,
					};

					sendEvent({
						game: {
							id: currentGame.id,
							phase: currentGame.phase,
							round: currentGame.round,
							targetScore: currentGame.config.targetScore,
							huntDuration: currentGame.config.huntDuration,
							reviewDuration: currentGame.config.reviewDuration,
							phaseEndsAt: currentGame.phaseEndsAt?.toISOString() ?? null,
							timeRemaining: currentGame.timeRemaining,
							winner: currentGame.winnerId,
							isComplete: currentGame.isComplete,
							createdAt: currentGame.createdAt.toISOString(),
							completedAt: currentGame.completedAt?.toISOString() ?? null,
						},
						scoreboard,
						stats,
						timestamp: new Date().toISOString(),
					});
				};

				sendState();
				interval = setInterval(sendState, 1000);

				c.req.raw.signal.addEventListener("abort", () => {
					if (interval) {
						clearInterval(interval);
						interval = null;
					}
				});
			},
		}),
		{
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		},
	);
});

/** Simple health check for monitoring/load balancers. */
app.get("/health", (c) => c.json({ status: "ok" }));

const port = parseInt(process.env.BONES_PORT ?? "8019", 10);

console.log(`Bones API server starting on http://localhost:${port}`);
console.log(`  Database: ${dbPath}`);
console.log(`  Endpoints:`);
console.log(`    GET /api/games/:id          - Game state + scoreboard`);
console.log(`    GET /api/games/:id/findings - All findings`);
console.log(`    GET /api/games/:id/disputes - All disputes`);
console.log(`    GET /health                 - Health check`);

/** Closes database connection on process exit. */
process.on("beforeExit", () => {
	orchestrator.close();
});

/** Bun-native server — no @hono/node-server needed. */
export default {
	port,
	fetch: app.fetch,
};
