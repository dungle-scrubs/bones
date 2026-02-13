/**
 * Shared agent tools for file reading and code searching.
 * Used by hunt agents, referee, and verifier roles.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

/**
 * Directories excluded from agent search/read by default.
 * Prevents agents wasting turns on build artifacts, deps, and metadata.
 */
export const DEFAULT_EXCLUDE_DIRS = [
	"node_modules",
	"dist",
	"build",
	"out",
	".git",
	".next",
	".tallow",
	".claude",
	"coverage",
	"__pycache__",
	".venv",
	"venv",
	"target", // rust
	"vendor", // go
	".turbo",
];

/** File patterns excluded from search results. */
const EXCLUDE_FILES = [
	"*.lock",
	"*.lockb",
	"bun.lock",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"*.min.js",
	"*.min.css",
	"*.map",
];

/**
 * Options for scoping agent tools to specific paths.
 *
 * @property include - Glob patterns to include (e.g. ["src/", "lib/"]). If set, only matching paths are allowed.
 * @property exclude - Additional dirs to exclude beyond defaults (e.g. ["scripts/", "legacy/"]).
 */
export interface PathFilter {
	include?: string[];
	exclude?: string[];
}

/**
 * Resolves the effective exclude list by merging defaults with user overrides.
 *
 * @param filter - Optional user-provided path filter
 * @returns Array of directory names to exclude
 */
function resolveExcludes(filter?: PathFilter): string[] {
	const excludes = [...DEFAULT_EXCLUDE_DIRS];
	if (filter?.exclude) {
		for (const e of filter.exclude) {
			// Strip trailing slashes for consistency
			const clean = e.replace(/\/+$/, "");
			if (!excludes.includes(clean)) excludes.push(clean);
		}
	}
	return excludes;
}

/**
 * Checks if a relative path is allowed by the path filter.
 * Rejects paths in excluded dirs and paths outside include patterns.
 *
 * @param relPath - Path relative to project root
 * @param excludes - Resolved exclude directory list
 * @param filter - Optional include patterns
 * @returns true if the path is allowed
 */
function isPathAllowed(
	relPath: string,
	excludes: string[],
	filter?: PathFilter,
): boolean {
	const parts = relPath.split("/");

	// Check excludes — any path segment matching an excluded dir is blocked
	for (const part of parts) {
		if (excludes.includes(part)) return false;
	}

	// Check includes — if set, path must start with one of the include patterns
	if (filter?.include && filter.include.length > 0) {
		return filter.include.some((inc) => {
			const clean = inc.replace(/\/+$/, "");
			return relPath === clean || relPath.startsWith(clean + "/");
		});
	}

	return true;
}

/**
 * Creates a view_file tool scoped to a project directory.
 * Reads file contents with optional line range filtering.
 * Respects path filters to prevent reading build artifacts.
 *
 * @param projectPath - Absolute path to the target project
 * @param filter - Optional include/exclude path filters
 * @returns AgentTool that reads files within the project
 */
export function createReadFileTool(
	projectPath: string,
	filter?: PathFilter,
): AgentTool {
	const excludes = resolveExcludes(filter);

	return {
		name: "view_file",
		label: "View File",
		description:
			"Read the contents of a source file in the target project. Optionally specify a line range.",
		parameters: Type.Object({
			path: Type.String({ description: "File path relative to project root" }),
			start_line: Type.Optional(
				Type.Number({ description: "Start line (1-indexed, inclusive)" }),
			),
			end_line: Type.Optional(
				Type.Number({ description: "End line (1-indexed, inclusive)" }),
			),
		}),
		async execute(
			_toolCallId,
			rawParams,
		): Promise<AgentToolResult<{ path: string; lineCount: number }>> {
			const params = rawParams as {
				path: string;
				start_line?: number;
				end_line?: number;
			};
			const fullPath = resolve(projectPath, params.path);

			// Prevent path traversal outside project
			if (!fullPath.startsWith(resolve(projectPath))) {
				return {
					content: [
						{
							type: "text",
							text: `Error: path outside project: ${params.path}`,
						},
					],
					details: { path: params.path, lineCount: 0 },
				};
			}

			// Check path filter
			if (!isPathAllowed(params.path, excludes, filter)) {
				return {
					content: [
						{
							type: "text",
							text: `Excluded path: ${params.path}. Only source files are searchable.`,
						},
					],
					details: { path: params.path, lineCount: 0 },
				};
			}

			if (!existsSync(fullPath)) {
				return {
					content: [{ type: "text", text: `File not found: ${params.path}` }],
					details: { path: params.path, lineCount: 0 },
				};
			}

			const content = readFileSync(fullPath, "utf-8");
			const lines = content.split("\n");

			let output: string;
			let lineCount: number;

			if (params.start_line !== undefined || params.end_line !== undefined) {
				const start = Math.max(1, params.start_line ?? 1);
				const end = Math.min(lines.length, params.end_line ?? lines.length);
				const slice = lines.slice(start - 1, end);
				output = slice.map((line, i) => `${start + i}: ${line}`).join("\n");
				lineCount = slice.length;
			} else {
				// Cap at 500 lines to avoid blowing up context
				const capped = lines.slice(0, 500);
				output = capped.map((line, i) => `${i + 1}: ${line}`).join("\n");
				if (lines.length > 500) {
					output += `\n... (${lines.length - 500} more lines truncated)`;
				}
				lineCount = capped.length;
			}

			return {
				content: [{ type: "text", text: output }],
				details: { path: params.path, lineCount },
			};
		},
	};
}

/**
 * Creates a search_code tool scoped to a project directory.
 * Uses grep to find pattern matches across the codebase.
 * Respects path filters to skip build artifacts and deps.
 *
 * @param projectPath - Absolute path to the target project
 * @param filter - Optional include/exclude path filters
 * @returns AgentTool that searches code within the project
 */
export function createSearchCodeTool(
	projectPath: string,
	filter?: PathFilter,
): AgentTool {
	const excludes = resolveExcludes(filter);

	// Build grep --exclude-dir flags
	const excludeDirFlags = excludes
		.map((d) => `--exclude-dir=${JSON.stringify(d)}`)
		.join(" ");
	const excludeFileFlags = EXCLUDE_FILES.map(
		(f) => `--exclude=${JSON.stringify(f)}`,
	).join(" ");

	return {
		name: "search_code",
		label: "Search Code",
		description:
			"Search for a pattern in the project source code using grep. Returns matching lines with file paths and line numbers.",
		parameters: Type.Object({
			pattern: Type.String({ description: "Search pattern (regex supported)" }),
			path: Type.Optional(
				Type.String({
					description:
						"Subdirectory or file to search within (relative to project root)",
				}),
			),
		}),
		async execute(
			_toolCallId,
			rawParams,
		): Promise<AgentToolResult<{ matchCount: number }>> {
			const params = rawParams as { pattern: string; path?: string };

			// Resolve search paths as an array — each individually quoted for shell safety
			let searchPaths: string[];
			if (params.path) {
				searchPaths = [resolve(projectPath, params.path)];
			} else if (filter?.include && filter.include.length > 0) {
				searchPaths = filter.include.map((inc) =>
					resolve(projectPath, inc.replace(/\/+$/, "")),
				);
			} else {
				searchPaths = [projectPath];
			}

			// Prevent path traversal
			const resolvedRoot = resolve(projectPath);
			for (const p of searchPaths) {
				if (!p.startsWith(resolvedRoot)) {
					return {
						content: [
							{ type: "text", text: "Error: path traversal outside project" },
						],
						details: { matchCount: 0 },
					};
				}
			}

			// Quote each path individually to prevent shell injection
			const quotedPaths = searchPaths.map((p) => JSON.stringify(p)).join(" ");

			try {
				const result = execSync(
					`grep -rn ${excludeDirFlags} ${excludeFileFlags} --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.rs" --include="*.go" --include="*.md" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.toml" -E ${JSON.stringify(params.pattern)} ${quotedPaths} 2>/dev/null | head -100`,
					{ encoding: "utf-8", maxBuffer: 1024 * 1024 },
				);

				// Make paths relative to project root
				const output = result.replace(
					new RegExp(
						resolve(projectPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/",
						"g",
					),
					"",
				);

				const matchCount = output.split("\n").filter(Boolean).length;
				return {
					content: [{ type: "text", text: output || "No matches found." }],
					details: { matchCount },
				};
			} catch {
				// grep exits non-zero when no matches
				return {
					content: [{ type: "text", text: "No matches found." }],
					details: { matchCount: 0 },
				};
			}
		},
	};
}
