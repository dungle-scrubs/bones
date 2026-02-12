/**
 * Claude Code tool shims for OAuth subscription compatibility.
 *
 * When using OAuth (sk-ant-oat) tokens, Anthropic validates that requests
 * include Claude Code's core tool set. These shims satisfy that check
 * and redirect the model to use the agent's real tools.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

/**
 * Creates a shim tool that tells the model to use the correct tool instead.
 *
 * @param name - CC tool name (lowercase, remapped to PascalCase by pi-ai)
 * @param label - Display label
 * @param redirect - Message telling the model which real tool to use
 */
function shim(
	name: string,
	label: string,
	redirect: string,
): AgentTool {
	return {
		name,
		label,
		// Description steers the model away from using this tool
		description: `[DISABLED] ${redirect}`,
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text" as const, text: redirect }],
				details: {},
			};
		},
	};
}

/** Claude Code core tools that must appear in OAuth requests. */
const SHIM_TOOLS: AgentTool[] = [
	shim("read", "Read", "Do not use this tool. Use view_file instead to read files."),
	shim("write", "Write", "Do not use this tool. Writing files is not available."),
	shim("edit", "Edit", "Do not use this tool. Editing files is not available."),
	shim("bash", "Bash", "Do not use this tool. Use search_code to search the codebase and view_file to read files."),
	shim("grep", "Grep", "Do not use this tool. Use search_code instead to search."),
	shim("glob", "Glob", "Do not use this tool. Use search_code instead to find files."),
];

/**
 * Adds Claude Code shim tools to a tool list, skipping any names already present.
 * Tool names are matched case-insensitively since pi-ai's stealth mode
 * remaps them to Claude Code casing (e.g. "read" → "Read").
 *
 * @param tools - Agent's real tool set
 * @returns Combined tool set with shims appended
 */
export function withClaudeCodeShims(tools: AgentTool[]): AgentTool[] {
	const existing = new Set(tools.map((t) => t.name.toLowerCase()));
	const shims = SHIM_TOOLS.filter((s) => !existing.has(s.name.toLowerCase()));
	return [...tools, ...shims];
}
