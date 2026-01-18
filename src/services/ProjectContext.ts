/**
 * Loads project-specific context from .words_hurt/analysis.json.
 * Provides anti-patterns, key files, and conventions for smarter prompts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Project context loaded from .words_hurt/analysis.json */
export interface ProjectContext {
	readonly antiPatterns: ReadonlyArray<{
		readonly pattern: string;
		readonly instead: string;
	}>;
	readonly keyFiles: ReadonlyArray<{
		readonly path: string;
		readonly purpose: string;
		readonly readFirst: boolean;
	}>;
	readonly conventions: {
		readonly errorHandling?: string;
		readonly imports?: string;
		readonly naming?: {
			readonly files?: string;
			readonly functions?: string;
		};
	};
	readonly projectRules: ReadonlyArray<{
		readonly rule: string;
		readonly reason: string;
	}>;
}

/**
 * Attempts to load project context from .words_hurt/analysis.json.
 * Returns null if not found or invalid.
 */
export function loadProjectContext(projectPath: string): ProjectContext | null {
	const analysisPath = join(projectPath, ".words_hurt", "analysis.json");

	if (!existsSync(analysisPath)) {
		return null;
	}

	try {
		const content = readFileSync(analysisPath, "utf-8");
		const analysis = JSON.parse(content) as Record<string, unknown>;

		// Extract anti-patterns
		const rawAntiPatterns = analysis.antiPatterns;
		const antiPatterns: ProjectContext["antiPatterns"] = Array.isArray(
			rawAntiPatterns,
		)
			? rawAntiPatterns.map((p) => {
					const obj = p as Record<string, unknown>;
					return {
						pattern: String(obj.pattern ?? ""),
						instead: String(obj.instead ?? ""),
					};
				})
			: [];

		// Extract key files
		const rawKeyFiles = analysis.keyFiles;
		const keyFiles: ProjectContext["keyFiles"] = Array.isArray(rawKeyFiles)
			? rawKeyFiles.map((f) => {
					const obj = f as Record<string, unknown>;
					return {
						path: String(obj.path ?? ""),
						purpose: String(obj.purpose ?? ""),
						readFirst: Boolean(obj.readFirst),
					};
				})
			: [];

		// Extract conventions
		const rawConventions = (analysis.conventions ?? {}) as Record<
			string,
			unknown
		>;
		const rawNaming = (rawConventions.naming ?? {}) as Record<string, unknown>;
		const rawImports = (rawConventions.imports ?? {}) as Record<
			string,
			unknown
		>;
		const rawErrorHandling = (rawConventions.errorHandling ?? {}) as Record<
			string,
			unknown
		>;

		const conventions: ProjectContext["conventions"] = {
			errorHandling:
				typeof rawErrorHandling.pattern === "string"
					? rawErrorHandling.pattern
					: undefined,
			imports:
				typeof rawImports.style === "string" ? rawImports.style : undefined,
			naming: {
				files:
					typeof rawNaming.files === "string" ? rawNaming.files : undefined,
				functions:
					typeof rawNaming.functions === "string"
						? rawNaming.functions
						: undefined,
			},
		};

		// Extract project rules
		const rawRules = (analysis.projectRules ?? {}) as Record<string, unknown>;
		const rawCritical = rawRules.critical;
		const projectRules: ProjectContext["projectRules"] = Array.isArray(
			rawCritical,
		)
			? rawCritical.map((r) => {
					const obj = r as Record<string, unknown>;
					return {
						rule: String(obj.rule ?? ""),
						reason: String(obj.reason ?? ""),
					};
				})
			: [];

		return { antiPatterns, keyFiles, conventions, projectRules };
	} catch {
		return null;
	}
}

/**
 * Formats anti-patterns as markdown for prompt injection.
 */
export function formatAntiPatternsForPrompt(
	context: ProjectContext | null | undefined,
): string {
	if (!context || context.antiPatterns.length === 0) {
		return "";
	}

	const lines = ["## Project-Specific Anti-Patterns", ""];
	for (const ap of context.antiPatterns) {
		lines.push(`- ❌ **Don't:** ${ap.pattern}`);
		lines.push(`  ✅ **Instead:** ${ap.instead}`);
	}

	return lines.join("\n");
}

/**
 * Formats key files as markdown for prompt injection.
 */
export function formatKeyFilesForPrompt(
	context: ProjectContext | null | undefined,
): string {
	if (!context || context.keyFiles.length === 0) {
		return "";
	}

	const readFirst = context.keyFiles.filter((f) => f.readFirst);
	const files = readFirst.length > 0 ? readFirst : context.keyFiles.slice(0, 5);

	const lines = ["## Key Files to Read First", ""];
	for (const f of files) {
		lines.push(`- \`${f.path}\` - ${f.purpose}`);
	}

	return lines.join("\n");
}

/**
 * Formats critical project rules as markdown for prompt injection.
 */
export function formatProjectRulesForPrompt(
	context: ProjectContext | null | undefined,
): string {
	if (!context || context.projectRules.length === 0) {
		return "";
	}

	const lines = ["## Critical Project Rules", ""];
	for (const rule of context.projectRules) {
		lines.push(`- **${rule.rule}**: ${rule.reason}`);
	}

	return lines.join("\n");
}
