import {
	ACCEPTANCE_CRITERIA,
	formatAcceptanceCriteria,
} from "../domain/acceptance-criteria.js";
import type { Finding } from "../domain/Finding.js";
import {
	type HuntCategory,
	ISSUE_TYPES_BY_CATEGORY,
	type IssueType,
	RejectionReason,
	type ScoreboardEntry,
} from "../domain/types.js";

/** Variables needed to render a hunt phase prompt for an agent. */
export interface HuntPromptVars {
	gameId: string;
	agentId: string;
	round: number;
	phaseEndsAt: string;
	targetScore: number;
	projectUrl: string;
	huntPrompt: string;
	category: HuntCategory;
	scoreboard: ScoreboardEntry[];
	yourScore: number;
	scriptsPath: string;
	existingFindings: Finding[];
}

/** Variables needed to render a review phase prompt for an agent. */
export interface ReviewPromptVars {
	gameId: string;
	agentId: string;
	round: number;
	phaseEndsAt: string;
	targetScore: number;
	projectUrl: string;
	findings: Finding[];
	scoreboard: ScoreboardEntry[];
	yourScore: number;
	scriptsPath: string;
}

/** Variables needed to render a finding validation prompt for the referee. */
export interface FindingValidationVars {
	gameId: string;
	findingId: number;
	agentId: string;
	description: string;
	filePath: string;
	lineStart: number;
	lineEnd: number;
	codeSnippet: string | null;
	projectUrl: string;
	scriptsPath: string;
	category: HuntCategory;
}

/** Variables needed to render a dispute resolution prompt for the referee. */
export interface DisputeResolutionVars {
	gameId: string;
	disputeId: number;
	findingId: number;
	disputerId: string;
	finderId: string;
	findingDescription: string;
	disputeReason: string;
	filePath: string;
	lineStart: number;
	lineEnd: number;
	codeSnippet: string | null;
	projectUrl: string;
	scriptsPath: string;
}

/** Variables needed to render a verification prompt for uncertain findings. */
export interface VerificationPromptVars {
	gameId: string;
	findingId: number;
	agentId: string;
	description: string;
	filePath: string;
	lineStart: number;
	lineEnd: number;
	codeSnippet: string | null;
	projectUrl: string;
	scriptsPath: string;
	category: HuntCategory;
	originalVerdict: string;
	confidenceScore: number;
	issueType: IssueType | null;
}

/**
 * Generates markdown prompts for agents and referee during game phases.
 * All prompts reference tool names (submit_finding, view_file, etc.)
 * rather than shell scripts.
 */
export class PromptRenderer {
	/**
	 * Generates the hunt phase prompt for an agent.
	 * Tells the agent to use submit_finding and mark_done tools.
	 */
	renderHunt(vars: HuntPromptVars): string {
		const scoreboard = this.formatScoreboard(vars.scoreboard);
		const existingFindingsList = this.formatExistingFindings(
			vars.existingFindings,
		);
		const acceptanceCriteria = formatAcceptanceCriteria(vars.category) || "";

		return `# Bones — Hunt Phase, Round ${vars.round}

## How the Game Works

You are competing against other agents to find bugs. Here's the full flow:

1. **HUNT (now)** — You search the codebase and submit findings. This phase is TIMED.
2. **REFEREE** — A separate judge validates each finding. You are NOT penalized instantly.
3. **REVIEW** — Other agents try to dispute your valid findings.
4. **SCORING** — First agent to **${vars.targetScore} points** wins.

**Submitting 0 findings = guaranteed loss.** You cannot win without submissions.

## Points (awarded AFTER referee validates)
| Outcome | Points |
|---------|--------|
| Valid finding | **+1** |
| False positive | **-2** |
| Duplicate of existing | **-3** |

## Game State
- **You:** ${vars.agentId} | **Score:** ${vars.yourScore} | **Target:** ${vars.targetScore}
- **Category:** ${vars.category} | **Round:** ${vars.round}
- **Project:** ${vars.projectUrl}

## Scoreboard
${scoreboard}

## Already Found — DO NOT RESUBMIT (costs -3)
${existingFindingsList}

## Mission
${vars.huntPrompt}

${acceptanceCriteria}

## Tools

1. **view_file** — Read file contents (with optional start_line/end_line)
2. **search_code** — Grep the codebase for patterns
3. **submit_finding** — Submit a bug with file_path, line_start, line_end, description${vars.category === "doc_drift" ? ", and code_snippet (REQUIRED)" : ""}
4. **mark_done** — Signal you're finished hunting

## Strategy

This is a TIMED COMPETITION. Work fast:
- Read a file → spot an issue → **submit immediately** → move on
- Aim for **5+ findings**. Volume wins — the referee sorts out validity later.
- Don't over-analyze. If you're 70%+ confident, submit it.
- **Never** spend more than 3 turns reading without submitting something.
- Call **mark_done** when finished.
${
	vars.category === "doc_drift"
		? `
## Evidence Format (doc_drift — REQUIRED)
Every submission MUST include a code_snippet with this format:
\`\`\`
DOC: <exact quote from documentation>
CODE: <actual code behavior with file:line>
CONTRADICTION: <specific mismatch>
\`\`\`
`
		: ""
}
`;
	}

	/**
	 * Generates the review phase prompt for an agent.
	 * Tells the agent to use submit_dispute and mark_done tools.
	 */
	renderReview(vars: ReviewPromptVars): string {
		const scoreboard = this.formatScoreboard(vars.scoreboard);
		const findings = this.formatFindings(vars.findings);

		return `# Bones — Review Phase, Round ${vars.round}

## Game State
- **Game:** ${vars.gameId}
- **You:** ${vars.agentId}
- **Target Score:** ${vars.targetScore}
- **Your Score:** ${vars.yourScore}
- **Project:** ${vars.projectUrl}

## Scoreboard
${scoreboard}

## Findings to Review
${findings}

## How to Play

You have these tools:

1. **view_file** — Read file contents to verify claims
2. **search_code** — Search the codebase
3. **submit_dispute** — Challenge a finding with finding_id and reason
4. **mark_done** — Signal you're finished reviewing

**Strategy:** For each finding, read the actual code at the referenced location.
If the finding is wrong, dispute it. Successful disputes earn **+2**, failed disputes cost **-1**.

Call **mark_done** when finished.
`;
	}

	/**
	 * Generates a finding validation prompt for the referee.
	 * Tells the referee to use validate_finding tool.
	 */
	renderFindingValidation(vars: FindingValidationVars): string {
		const criteria = ACCEPTANCE_CRITERIA[vars.category];
		const edgeCaseSection = this.formatEdgeCasesForReferee(vars.category);

		if (vars.category === "doc_drift") {
			return this.renderDocDriftValidation(vars, criteria, edgeCaseSection);
		}

		const issueTypes = ISSUE_TYPES_BY_CATEGORY[vars.category];
		const issueTypeList =
			issueTypes.length > 0
				? issueTypes.map((t) => `\`${t}\``).join(", ")
				: "free-form string for custom category";

		const rejectionReasons = Object.values(RejectionReason)
			.map((r) => `\`${r}\``)
			.join(", ");

		return `# Finding Validation

## Finding
- **ID:** ${vars.findingId}
- **By:** ${vars.agentId}
- **File:** ${vars.filePath}
- **Lines:** ${vars.lineStart}–${vars.lineEnd}
- **Category:** ${vars.category}

## Description
${vars.description}

${vars.codeSnippet ? `## Code Snippet\n\`\`\`\n${vars.codeSnippet}\n\`\`\`` : ""}

## Validation Rules (${vars.category})

### Must demonstrate:
${criteria?.mustShow.map((s) => `- ${s}`).join("\n") || "- Specific issue with clear evidence"}

### Automatic FALSE:
${criteria?.autoReject.map((s) => `- ${s}`).join("\n") || "- Speculative issues without evidence"}

${edgeCaseSection}

## Task
Use **view_file** to read ${vars.filePath} lines ${vars.lineStart}–${vars.lineEnd}. Evaluate the finding.

This is STATIC ANALYSIS — no code execution. Evaluate logical soundness only.

## Verdicts
- **VALID** — Issue is real and meets criteria
- **FALSE** — Fails criteria or is an auto-reject case
- **DUPLICATE** — Same issue already reported (set duplicate_of_id)

## Classification

**For VALID findings:**
- confidence_score (0–100): 90+ obvious, 70–89 needs context, 50–69 assumption-dependent, <50 likely FALSE
- issue_type: ${issueTypeList}
- impact_tier: \`critical\` | \`major\` | \`minor\`
- needs_verification: true if confidence < 70

**For FALSE findings:**
- rejection_reason: ${rejectionReasons}

Use the **validate_finding** tool with your verdict.
`;
	}

	/**
	 * Specialized validation prompt for doc_drift findings.
	 * Requires independent verification of both doc and code claims.
	 */
	private renderDocDriftValidation(
		vars: FindingValidationVars,
		criteria: (typeof ACCEPTANCE_CRITERIA)[keyof typeof ACCEPTANCE_CRITERIA],
		edgeCaseSection: string,
	): string {
		return `# Documentation Drift Verification

**You are a VERIFIER.** Independently confirm the evidence.

## Finding
- **ID:** ${vars.findingId}
- **By:** ${vars.agentId}
- **Doc File:** ${vars.filePath}
- **Lines:** ${vars.lineStart}–${vars.lineEnd}

## Agent's Evidence
${vars.codeSnippet ? `\`\`\`\n${vars.codeSnippet}\n\`\`\`` : "*No evidence provided — AUTOMATIC FALSE*"}

## Description
${vars.description}

## Verification Steps

1. **Verify docs:** Use **view_file** to read ${vars.filePath}:${vars.lineStart}–${vars.lineEnd}. Does the quoted DOC text match?
2. **Verify code:** Read the referenced code file. Does it behave as the agent's CODE claim says?
3. **Assess contradiction:** Is there a real contradiction that would mislead a user?

### Must demonstrate:
${criteria?.mustShow.map((s: string) => `- ${s}`).join("\n") || "- Specific issue with clear evidence"}

### Automatic FALSE:
${criteria?.autoReject.map((s: string) => `- ${s}`).join("\n") || "- Speculative issues without evidence"}
- Agent's quoted text doesn't match actual file
- Code reference missing or doesn't support claim
- No evidence snippet provided

${edgeCaseSection}

## Verdicts
- **VALID** — Both DOC and CODE verified, real contradiction exists
- **FALSE** — Evidence doesn't match reality or no real contradiction
- **DUPLICATE** — Same contradiction already reported (set duplicate_of_id)

Use the **validate_finding** tool with your verdict.
`;
	}

	/** Formats edge case rulings as a markdown section for referee prompts. */
	private formatEdgeCasesForReferee(category: HuntCategory): string {
		const criteria = ACCEPTANCE_CRITERIA[category];
		if (!criteria?.edgeCases.length) return "";

		const lines: string[] = ["### Edge Case Rulings:", ""];

		const grouped = new Map<string, { valid: string[]; invalid: string[] }>();
		for (const edge of criteria.edgeCases) {
			const existing = grouped.get(edge.scenario) || { valid: [], invalid: [] };
			if (edge.ruling === "VALID") {
				existing.valid.push(edge.reason);
			} else {
				existing.invalid.push(edge.reason);
			}
			grouped.set(edge.scenario, existing);
		}

		for (const [scenario, rulings] of grouped) {
			lines.push(`**${scenario}:**`);
			for (const r of rulings.valid) {
				lines.push(`  ✓ VALID ${r}`);
			}
			for (const r of rulings.invalid) {
				lines.push(`  ✗ FALSE ${r}`);
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	/**
	 * Generates a dispute resolution prompt for the referee.
	 * Tells the referee to use resolve_dispute tool.
	 */
	renderDisputeResolution(vars: DisputeResolutionVars): string {
		return `# Dispute Resolution

## Dispute
- **Dispute ID:** ${vars.disputeId}
- **Finding ID:** ${vars.findingId}
- **Disputer:** ${vars.disputerId}
- **Original Finder:** ${vars.finderId}

## Original Finding
- **File:** ${vars.filePath}
- **Lines:** ${vars.lineStart}–${vars.lineEnd}
- **Description:** ${vars.findingDescription}

${vars.codeSnippet ? `## Code Snippet\n\`\`\`\n${vars.codeSnippet}\n\`\`\`` : ""}

## Dispute Reason
${vars.disputeReason}

## Task
1. Use **view_file** to read the code at ${vars.filePath}:${vars.lineStart}–${vars.lineEnd}
2. Evaluate the original finding against the dispute
3. Use the **resolve_dispute** tool with your verdict

**SUCCESSFUL** = Disputer was right, finding is invalid
**FAILED** = Finding was correct, dispute fails
`;
	}

	/**
	 * Generates a verification prompt for findings needing a second opinion.
	 * Tells the verifier to use verify_finding tool.
	 */
	renderVerificationPrompt(vars: VerificationPromptVars): string {
		const issueTypes = ISSUE_TYPES_BY_CATEGORY[vars.category];
		const issueTypeList =
			issueTypes.length > 0
				? issueTypes.map((t) => `\`${t}\``).join(", ")
				: "free-form string";

		const rejectionReasons = Object.values(RejectionReason)
			.map((r) => `\`${r}\``)
			.join(", ");

		return `# Finding Verification

**You are an INDEPENDENT VERIFIER.**

## Finding
- **ID:** ${vars.findingId}
- **By:** ${vars.agentId}
- **File:** ${vars.filePath}
- **Lines:** ${vars.lineStart}–${vars.lineEnd}
- **Category:** ${vars.category}
- **Initial Confidence:** ${vars.confidenceScore}/100
- **Initial Issue Type:** ${vars.issueType ?? "unknown"}

## Description
${vars.description}

${vars.codeSnippet ? `## Code Snippet\n\`\`\`\n${vars.codeSnippet}\n\`\`\`` : ""}

## Original Referee Assessment
${vars.originalVerdict}

## Task

The initial referee was uncertain. Independently verify:

1. Use **view_file** to read ${vars.filePath}:${vars.lineStart}–${vars.lineEnd}
2. Determine if the claimed issue is real

### Valid Issues (CONFIRM)
- Wrong output, data corruption, crashes
- Security vulnerability with exploit path
- Logic error producing wrong results
- Race condition with realistic trigger
- Documentation contradicts actual behavior

### Invalid (REJECT) — reasons:
${rejectionReasons.split(", ").map((r) => `- ${r}`).join("\n")}

Use the **verify_finding** tool:
- **CONFIRM** with explanation (and optional corrected issue_type: ${issueTypeList})
- **REJECT** with explanation and rejection_reason
`;
	}

	/** Formats scoreboard entries as a markdown table. */
	private formatScoreboard(entries: ScoreboardEntry[]): string {
		if (entries.length === 0) return "_No scores yet_";

		const header = "| Rank | Agent | Score | Valid | False | Dup | Disputes |";
		const separator =
			"|------|-------|-------|-------|-------|-----|----------|";

		const rows = entries.map((e, i) => {
			const disputes = `${e.disputesWon}W/${e.disputesLost}L`;
			return `| ${i + 1} | ${e.id} | ${e.score} | ${e.findingsValid} | ${e.findingsFalse} | ${e.findingsDuplicate} | ${disputes} |`;
		});

		return [header, separator, ...rows].join("\n");
	}

	/** Formats findings as markdown sections for review prompts. */
	private formatFindings(findings: Finding[]): string {
		if (findings.length === 0) return "_No findings to review_";

		return findings
			.map(
				(f) => `### Finding #${f.id}
- **File:** ${f.filePath}
- **Lines:** ${f.lineStart}–${f.lineEnd}
- **By:** ${f.agentId}
- **Description:** ${f.description}
`,
			)
			.join("\n");
	}

	/** Formats existing findings grouped by file to warn agents of duplicates. */
	private formatExistingFindings(findings: Finding[]): string {
		if (findings.length === 0) return "_None yet_";

		const byFile = new Map<string, Finding[]>();
		for (const f of findings) {
			const existing = byFile.get(f.filePath) || [];
			existing.push(f);
			byFile.set(f.filePath, existing);
		}

		const lines: string[] = [];
		for (const [filePath, fileFindings] of byFile) {
			const shortPath = filePath.split("/").slice(-2).join("/");
			lines.push(`\n**${shortPath}:**`);
			for (const f of fileFindings) {
				const desc =
					f.description.length > 80
						? `${f.description.slice(0, 80)}...`
						: f.description;
				lines.push(`- Lines ${f.lineStart}–${f.lineEnd}: ${desc}`);
			}
		}

		return lines.join("\n");
	}
}
