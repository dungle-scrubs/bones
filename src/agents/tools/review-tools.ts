/**
 * Review phase tools — submit disputes and mark done.
 * Used by review agents to challenge other agents' findings.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { Orchestrator } from "../../services/Orchestrator.js";
import { createReadFileTool, createSearchCodeTool } from "./shared.js";

/**
 * Creates the full set of tools available to a review agent.
 *
 * @param orchestrator - Game orchestrator instance
 * @param gameId - Current game ID
 * @param agentId - This agent's ID
 * @param projectPath - Absolute path to target project
 * @returns Array of AgentTools for the review phase
 */
export function createReviewTools(
	orchestrator: Orchestrator,
	gameId: string,
	agentId: string,
	projectPath: string,
): AgentTool[] {
	const submitDispute: AgentTool = {
		name: "submit_dispute",
		label: "Submit Dispute",
		description:
			"Dispute a finding you believe is invalid. Provide the finding ID and your reasoning.",
		parameters: Type.Object({
			finding_id: Type.Number({ description: "ID of the finding to dispute" }),
			reason: Type.String({
				description: "Detailed reasoning for why this finding is invalid",
			}),
		}),
		async execute(
			_toolCallId,
			rawParams,
		): Promise<AgentToolResult<{ disputeId: number }>> {
			const params = rawParams as { finding_id: number; reason: string };
			try {
				const disputeId = orchestrator.submitDispute(
					gameId,
					agentId,
					params.finding_id,
					params.reason,
				);
				return {
					content: [
						{
							type: "text",
							text: `Dispute #${disputeId} filed against finding #${params.finding_id}.`,
						},
					],
					details: { disputeId },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error submitting dispute: ${(error as Error).message}`,
						},
					],
					details: { disputeId: -1 },
				};
			}
		},
	};

	const markDone: AgentTool = {
		name: "mark_done",
		label: "Mark Done",
		description:
			"Signal that you have finished reviewing findings. Call this when you have no more disputes to file.",
		parameters: Type.Object({}),
		async execute(): Promise<AgentToolResult<{ done: boolean }>> {
			try {
				orchestrator.markAgentDone(gameId, agentId, "review");
				return {
					content: [{ type: "text", text: "Review phase marked as complete." }],
					details: { done: true },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error marking done: ${(error as Error).message}`,
						},
					],
					details: { done: false },
				};
			}
		},
	};

	return [
		submitDispute,
		markDone,
		createReadFileTool(projectPath),
		createSearchCodeTool(projectPath),
	];
}
