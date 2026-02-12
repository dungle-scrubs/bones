/**
 * No-op Claude Code tools for OAuth subscription compatibility.
 *
 * When using OAuth (sk-ant-oat) tokens, Anthropic validates that requests
 * include Claude Code's core tool set. These shims satisfy that check.
 * Only tools NOT already provided by the agent's real tool set are added.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

/** Creates a no-op tool that returns a "not available" message. */
function noop(
	name: string,
	label: string,
	description: string,
): AgentTool {
	return {
		name,
		label,
		description,
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text" as const, text: `${label} is not available in this environment.` }],
				details: {},
			};
		},
	};
}

/** Claude Code core tools that must appear in OAuth requests. */
const SHIM_TOOLS: AgentTool[] = [
	noop("read", "Read", "Read file contents"),
	noop("write", "Write", "Write file contents"),
	noop("edit", "Edit", "Edit file contents"),
	noop("bash", "Bash", "Run shell commands"),
	noop("grep", "Grep", "Search with grep"),
	noop("glob", "Glob", "Find files by pattern"),
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
