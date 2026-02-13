/**
 * Drives the full autonomous game loop.
 * Coordinates agents, referee, and verifier through all phases
 * using pi-agent-core for LLM interactions.
 */

import type { AgentEvent, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model, Usage } from "@mariozechner/pi-ai";
import { type AgentRunResult, runAgent } from "../agents/AgentRunner.js";
import { createHuntTools } from "../agents/tools/hunt-tools.js";
import {
	createRefereeResolutionTools,
	createRefereeValidationTools,
} from "../agents/tools/referee-tools.js";
import { createReviewTools } from "../agents/tools/review-tools.js";
import type { PathFilter } from "../agents/tools/shared.js";
import { createVerifierTools } from "../agents/tools/verifier-tools.js";
import type { Orchestrator, SetupConfig } from "./Orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for running an autonomous game. */
export interface PlayConfig extends SetupConfig {
	/** Model for hunt/review agents. */
	agentModel: Model<any>;
	/** Model for referee/verifier (defaults to agentModel). */
	refereeModel?: Model<any>;
	/** Thinking level for hunt/review agents. */
	agentThinking?: ThinkingLevel;
	/** Thinking level for referee/verifier. */
	refereeThinking?: ThinkingLevel;
	/** OAuth API key for subscription auth (bypasses ANTHROPIC_API_KEY). */
	apiKey?: string;
	/** Path include/exclude filters for agent tools. */
	pathFilter?: PathFilter;
}

/** Events emitted by GameRunner for CLI/TUI consumption. */
export type GameEvent =
	| { type: "game_created"; gameId: string; agents: string[] }
	| { type: "round_start"; round: number }
	| { type: "hunt_start"; round: number; agentCount: number }
	| { type: "hunt_agent_done"; agentId: string; result: AgentRunResult }
	| { type: "hunt_end"; round: number }
	| { type: "scoring_start"; round: number; findingCount: number }
	| { type: "finding_validated"; findingId: number; verdict: string }
	| { type: "scoring_end"; round: number }
	| { type: "verification_start"; count: number }
	| { type: "finding_verified"; findingId: number; confirmed: boolean }
	| { type: "verification_end" }
	| { type: "review_start"; round: number; agentCount: number }
	| { type: "review_agent_done"; agentId: string; result: AgentRunResult }
	| { type: "review_end"; round: number }
	| { type: "dispute_scoring_start"; round: number; disputeCount: number }
	| { type: "dispute_resolved"; disputeId: number; verdict: string }
	| { type: "dispute_scoring_end"; round: number }
	| {
			type: "round_complete";
			round: number;
			action: string;
			winner?: string;
			reason: string;
	  }
	| { type: "game_complete"; winner: string; reason: string; totalCost: Usage }
	| { type: "agent_event"; agentId: string; role: string; event: AgentEvent };

/** Per-finding timeout for referee validation (seconds). */
const REFEREE_TIMEOUT_SECS = 120;
/** Per-dispute timeout for referee resolution (seconds). */
const DISPUTE_TIMEOUT_SECS = 90;
/** Per-finding timeout for verifier (seconds). */
const VERIFIER_TIMEOUT_SECS = 90;

// ---------------------------------------------------------------------------
// GameRunner
// ---------------------------------------------------------------------------

/**
 * Orchestrates a full autonomous game from setup through completion.
 * Yields GameEvents for real-time progress tracking by CLI or TUI.
 */
export class GameRunner {
	private orchestrator: Orchestrator;
	private projectPath: string;
	private totalCost: Usage;
	private apiKey?: string;
	private pathFilter?: PathFilter;
	private silent: boolean;

	/**
	 * @param orchestrator - Existing Orchestrator with database connection
	 * @param projectPath - Absolute path to the target project on disk
	 * @param options - Optional configuration
	 * @param options.silent - Suppress stderr logging (for TUI mode)
	 */
	constructor(
		orchestrator: Orchestrator,
		projectPath: string,
		options?: { silent?: boolean },
	) {
		this.orchestrator = orchestrator;
		this.projectPath = projectPath;
		this.silent = options?.silent ?? false;
		this.totalCost = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
	}

	/**
	 * Runs a complete game autonomously.
	 * Yields events for each phase transition and agent action.
	 *
	 * @param config - Play configuration including model selection
	 * @yields GameEvent for each significant state change
	 */
	async *play(config: PlayConfig): AsyncGenerator<GameEvent> {
		const refereeModel = config.refereeModel ?? config.agentModel;
		this.apiKey = config.apiKey;
		this.pathFilter = config.pathFilter;

		// 1. Setup
		const setup = this.orchestrator.setup(config);
		yield { type: "game_created", gameId: setup.gameId, agents: setup.agents };

		const gameId = setup.gameId;

		while (true) {
			const game = this.orchestrator.getGame(gameId);
			if (!game) throw new Error(`Game disappeared: ${gameId}`);

			yield { type: "round_start", round: game.round + 1 };

			// ── 2. Hunt phase ──────────────────────────────────────────
			const huntResult = this.orchestrator.startHunt(gameId);
			yield {
				type: "hunt_start",
				round: huntResult.round,
				agentCount: huntResult.agents.length,
			};

			const huntAgentResults = await this.runParallelAgents(
				huntResult.agents,
				"hunt",
				config.agentModel,
				config.agentThinking,
				(agentId) =>
					createHuntTools(
						this.orchestrator,
						gameId,
						agentId,
						this.projectPath,
						this.pathFilter,
					),
				huntResult.durationSeconds,
			);

			for (const { agentId, result } of huntAgentResults) {
				this.logAgentResult(agentId, "hunt", result);
				yield { type: "hunt_agent_done", agentId, result };
			}

			yield { type: "hunt_end", round: huntResult.round };

			// ── 3. Hunt scoring — referee validates each finding ──────
			const scoringResult = this.orchestrator.startHuntScoring(gameId);
			yield {
				type: "scoring_start",
				round: scoringResult.round,
				findingCount: scoringResult.pendingFindings,
			};

			for (const validation of scoringResult.findingValidations) {
				const result = await this.runTimedAgent(
					`referee-${validation.findingId}`,
					"referee",
					"You are a code review referee. Validate findings by reading the actual code and making a verdict. Use the validate_finding tool to submit your verdict.",
					validation.prompt,
					createRefereeValidationTools(
						this.orchestrator,
						gameId,
						this.projectPath,
						this.pathFilter,
					),
					refereeModel,
					config.refereeThinking,
					REFEREE_TIMEOUT_SECS,
				);

				this.logAgentResult(
					`referee-${validation.findingId}`,
					"referee",
					result,
				);
				yield {
					type: "finding_validated",
					findingId: validation.findingId,
					verdict: "processed",
				};
			}

			yield { type: "scoring_end", round: scoringResult.round };

			// ── 4. Verification pass (uncertain findings) ─────────────
			const pending = this.orchestrator.getPendingVerifications(gameId);
			if (pending.findings.length > 0) {
				yield { type: "verification_start", count: pending.findings.length };

				for (const finding of pending.findings) {
					const result = await this.runTimedAgent(
						`verifier-${finding.findingId}`,
						"verifier",
						"You are an independent code verifier. Determine if this finding is a valid issue. Use the verify_finding tool to submit your verdict.",
						finding.prompt,
						createVerifierTools(
							this.orchestrator,
							gameId,
							this.projectPath,
							this.pathFilter,
						),
						refereeModel,
						config.refereeThinking,
						VERIFIER_TIMEOUT_SECS,
					);

					this.logAgentResult(
						`verifier-${finding.findingId}`,
						"verifier",
						result,
					);
					yield {
						type: "finding_verified",
						findingId: finding.findingId,
						confirmed: true,
					};
				}

				yield { type: "verification_end" };
			}

			// ── 5. Review phase — dispute other agents' findings ──────
			const reviewResult = this.orchestrator.startReview(gameId);
			yield {
				type: "review_start",
				round: reviewResult.round,
				agentCount: reviewResult.agents.length,
			};

			const reviewAgentResults = await this.runParallelAgents(
				reviewResult.agents,
				"review",
				config.agentModel,
				config.agentThinking,
				(agentId) =>
					createReviewTools(
						this.orchestrator,
						gameId,
						agentId,
						this.projectPath,
						this.pathFilter,
					),
				reviewResult.durationSeconds,
			);

			for (const { agentId, result } of reviewAgentResults) {
				this.logAgentResult(agentId, "review", result);
				yield { type: "review_agent_done", agentId, result };
			}

			yield { type: "review_end", round: reviewResult.round };

			// ── 6. Review scoring — referee resolves disputes ─────────
			const disputeResult = this.orchestrator.startReviewScoring(gameId);
			yield {
				type: "dispute_scoring_start",
				round: disputeResult.round,
				disputeCount: disputeResult.pendingDisputes,
			};

			for (const resolution of disputeResult.disputeResolutions) {
				const result = await this.runTimedAgent(
					`referee-dispute-${resolution.disputeId}`,
					"referee",
					"You are a code review referee. Resolve this dispute by reading the code and determining who is correct. Use the resolve_dispute tool to submit your verdict.",
					resolution.prompt,
					createRefereeResolutionTools(
						this.orchestrator,
						gameId,
						this.projectPath,
						this.pathFilter,
					),
					refereeModel,
					config.refereeThinking,
					DISPUTE_TIMEOUT_SECS,
				);

				this.logAgentResult(
					`referee-dispute-${resolution.disputeId}`,
					"referee",
					result,
				);
				yield {
					type: "dispute_resolved",
					disputeId: resolution.disputeId,
					verdict: "processed",
				};
			}

			yield { type: "dispute_scoring_end", round: disputeResult.round };

			// ── 7. Check winner ───────────────────────────────────────
			const winner = this.orchestrator.checkWinner(gameId);
			yield {
				type: "round_complete",
				round: disputeResult.round,
				action: winner.action,
				winner: winner.winner,
				reason: winner.reason,
			};

			if (winner.action === "GAME_COMPLETE") {
				yield {
					type: "game_complete",
					winner: winner.winner!,
					reason: winner.reason,
					totalCost: this.totalCost,
				};
				break;
			}
		}
	}

	/**
	 * Runs multiple agents in parallel with a shared timeout.
	 * Uses Promise.allSettled so one failure doesn't kill the others.
	 *
	 * @returns Completed agent results (excludes failures)
	 */
	private async runParallelAgents(
		agents: Array<{ agentId: string; prompt: string }>,
		role: string,
		model: Model<any>,
		thinkingLevel: ThinkingLevel | undefined,
		createTools: (agentId: string) => any[],
		timeoutSeconds: number,
	): Promise<Array<{ agentId: string; result: AgentRunResult }>> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

		try {
			const promises = agents.map(async (a) => {
				const tools = createTools(a.agentId);

				const result = await runAgent(
					a.agentId,
					role,
					this.buildAgentSystemPrompt(a.agentId),
					a.prompt,
					tools,
					model,
					{ thinkingLevel, apiKey: this.apiKey },
					undefined,
					controller.signal,
				);

				this.accumulateUsage(result.totalUsage);
				return { agentId: a.agentId, result };
			});

			const settled = await Promise.allSettled(promises);
			const completed: Array<{ agentId: string; result: AgentRunResult }> = [];

			for (let i = 0; i < settled.length; i++) {
				const outcome = settled[i];
				if (outcome.status === "fulfilled") {
					completed.push(outcome.value);
				} else if (!this.silent) {
					console.error(
						`[${role}] agent ${agents[i].agentId} failed: ${outcome.reason}`,
					);
				}
			}

			return completed;
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * Runs a single agent with its own AbortController and timeout.
	 * Used for referee and verifier where each run is independent.
	 *
	 * @param agentId - Agent identifier for logging
	 * @param role - Agent role
	 * @param systemPrompt - System prompt
	 * @param userPrompt - Task prompt
	 * @param tools - Available tools
	 * @param model - LLM model
	 * @param thinkingLevel - Thinking budget
	 * @param timeoutSecs - Max seconds before abort
	 * @returns Agent run result
	 */
	private async runTimedAgent(
		agentId: string,
		role: string,
		systemPrompt: string,
		userPrompt: string,
		tools: any[],
		model: Model<any>,
		thinkingLevel: ThinkingLevel | undefined,
		timeoutSecs: number,
	): Promise<AgentRunResult> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutSecs * 1000);

		try {
			const result = await runAgent(
				agentId,
				role,
				systemPrompt,
				userPrompt,
				tools,
				model,
				{ thinkingLevel, apiKey: this.apiKey },
				undefined,
				controller.signal,
			);

			this.accumulateUsage(result.totalUsage);
			return result;
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * Builds the system prompt for hunt/review agents.
	 * Explicitly lists real tools and tells agents to ignore CC shims.
	 *
	 * @param agentId - Agent's identifier
	 * @returns System prompt string
	 */
	private buildAgentSystemPrompt(agentId: string): string {
		return `You are a Bones competitive code review agent. Your agent ID is ${agentId}.

YOUR TOOLS (use ONLY these):
- view_file: Read file contents
- search_code: Grep the codebase
- submit_finding / submit_dispute: Submit findings or disputes
- mark_done: Signal you are finished

DISABLED (do NOT use): Read, Write, Edit, Bash, Grep, Glob — these do nothing.

You are in a TIMED COMPETITION. Submit findings FAST. Every turn you spend reading without submitting is wasted. Aim for at least one submission every 3-4 turns.`;
	}

	/**
	 * Logs agent result summary to stderr for CLI visibility.
	 *
	 * @param agentId - Agent identifier
	 * @param role - Agent role
	 * @param result - Completed agent result
	 */
	private logAgentResult(
		agentId: string,
		_role: string,
		result: AgentRunResult,
	): void {
		if (this.silent) return;

		const cost = `$${result.totalUsage.cost.total.toFixed(4)}`;
		const abort = result.aborted
			? ` aborted=${result.abortReason ?? "unknown"}`
			: "";
		const err = result.error ? ` error=${result.error}` : "";

		// Summarize tool usage
		const toolCounts = new Map<string, number>();
		for (const tc of result.toolCalls) {
			toolCounts.set(tc.tool, (toolCounts.get(tc.tool) ?? 0) + 1);
		}
		const toolSummary = Array.from(toolCounts.entries())
			.map(([name, count]) => `${name}=${count}`)
			.join(" ");

		console.error(
			`[${agentId}] turns=${result.turnCount} cost=${cost}${abort}${err}${toolSummary ? ` tools=[${toolSummary}]` : ""}`,
		);
	}

	/**
	 * Accumulates token usage from an agent run into the game total.
	 *
	 * @param usage - Usage from a completed agent run
	 */
	private accumulateUsage(usage: Usage): void {
		this.totalCost.input += usage.input;
		this.totalCost.output += usage.output;
		this.totalCost.cacheRead += usage.cacheRead;
		this.totalCost.cacheWrite += usage.cacheWrite;
		this.totalCost.totalTokens += usage.totalTokens;
		this.totalCost.cost.input += usage.cost.input;
		this.totalCost.cost.output += usage.cost.output;
		this.totalCost.cost.cacheRead += usage.cost.cacheRead;
		this.totalCost.cost.cacheWrite += usage.cost.cacheWrite;
		this.totalCost.cost.total += usage.cost.total;
	}
}
