/**
 * Verifier tools — confirm or reject uncertain findings.
 * Used by the verifier agent during the verification pass.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { IssueType, RejectionReason } from "../../domain/types.js";
import type { Orchestrator } from "../../services/Orchestrator.js";
import { type PathFilter, createReadFileTool } from "./shared.js";

/**
 * Creates tools for verifying uncertain findings.
 *
 * @param orchestrator - Game orchestrator instance
 * @param gameId - Current game ID
 * @param projectPath - Absolute path to target project
 * @returns Array of AgentTools for finding verification
 */
export function createVerifierTools(
	orchestrator: Orchestrator,
	gameId: string,
	projectPath: string,
	filter?: PathFilter,
): AgentTool[] {
	const verifyFinding: AgentTool = {
		name: "verify_finding",
		label: "Verify Finding",
		description:
			"Submit your independent verification of an uncertain finding. CONFIRM if the issue is real, REJECT if it is not.",
		parameters: Type.Object({
			finding_id: Type.Number({ description: "Finding ID to verify" }),
			confirmed: Type.Boolean({
				description:
					"true = issue is real (CONFIRM), false = not valid (REJECT)",
			}),
			explanation: Type.String({ description: "Detailed reasoning" }),
			corrected_issue_type: Type.Optional(
				Type.String({
					description: "Override issue type if confirming with correction",
				}),
			),
			rejection_reason: Type.Optional(
				Type.String({
					description: "Reason for rejection (required when confirmed=false)",
				}),
			),
		}),
		async execute(
			_toolCallId,
			rawParams,
		): Promise<AgentToolResult<{ confirmed: boolean; points: number }>> {
			const params = rawParams as {
				finding_id: number;
				confirmed: boolean;
				explanation: string;
				corrected_issue_type?: string;
				rejection_reason?: string;
			};
			try {
				const result = orchestrator.verifyFinding(
					gameId,
					params.finding_id,
					params.confirmed,
					params.explanation,
					params.corrected_issue_type as IssueType | undefined,
					params.rejection_reason as RejectionReason | undefined,
				);
				return {
					content: [
						{
							type: "text",
							text: `Finding #${params.finding_id} ${result.confirmed ? "CONFIRMED" : "REJECTED"}. Points: ${result.points}`,
						},
					],
					details: result,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error verifying finding: ${(error as Error).message}`,
						},
					],
					details: { confirmed: false, points: 0 },
				};
			}
		},
	};

	return [verifyFinding, createReadFileTool(projectPath, filter)];
}
