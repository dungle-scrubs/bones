/**
 * Hunt phase tools — submit findings and mark done.
 * Used by hunt agents to interact with the game during the hunt phase.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { Orchestrator } from "../../services/Orchestrator.js";
import { type PathFilter, createReadFileTool, createSearchCodeTool } from "./shared.js";

/**
 * Creates the full set of tools available to a hunt agent.
 *
 * @param orchestrator - Game orchestrator instance
 * @param gameId - Current game ID
 * @param agentId - This agent's ID
 * @param projectPath - Absolute path to target project
 * @param filter - Optional include/exclude path filters
 * @returns Array of AgentTools for the hunt phase
 */
export function createHuntTools(
	orchestrator: Orchestrator,
	gameId: string,
	agentId: string,
	projectPath: string,
	filter?: PathFilter,
): AgentTool[] {
	const submitFinding: AgentTool = {
		name: "submit_finding",
		label: "Submit Finding",
		description:
			"Submit a bug/issue finding. Provide the file path, line range, and a clear description of the issue.",
		parameters: Type.Object({
			file_path: Type.String({
				description: "File path relative to project root",
			}),
			line_start: Type.Number({ description: "Start line number (1-indexed)" }),
			line_end: Type.Number({ description: "End line number (1-indexed)" }),
			description: Type.String({
				description: "Clear description of the issue found",
			}),
			code_snippet: Type.Optional(
				Type.String({
					description:
						"Relevant code snippet or evidence (required for doc_drift)",
				}),
			),
		}),
		async execute(
			_toolCallId,
			rawParams,
		): Promise<AgentToolResult<{ findingId: number }>> {
			const params = rawParams as {
				file_path: string;
				line_start: number;
				line_end: number;
				description: string;
				code_snippet?: string;
			};
			try {
				const findingId = orchestrator.submitFinding(
					gameId,
					agentId,
					params.file_path,
					params.line_start,
					params.line_end,
					params.description,
					params.code_snippet,
				);
				return {
					content: [
						{
							type: "text",
							text: `Finding #${findingId} submitted successfully for ${params.file_path}:${params.line_start}-${params.line_end}`,
						},
					],
					details: { findingId },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error submitting finding: ${(error as Error).message}`,
						},
					],
					details: { findingId: -1 },
				};
			}
		},
	};

	const markDone: AgentTool = {
		name: "mark_done",
		label: "Mark Done",
		description:
			"Signal that you have finished hunting for issues. Call this when you have no more findings to submit.",
		parameters: Type.Object({}),
		async execute(): Promise<AgentToolResult<{ done: boolean }>> {
			try {
				orchestrator.markAgentDone(gameId, agentId, "hunt");
				return {
					content: [{ type: "text", text: "Hunt phase marked as complete." }],
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
		submitFinding,
		markDone,
		createReadFileTool(projectPath, filter),
		createSearchCodeTool(projectPath, filter),
	];
}
