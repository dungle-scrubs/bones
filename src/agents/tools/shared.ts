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
 * Creates a read_file tool scoped to a project directory.
 * Reads file contents with optional line range filtering.
 *
 * @param projectPath - Absolute path to the target project
 * @returns AgentTool that reads files within the project
 */
export function createReadFileTool(projectPath: string): AgentTool {
	return {
		name: "view_file",
		label: "View File",
		description:
			"Read the contents of a file in the target project. Optionally specify a line range.",
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
							text: `Error: path traversal outside project: ${params.path}`,
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
 *
 * @param projectPath - Absolute path to the target project
 * @returns AgentTool that searches code within the project
 */
export function createSearchCodeTool(projectPath: string): AgentTool {
	return {
		name: "search_code",
		label: "Search Code",
		description:
			"Search for a pattern in the project codebase using grep. Returns matching lines with file paths and line numbers.",
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
			const searchPath = params.path
				? resolve(projectPath, params.path)
				: projectPath;

			// Prevent path traversal
			if (!searchPath.startsWith(resolve(projectPath))) {
				return {
					content: [
						{ type: "text", text: `Error: path traversal outside project` },
					],
					details: { matchCount: 0 },
				};
			}

			try {
				const result = execSync(
					`grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.rs" --include="*.go" --include="*.md" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.toml" -E ${JSON.stringify(params.pattern)} ${JSON.stringify(searchPath)} 2>/dev/null | head -100`,
					{ encoding: "utf-8", maxBuffer: 1024 * 1024 },
				);

				// Make paths relative to project root
				const output = result.replace(
					new RegExp(
						projectPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/",
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
