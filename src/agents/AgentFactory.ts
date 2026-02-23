/**
 * Factory for creating pi-agent-core Agent instances configured for each game role.
 * Handles model selection, thinking levels, system prompts, and tool assignment.
 * Includes context-window-aware message pruning to prevent token overflow.
 */

import type {
	AgentMessage,
	AgentTool,
	ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import type {
	Api,
	AssistantMessage,
	Message,
	Model,
	ToolResultMessage,
	UserMessage,
} from "@mariozechner/pi-ai";
import { withClaudeCodeShims } from "./tools/claude-code-shim.js";

/** Role-specific configuration for agent creation. */
export interface AgentRoleConfig {
	systemPrompt: string;
	tools: AgentTool[];
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	/** Maximum turns before the agent is stopped. */
	maxTurns?: number;
	/** OAuth API key for subscription auth. Overrides ANTHROPIC_API_KEY. */
	apiKey?: string;
}

/** Default thinking levels per role. Referee gets more thinking budget. */
export const DEFAULT_THINKING: Record<string, ThinkingLevel> = {
	hunt: "medium",
	review: "medium",
	referee: "high",
	verifier: "high",
};

/** Default max turns per role. Prevents runaway agents. */
export const DEFAULT_MAX_TURNS: Record<string, number> = {
	hunt: 30,
	review: 15,
	referee: 10,
	verifier: 5,
};

// ---------------------------------------------------------------------------
// Context-window-aware message conversion
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 characters per token. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimates token count for a single message based on text length.
 * Uses a ~4 chars/token heuristic — good enough for budget decisions.
 */
function estimateMessageTokens(msg: Message): number {
	let chars = 0;

	if (msg.role === "user") {
		const um = msg as UserMessage;
		if (typeof um.content === "string") {
			chars = um.content.length;
		} else {
			for (const c of um.content) {
				if (c.type === "text") chars += c.text.length;
			}
		}
	} else if (msg.role === "assistant") {
		const am = msg as AssistantMessage;
		for (const c of am.content) {
			if (c.type === "text") chars += c.text.length;
			else if (c.type === "thinking") chars += c.thinking.length;
			else if (c.type === "toolCall")
				chars += JSON.stringify(c.arguments).length + c.name.length;
		}
	} else if (msg.role === "toolResult") {
		const tr = msg as ToolResultMessage;
		for (const c of tr.content) {
			if (c.type === "text") chars += c.text.length;
		}
	}

	return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Creates a convertToLlm function that prunes old tool results when the
 * conversation approaches the model's context window limit.
 *
 * Strategy:
 * 1. Filter to standard message types (user/assistant/toolResult)
 * 2. Estimate total token count
 * 3. If over budget, truncate oldest tool results first
 * 4. Never touch the last 6 messages (current turn's working context)
 *
 * @param contextWindow - Model's context window size in tokens
 * @returns convertToLlm function for pi-agent-core
 */
function createContextAwareConverter(
	contextWindow: number,
): (messages: AgentMessage[]) => Message[] {
	// Reserve 25% for system prompt, tool definitions, thinking, and output
	const tokenBudget = Math.floor(contextWindow * 0.75);

	return function convertToLlm(messages: AgentMessage[]): Message[] {
		const filtered = messages.filter(
			(m): m is Message =>
				"role" in m &&
				(m.role === "user" ||
					m.role === "assistant" ||
					m.role === "toolResult"),
		);

		let estimated = 0;
		for (const msg of filtered) {
			estimated += estimateMessageTokens(msg);
		}

		if (estimated <= tokenBudget) return filtered;

		// Clone messages so we can mutate without affecting agent history
		const result: Message[] = filtered.map((m) => ({ ...m }) as Message);

		// Protect the last 6 messages (current working context)
		const safeZone = Math.max(result.length - 6, 0);

		// Pass 1: truncate old tool results (biggest offenders — file contents)
		for (let i = 0; i < safeZone && estimated > tokenBudget; i++) {
			const msg = result[i];
			if (msg.role === "toolResult") {
				const before = estimateMessageTokens(msg);
				const tr = msg as ToolResultMessage;
				(result[i] as ToolResultMessage) = {
					...tr,
					content: [
						{
							type: "text" as const,
							text: `[truncated — ${tr.toolName} output removed to fit context window]`,
						},
					],
				};
				estimated -= before - estimateMessageTokens(result[i]);
			}
		}

		// Pass 2: if still over, truncate old assistant thinking blocks
		for (let i = 0; i < safeZone && estimated > tokenBudget; i++) {
			const msg = result[i];
			if (msg.role === "assistant") {
				const am = msg as AssistantMessage;
				const hasThinking = am.content.some((c) => c.type === "thinking");
				if (hasThinking) {
					const before = estimateMessageTokens(msg);
					(result[i] as AssistantMessage) = {
						...am,
						content: am.content.filter((c) => c.type !== "thinking"),
					};
					estimated -= before - estimateMessageTokens(result[i]);
				}
			}
		}

		return result;
	};
}

/**
 * Creates a configured Agent instance for a specific game role.
 *
 * @param config - Role-specific configuration
 * @returns Configured pi-agent-core Agent ready for prompting
 */
export function createAgent(config: AgentRoleConfig): Agent {
	// When using OAuth, add Claude Code shim tools so the request
	// passes Anthropic's server-side tool set validation.
	const tools = config.apiKey
		? withClaudeCodeShims(config.tools)
		: config.tools;
	const agent = new Agent({
		initialState: {
			systemPrompt: config.systemPrompt,
			model: config.model,
			thinkingLevel: config.thinkingLevel,
			tools,
		},
		convertToLlm: createContextAwareConverter(config.model.contextWindow),
		// Inject OAuth key if provided — bypasses ANTHROPIC_API_KEY env var
		getApiKey: config.apiKey ? () => config.apiKey : undefined,
	});

	return agent;
}
