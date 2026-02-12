/**
 * Factory for creating pi-agent-core Agent instances configured for each game role.
 * Handles model selection, thinking levels, system prompts, and tool assignment.
 */

import type {
	AgentMessage,
	AgentTool,
	ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import type { Api, Message, Model } from "@mariozechner/pi-ai";

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
	hunt: 20,
	review: 10,
	referee: 5,
	verifier: 3,
};

/**
 * Default convertToLlm — passes through standard Message types, drops custom messages.
 *
 * @param messages - Agent messages to filter
 * @returns Only standard LLM-compatible messages
 */
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(m): m is Message =>
			"role" in m &&
			(m.role === "user" || m.role === "assistant" || m.role === "toolResult"),
	);
}

/**
 * Creates a configured Agent instance for a specific game role.
 *
 * @param config - Role-specific configuration
 * @returns Configured pi-agent-core Agent ready for prompting
 */
export function createAgent(config: AgentRoleConfig): Agent {
	const agent = new Agent({
		initialState: {
			systemPrompt: config.systemPrompt,
			model: config.model,
			thinkingLevel: config.thinkingLevel,
			tools: config.tools,
		},
		convertToLlm: defaultConvertToLlm,
		// Inject OAuth key if provided — bypasses ANTHROPIC_API_KEY env var
		getApiKey: config.apiKey ? () => config.apiKey : undefined,
	});

	return agent;
}
