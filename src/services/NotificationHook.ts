/**
 * Notification hooks for game completion.
 * Supports shell commands (--on-complete) and built-in sinks (--notify).
 */

import { exec } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import type { Usage } from "@mariozechner/pi-ai";

const execAsync = promisify(exec);

/** Summary data passed to notification hooks. */
export interface GameSummary {
	readonly gameId: string;
	readonly winner: string;
	readonly reason: string;
	readonly findingsCount: number;
	readonly validFindings: number;
	readonly cost: string;
	readonly tokens: number;
	readonly projectUrl: string;
	readonly category: string;
	readonly rounds: number;
}

/** Notification configuration parsed from CLI flags. */
export interface NotifyConfig {
	/** Shell command to run on completion (--on-complete). */
	readonly onComplete?: string;
	/** Built-in notification sink (--notify stdout|file:<path>). */
	readonly notify?: string;
}

/**
 * Builds environment variables from game summary for shell hook execution.
 * Prefixed with BONES_ to avoid collisions.
 *
 * @param summary - Game completion summary
 * @returns Environment variables to inject
 */
function buildEnvVars(summary: GameSummary): Record<string, string> {
	return {
		BONES_GAME_ID: summary.gameId,
		BONES_WINNER: summary.winner,
		BONES_REASON: summary.reason,
		BONES_FINDINGS_COUNT: String(summary.findingsCount),
		BONES_VALID_FINDINGS: String(summary.validFindings),
		BONES_COST: summary.cost,
		BONES_TOKENS: String(summary.tokens),
		BONES_PROJECT: summary.projectUrl,
		BONES_CATEGORY: summary.category,
		BONES_ROUNDS: String(summary.rounds),
	};
}

/**
 * Formats a game summary as a human-readable string for stdout/file output.
 *
 * @param summary - Game completion summary
 * @returns Formatted summary text
 */
function formatSummary(summary: GameSummary): string {
	const lines = [
		`─── Bones Game Complete ───`,
		`Game:     ${summary.gameId}`,
		`Winner:   ${summary.winner}`,
		`Reason:   ${summary.reason}`,
		`Findings: ${summary.validFindings}/${summary.findingsCount} valid`,
		`Cost:     ${summary.cost}`,
		`Tokens:   ${summary.tokens.toLocaleString()}`,
		`Project:  ${summary.projectUrl}`,
		`Category: ${summary.category}`,
		`Rounds:   ${summary.rounds}`,
		`───────────────────────────`,
	];
	return lines.join("\n");
}

/**
 * Runs the --on-complete shell command with game summary as env vars.
 * Inherits the current process environment plus BONES_* variables.
 *
 * @param command - Shell command string
 * @param summary - Game completion summary
 * @throws Error if the command fails (non-zero exit)
 */
async function runShellHook(
	command: string,
	summary: GameSummary,
): Promise<void> {
	const env = { ...process.env, ...buildEnvVars(summary) };

	try {
		const { stdout, stderr } = await execAsync(command, {
			env,
			timeout: 30_000,
		});
		if (stdout.trim()) console.log(`[hook] ${stdout.trim()}`);
		if (stderr.trim()) console.error(`[hook] ${stderr.trim()}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[hook] on-complete command failed: ${message}`);
	}
}

/**
 * Dispatches the built-in --notify sink.
 * Supported formats:
 * - "stdout" — prints summary to stdout (default)
 * - "file:<path>" — appends summary to a file
 *
 * @param sink - Notification sink specification
 * @param summary - Game completion summary
 */
function runBuiltinNotify(sink: string, summary: GameSummary): void {
	if (sink === "stdout") {
		console.log(formatSummary(summary));
		return;
	}

	if (sink.startsWith("file:")) {
		const filePath = sink.slice(5);
		const timestamp = new Date().toISOString();
		const entry = `\n[${timestamp}]\n${formatSummary(summary)}\n`;
		try {
			appendFileSync(filePath, entry);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[notify] Failed to write to ${filePath}: ${message}`);
		}
		return;
	}

	console.error(
		`[notify] Unknown sink: ${sink}. Use "stdout" or "file:<path>".`,
	);
}

/**
 * Executes all configured notification hooks for a completed game.
 * Runs built-in notify first, then shell hook. Neither blocks the other.
 *
 * @param config - Notification configuration from CLI flags
 * @param summary - Game completion summary
 */
export async function runNotifications(
	config: NotifyConfig,
	summary: GameSummary,
): Promise<void> {
	// Built-in notification
	if (config.notify) {
		runBuiltinNotify(config.notify, summary);
	}

	// Shell hook
	if (config.onComplete) {
		await runShellHook(config.onComplete, summary);
	}
}

/**
 * Builds a GameSummary from game completion data.
 * Convenience factory for callers that have raw event/DB data.
 *
 * @param params - Raw game data
 * @returns Formatted GameSummary
 */
export function buildGameSummary(params: {
	readonly gameId: string;
	readonly winner: string;
	readonly reason: string;
	readonly findings: ReadonlyArray<{ readonly status: string }>;
	readonly totalCost: Usage;
	readonly projectUrl: string;
	readonly category: string;
	readonly rounds: number;
}): GameSummary {
	return {
		gameId: params.gameId,
		winner: params.winner,
		reason: params.reason,
		findingsCount: params.findings.length,
		validFindings: params.findings.filter((f) => f.status === "valid").length,
		cost: `$${params.totalCost.cost.total.toFixed(4)}`,
		tokens: params.totalCost.totalTokens,
		projectUrl: params.projectUrl,
		category: params.category,
		rounds: params.rounds,
	};
}
