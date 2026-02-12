/**
 * Manages the lifecycle of a single agent's execution.
 * Creates agents via factory, runs prompts, and tracks events.
 */

import type {
	Agent,
	AgentEvent,
	AgentTool,
	ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { Model, Usage } from "@mariozechner/pi-ai";
import {
	createAgent,
	DEFAULT_MAX_TURNS,
	DEFAULT_THINKING,
} from "./AgentFactory.js";

/** Result of a single agent run with accumulated usage stats. */
export interface AgentRunResult {
	agentId: string;
	role: string;
	turnCount: number;
	totalUsage: Usage;
	aborted: boolean;
	error?: string;
}

/** Callback for receiving agent events during execution. */
export type AgentEventCallback = (
	agentId: string,
	role: string,
	event: AgentEvent,
) => void;

/**
 * Runs an agent to completion with timeout and turn limits.
 * Subscribes to events for progress tracking and accumulates usage.
 *
 * @param agentId - Identifier for this agent (for logging/events)
 * @param role - Agent role (hunt, review, referee, verifier)
 * @param systemPrompt - System prompt with game context
 * @param userPrompt - The task prompt to send
 * @param tools - Role-specific tools
 * @param model - LLM model to use
 * @param options - Optional overrides for thinking level and max turns
 * @param onEvent - Optional callback for agent events
 * @param signal - Optional AbortSignal for external cancellation
 * @returns AgentRunResult with usage stats
 */
export async function runAgent(
	agentId: string,
	role: string,
	systemPrompt: string,
	userPrompt: string,
	tools: AgentTool[],
	model: Model<any>,
	options?: {
		thinkingLevel?: ThinkingLevel;
		maxTurns?: number;
	},
	onEvent?: AgentEventCallback,
	signal?: AbortSignal,
): Promise<AgentRunResult> {
	const thinkingLevel =
		options?.thinkingLevel ?? DEFAULT_THINKING[role] ?? "medium";
	const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS[role] ?? 10;

	const agent = createAgent({
		systemPrompt,
		tools,
		model,
		thinkingLevel,
	});

	const totalUsage: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};

	let turnCount = 0;
	let aborted = false;
	let error: string | undefined;

	// Subscribe to events for tracking
	const unsubscribe = agent.subscribe((event) => {
		onEvent?.(agentId, role, event);

		if (event.type === "turn_end") {
			turnCount++;

			// Accumulate usage from assistant message
			const msg = event.message;
			if ("role" in msg && msg.role === "assistant") {
				const u = msg.usage;
				totalUsage.input += u.input;
				totalUsage.output += u.output;
				totalUsage.cacheRead += u.cacheRead;
				totalUsage.cacheWrite += u.cacheWrite;
				totalUsage.totalTokens += u.totalTokens;
				totalUsage.cost.input += u.cost.input;
				totalUsage.cost.output += u.cost.output;
				totalUsage.cost.cacheRead += u.cost.cacheRead;
				totalUsage.cost.cacheWrite += u.cost.cacheWrite;
				totalUsage.cost.total += u.cost.total;
			}

			// Enforce turn limit
			if (turnCount >= maxTurns) {
				agent.abort();
				aborted = true;
			}
		}
	});

	// Handle external abort
	if (signal) {
		signal.addEventListener("abort", () => {
			agent.abort();
			aborted = true;
		});
	}

	try {
		await agent.prompt(userPrompt);
	} catch (err) {
		if (!aborted) {
			error = (err as Error).message;
		}
	} finally {
		unsubscribe();
	}

	return { agentId, role, turnCount, totalUsage, aborted, error };
}
