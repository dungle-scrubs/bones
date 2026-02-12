/**
 * Referee tools — validate findings and resolve disputes.
 * Used by the referee agent during scoring phases.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type {
	Confidence,
	ImpactTier,
	IssueType,
	RejectionReason,
} from "../../domain/types.js";
import type { Orchestrator } from "../../services/Orchestrator.js";
import { createReadFileTool } from "./shared.js";

/**
 * Creates the tool for validating a single finding.
 * The referee uses this to render a verdict on each finding.
 *
 * @param orchestrator - Game orchestrator instance
 * @param gameId - Current game ID
 * @param projectPath - Absolute path to target project
 * @returns Array of AgentTools for finding validation
 */
export function createRefereeValidationTools(
	orchestrator: Orchestrator,
	gameId: string,
	projectPath: string,
): AgentTool[] {
	const validateFinding: AgentTool = {
		name: "validate_finding",
		label: "Validate Finding",
		description:
			"Submit your validation verdict for a finding. Mark as VALID, FALSE, or DUPLICATE.",
		parameters: Type.Object({
			finding_id: Type.Number({ description: "Finding ID to validate" }),
			verdict: Type.Union(
				[
					Type.Literal("VALID"),
					Type.Literal("FALSE"),
					Type.Literal("DUPLICATE"),
				],
				{ description: "Validation verdict" },
			),
			explanation: Type.String({
				description: "Detailed reasoning for verdict",
			}),
			confidence_score: Type.Optional(
				Type.Number({
					description: "Confidence 0-100 (required for VALID/FALSE)",
					minimum: 0,
					maximum: 100,
				}),
			),
			issue_type: Type.Optional(
				Type.String({ description: "Issue type for VALID findings" }),
			),
			impact_tier: Type.Optional(
				Type.Union(
					[
						Type.Literal("critical"),
						Type.Literal("major"),
						Type.Literal("minor"),
					],
					{ description: "Impact severity for VALID findings" },
				),
			),
			needs_verification: Type.Optional(
				Type.Boolean({
					description:
						"Whether a second verification pass is needed (confidence < 70)",
				}),
			),
			rejection_reason: Type.Optional(
				Type.String({ description: "Rejection reason for FALSE findings" }),
			),
			duplicate_of_id: Type.Optional(
				Type.Number({ description: "Original finding ID for DUPLICATE" }),
			),
		}),
		async execute(
			_toolCallId,
			rawParams,
		): Promise<AgentToolResult<{ verdict: string; findingId: number }>> {
			const params = rawParams as {
				finding_id: number;
				verdict: "VALID" | "FALSE" | "DUPLICATE";
				explanation: string;
				confidence_score?: number;
				issue_type?: string;
				impact_tier?: "critical" | "major" | "minor";
				needs_verification?: boolean;
				rejection_reason?: string;
				duplicate_of_id?: number;
			};
			try {
				// Map confidence score to legacy confidence level
				const score = params.confidence_score ?? 80;
				const confidence: Confidence =
					score >= 90 ? "high" : score >= 70 ? "medium" : "low";

				const result = orchestrator.validateFinding(
					gameId,
					params.finding_id,
					params.verdict,
					params.explanation,
					confidence,
					params.duplicate_of_id,
					params.confidence_score,
					params.issue_type as IssueType | undefined,
					params.impact_tier as ImpactTier | undefined,
					params.rejection_reason as RejectionReason | undefined,
					params.needs_verification,
				);

				return {
					content: [
						{
							type: "text",
							text: `Finding #${params.finding_id} validated as ${result.verdict}.${
								result.duplicateOfId
									? ` Duplicate of #${result.duplicateOfId}.`
									: ""
							}${result.needsVerification ? " Flagged for verification." : ""}`,
						},
					],
					details: { verdict: result.verdict, findingId: params.finding_id },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error validating finding: ${(error as Error).message}`,
						},
					],
					details: { verdict: "ERROR", findingId: params.finding_id },
				};
			}
		},
	};

	return [validateFinding, createReadFileTool(projectPath)];
}

/**
 * Creates the tool for resolving a single dispute.
 *
 * @param orchestrator - Game orchestrator instance
 * @param gameId - Current game ID
 * @param projectPath - Absolute path to target project
 * @returns Array of AgentTools for dispute resolution
 */
export function createRefereeResolutionTools(
	orchestrator: Orchestrator,
	gameId: string,
	projectPath: string,
): AgentTool[] {
	const resolveDispute: AgentTool = {
		name: "resolve_dispute",
		label: "Resolve Dispute",
		description:
			"Submit your resolution for a dispute. SUCCESSFUL means the disputer was right (finding invalid). FAILED means the finding was correct.",
		parameters: Type.Object({
			dispute_id: Type.Number({ description: "Dispute ID to resolve" }),
			verdict: Type.Union(
				[Type.Literal("SUCCESSFUL"), Type.Literal("FAILED")],
				{ description: "Resolution verdict" },
			),
			explanation: Type.String({ description: "Detailed reasoning" }),
		}),
		async execute(
			_toolCallId,
			rawParams,
		): Promise<AgentToolResult<{ verdict: string; disputeId: number }>> {
			const params = rawParams as {
				dispute_id: number;
				verdict: "SUCCESSFUL" | "FAILED";
				explanation: string;
			};
			try {
				orchestrator.resolveDispute(
					gameId,
					params.dispute_id,
					params.verdict,
					params.explanation,
				);
				return {
					content: [
						{
							type: "text",
							text: `Dispute #${params.dispute_id} resolved as ${params.verdict}.`,
						},
					],
					details: { verdict: params.verdict, disputeId: params.dispute_id },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error resolving dispute: ${(error as Error).message}`,
						},
					],
					details: { verdict: "ERROR", disputeId: params.dispute_id },
				};
			}
		},
	};

	return [resolveDispute, createReadFileTool(projectPath)];
}
