import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding } from "../domain/Finding.js";
import type { Game } from "../domain/Game.js";
import type { ScoreboardEntry } from "../domain/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, "..", "..", "logs");

/** Data needed to export a completed game's results. */
export interface ExportData {
	game: Game;
	findings: Finding[];
	scoreboard: ScoreboardEntry[];
	/** Total game duration in seconds. */
	totalDuration: number;
}

/**
 * Exports game results to various file formats.
 * Creates a game-specific directory under logs/ with markdown and JSON reports.
 */
export class Exporter {
	/** Creates directory if it doesn't exist. */
	private ensureDir(dir: string): void {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}

	/**
	 * Exports game results to the logs directory.
	 * Creates findings.md (human-readable), game.json (summary), and full-report.json (complete).
	 * @returns Path to the created game directory
	 */
	export(data: ExportData): string {
		const gameDir = join(LOGS_DIR, data.game.id);
		this.ensureDir(gameDir);

		// Write findings.md (CC-friendly format)
		const findingsMd = this.renderFindingsMarkdown(data);
		writeFileSync(join(gameDir, "findings.md"), findingsMd);

		// Write game.json (config + scores)
		const gameJson = this.renderGameJson(data);
		writeFileSync(
			join(gameDir, "game.json"),
			JSON.stringify(gameJson, null, 2),
		);

		// Write full-report.json (everything)
		const fullReport = this.renderFullReport(data);
		writeFileSync(
			join(gameDir, "full-report.json"),
			JSON.stringify(fullReport, null, 2),
		);

		return gameDir;
	}

	/** Formats seconds into human-readable duration string. */
	private formatDuration(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;
		if (hours > 0) {
			return `${hours}h ${mins}m ${secs}s`;
		}
		return `${mins}m ${secs}s`;
	}

	/**
	 * Generates findings.md with game summary and validated findings.
	 * Findings are grouped by confidence level (high/medium/low).
	 */
	private renderFindingsMarkdown(data: ExportData): string {
		const { game, findings, scoreboard } = data;
		const validFindings = findings.filter((f) => f.isValid);
		const lines: string[] = [];

		// Header
		lines.push(`# Code Hunt Results: ${game.id}`);
		lines.push("");
		lines.push(`**Project:** ${game.config.projectUrl}`);
		lines.push(`**Category:** ${game.category}`);
		lines.push(`**Rounds:** ${game.round}`);
		lines.push(`**Duration:** ${this.formatDuration(data.totalDuration)}`);
		lines.push(`**Winner:** ${game.winnerId ?? "N/A"}`);
		lines.push("");

		// Summary
		lines.push("## Summary");
		lines.push("");
		lines.push(`- Total findings submitted: ${findings.length}`);
		lines.push(`- Valid findings: ${validFindings.length}`);
		lines.push(
			`- False positives: ${findings.filter((f) => f.isFalseFlag).length}`,
		);
		lines.push(`- Duplicates: ${findings.filter((f) => f.isDuplicate).length}`);
		lines.push("");

		// Scoreboard
		lines.push("## Final Scores");
		lines.push("");
		lines.push("| Rank | Agent | Score | Valid | False | Dup |");
		lines.push("|------|-------|-------|-------|-------|-----|");
		scoreboard.forEach((entry, i) => {
			lines.push(
				`| ${i + 1} | ${entry.id.split("-").pop()} | ${entry.score} | ${entry.findingsValid} | ${entry.findingsFalse} | ${entry.findingsDuplicate} |`,
			);
		});
		lines.push("");

		// Validated findings
		if (validFindings.length > 0) {
			lines.push("## Validated Findings");
			lines.push("");
			lines.push("These issues were confirmed by the referee. Fix them.");
			lines.push("");

			// Group by confidence
			const highConf = validFindings.filter((f) => f.confidence === "high");
			const medConf = validFindings.filter((f) => f.confidence === "medium");
			const lowConf = validFindings.filter(
				(f) => f.confidence === "low" || !f.confidence,
			);

			const renderFinding = (f: Finding, idx: number) => {
				lines.push(`### ${idx}. ${f.filePath}:${f.lineStart}-${f.lineEnd}`);
				lines.push("");
				lines.push(`**Confidence:** ${f.confidence ?? "unrated"}`);
				lines.push("");
				lines.push(f.description);
				lines.push("");
				if (f.refereeVerdict) {
					lines.push(`> Referee: ${f.refereeVerdict}`);
					lines.push("");
				}
			};

			let idx = 1;
			if (highConf.length > 0) {
				lines.push("### High Confidence");
				lines.push("");
				for (const f of highConf) {
					renderFinding(f, idx++);
				}
			}
			if (medConf.length > 0) {
				lines.push("### Medium Confidence");
				lines.push("");
				for (const f of medConf) {
					renderFinding(f, idx++);
				}
			}
			if (lowConf.length > 0) {
				lines.push("### Low Confidence");
				lines.push("");
				for (const f of lowConf) {
					renderFinding(f, idx++);
				}
			}
		} else {
			lines.push("## No Validated Findings");
			lines.push("");
			lines.push("No bugs were confirmed in this hunt.");
		}

		return lines.join("\n");
	}

	/** Generates game.json with config, scores, and outcome summary. */
	private renderGameJson(data: ExportData): object {
		const { game, scoreboard } = data;
		return {
			id: game.id,
			projectUrl: game.config.projectUrl,
			category: game.category,
			userPrompt: game.config.userPrompt,
			rounds: game.round,
			targetScore: game.config.targetScore,
			duration: data.totalDuration,
			winner: game.winnerId,
			createdAt: game.createdAt.toISOString(),
			completedAt: game.completedAt?.toISOString() ?? null,
			scoreboard,
		};
	}

	/** Generates full-report.json with complete game state and all findings. */
	private renderFullReport(data: ExportData): object {
		const { game, findings, scoreboard } = data;
		return {
			game: {
				id: game.id,
				config: game.config,
				phase: game.phase,
				round: game.round,
				winner: game.winnerId,
				createdAt: game.createdAt.toISOString(),
				completedAt: game.completedAt?.toISOString() ?? null,
				duration: data.totalDuration,
			},
			scoreboard,
			findings: findings.map((f) => ({
				id: f.id,
				round: f.roundNumber,
				agentId: f.agentId,
				filePath: f.filePath,
				lineStart: f.lineStart,
				lineEnd: f.lineEnd,
				description: f.description,
				status: f.status,
				confidence: f.confidence,
				points: f.pointsAwarded,
				refereeVerdict: f.refereeVerdict,
				createdAt: f.createdAt.toISOString(),
			})),
		};
	}
}
