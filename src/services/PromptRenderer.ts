import {
	ACCEPTANCE_CRITERIA,
	formatAcceptanceCriteria,
} from "../domain/acceptance-criteria.js";
import type { Finding } from "../domain/Finding.js";
import type { HuntCategory, ScoreboardEntry } from "../domain/types.js";

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
	existingFindings: Finding[]; // Validated findings from previous rounds
}

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

export class PromptRenderer {
	renderHunt(vars: HuntPromptVars): string {
		const scoreboard = this.formatScoreboard(vars.scoreboard);
		const existingFindingsList = this.formatExistingFindings(
			vars.existingFindings,
		);
		const acceptanceCriteria = formatAcceptanceCriteria(vars.category) || "";

		return `# Code Hunt - Round ${vars.round}

## ⚠️ PENALTY WARNING - READ THIS FIRST
| Outcome | Points | What it means |
|---------|--------|---------------|
| Valid finding | **+1** | Confirmed real issue |
| False positive | **-2** | You lose 2 points - wipes out 2 valid findings |
| Duplicate | **-3** | You lose 3 points - wipes out 3 valid findings |

**STOP AND THINK:** Is this finding worth the risk? One mistake costs more than multiple successes.

## Game Info
- **Game ID:** ${vars.gameId}
- **Your Agent ID:** ${vars.agentId}
- **Category:** ${vars.category}
- **Target Score:** ${vars.targetScore}
- **Phase Ends:** ${vars.phaseEndsAt}
- **Project:** ${vars.projectUrl}
- **Your Score:** ${vars.yourScore}

## 🚫 ALREADY FOUND - DO NOT RESUBMIT
These issues have already been validated. Submitting any of these = **-3 points**.
${existingFindingsList}

## Your Mission
${vars.huntPrompt}

${acceptanceCriteria}

## Commands
\`\`\`bash
# Submit a finding${vars.category === "doc_drift" ? " (snippet REQUIRED for doc_drift)" : ""}
${vars.scriptsPath}/submit.sh ${vars.gameId} ${vars.agentId} <file_path> <line_start> <line_end> "<description>"${vars.category === "doc_drift" ? ' "<snippet>"' : ""}

# Mark hunt complete
${vars.scriptsPath}/done.sh ${vars.gameId} ${vars.agentId} hunt
\`\`\`${vars.category === "doc_drift" ? `

## ⚠️ REQUIRED EVIDENCE FORMAT (doc_drift)
Every submission MUST include a snippet with this exact format:
\`\`\`
DOC: <exact quote from documentation file>
CODE: <actual code behavior with file:line reference>
CONTRADICTION: <specific mismatch explanation>
\`\`\`

**Before submitting:**
1. Read the documentation file to get the EXACT text
2. Read the code file to verify the ACTUAL behavior
3. Include both in your snippet - the referee will verify both

Submissions without proper evidence will be rejected.` : ""}

## Current Scoreboard
${scoreboard}

**Remember: 3 valid findings + 1 duplicate = NET ZERO. Quality over quantity.**
`;
	}

	renderReview(vars: ReviewPromptVars): string {
		const scoreboard = this.formatScoreboard(vars.scoreboard);
		const findings = this.formatFindings(vars.findings);

		return `# Code Hunt - Review Phase - Round ${vars.round}

## Game Info
- **Game ID:** ${vars.gameId}
- **Your Agent ID:** ${vars.agentId}
- **Target Score:** ${vars.targetScore}
- **Phase Ends:** ${vars.phaseEndsAt}
- **Project:** ${vars.projectUrl}

## Your Mission
Review the validated findings below. If you believe any finding is invalid or incorrect, file a dispute with your reasoning.

## Findings to Review
${findings}

## Current Scoreboard
${scoreboard}

**Your Score:** ${vars.yourScore}

## Instructions
1. Review each finding carefully
2. Check the actual code at the specified location
3. If a finding is incorrect, file a dispute
4. Call done when finished reviewing

## Commands
\`\`\`bash
# Dispute a finding
${vars.scriptsPath}/dispute.sh ${vars.gameId} ${vars.agentId} <finding_id> "<reason>"

# Mark review complete
${vars.scriptsPath}/done.sh ${vars.gameId} ${vars.agentId} review
\`\`\`

Successful disputes earn points. Failed disputes cost points.
`;
	}

	renderFindingValidation(vars: FindingValidationVars): string {
		const criteria = ACCEPTANCE_CRITERIA[vars.category];
		const edgeCaseSection = this.formatEdgeCasesForReferee(vars.category);

		// doc_drift gets a specialized verification prompt
		if (vars.category === "doc_drift") {
			return this.renderDocDriftValidation(vars, criteria, edgeCaseSection);
		}

		return `# Finding Validation

## Finding Details
- **Finding ID:** ${vars.findingId}
- **Submitted by:** ${vars.agentId}
- **File:** ${vars.filePath}
- **Lines:** ${vars.lineStart}-${vars.lineEnd}
- **Category:** ${vars.category}

## Description
${vars.description}

${vars.codeSnippet ? `## Code Snippet\n\`\`\`\n${vars.codeSnippet}\n\`\`\`` : ""}

## Validation Rules for ${vars.category.toUpperCase()}

### Finding must demonstrate:
${criteria?.mustShow.map((s) => `- ${s}`).join("\n") || "- Specific issue with clear evidence"}

### Automatic FALSE (reject these):
${criteria?.autoReject.map((s) => `- ${s}`).join("\n") || "- Speculative issues without evidence"}

${edgeCaseSection}

## Task
Read the actual code at ${vars.projectUrl}. Navigate to ${vars.filePath}:${vars.lineStart}-${vars.lineEnd}.

Evaluate against the criteria above. This is STATIC ANALYSIS - no code execution.
The claim cannot be "verified", only evaluated for logical soundness.

## Verdict Guidelines
- **VALID** = Finding demonstrates the issue with sufficient evidence per criteria above
- **FALSE** = Finding fails to meet criteria OR is an auto-reject case
- **DUPLICATE** = Same issue already reported (provide duplicate_of_id)

For VALID findings, assess confidence:
- **high**: Issue is obvious from code, no assumptions needed
- **medium**: Issue is sound but requires understanding context
- **low**: Issue depends on runtime assumptions

## Command
\`\`\`bash
${vars.scriptsPath}/validate.sh ${vars.gameId} ${vars.findingId} <VALID|FALSE|DUPLICATE> "<explanation>" [high|medium|low] [duplicate_of_id]
\`\`\`
`;
	}

	private renderDocDriftValidation(
		vars: FindingValidationVars,
		criteria: (typeof ACCEPTANCE_CRITERIA)[keyof typeof ACCEPTANCE_CRITERIA],
		edgeCaseSection: string,
	): string {
		return `# Documentation Drift Verification

**You are a VERIFIER, not an evaluator.** Your job is to independently confirm the evidence.

## Finding Details
- **Finding ID:** ${vars.findingId}
- **Submitted by:** ${vars.agentId}
- **Documentation File:** ${vars.filePath}
- **Lines:** ${vars.lineStart}-${vars.lineEnd}

## Agent's Claimed Evidence
${vars.codeSnippet ? `\`\`\`\n${vars.codeSnippet}\n\`\`\`` : "*No evidence snippet provided - AUTOMATIC FALSE*"}

## Description
${vars.description}

## ⚠️ VERIFICATION REQUIRED - DO NOT TRUST CLAIMS

You MUST independently verify both sides of the claimed contradiction:

### Step 1: Verify the Documentation Claim
Read the actual documentation at ${vars.filePath}:${vars.lineStart}-${vars.lineEnd}

- Does the file exist?
- Do lines ${vars.lineStart}-${vars.lineEnd} contain what the agent quoted in "DOC:"?
- Quote the ACTUAL text you find

### Step 2: Verify the Code Claim
The agent's description should reference a code file showing contrary behavior.

- Read the code file referenced
- Does the code actually do what the agent claims in "CODE:"?
- Quote the ACTUAL code behavior

### Step 3: Assess Contradiction
Only if BOTH verifications match the agent's claims:
- Is there a real contradiction that would mislead a user?
- Or is the doc just incomplete/imprecise without being wrong?

## Validation Rules

### Finding must demonstrate:
${criteria?.mustShow.map((s: string) => `- ${s}`).join("\n") || "- Specific issue with clear evidence"}

### Automatic FALSE (reject these):
${criteria?.autoReject.map((s: string) => `- ${s}`).join("\n") || "- Speculative issues without evidence"}
- Agent's quoted text doesn't match actual file content
- Code reference missing or doesn't support the claim
- No evidence snippet provided

${edgeCaseSection}

## Verdict Guidelines
- **VALID** = You verified both DOC and CODE match agent's claims AND there's a real contradiction
- **FALSE** = Agent's evidence doesn't match reality OR no real contradiction exists
- **DUPLICATE** = Same contradiction already reported (provide duplicate_of_id)

**CRITICAL:** If you cannot find the quoted text at the specified location, the finding is FALSE regardless of whether a similar issue exists elsewhere.

## Command
\`\`\`bash
${vars.scriptsPath}/validate.sh ${vars.gameId} ${vars.findingId} <VALID|FALSE|DUPLICATE> "<explanation>" [high|medium|low] [duplicate_of_id]
\`\`\`
`;
	}

	private formatEdgeCasesForReferee(category: HuntCategory): string {
		const criteria = ACCEPTANCE_CRITERIA[category];
		if (!criteria?.edgeCases.length) return "";

		const lines: string[] = ["### Edge Case Rulings (apply these):", ""];

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

	renderDisputeResolution(vars: DisputeResolutionVars): string {
		return `# Dispute Resolution

## Dispute Details
- **Dispute ID:** ${vars.disputeId}
- **Finding ID:** ${vars.findingId}
- **Disputer:** ${vars.disputerId}
- **Original Finder:** ${vars.finderId}

## Original Finding
- **File:** ${vars.filePath}
- **Lines:** ${vars.lineStart}-${vars.lineEnd}
- **Description:** ${vars.findingDescription}

${vars.codeSnippet ? `## Code Snippet\n\`\`\`\n${vars.codeSnippet}\n\`\`\`` : ""}

## Dispute Reason
${vars.disputeReason}

## Task
Resolve this dispute. Determine if the disputer is correct.

## Instructions
1. Review the original finding
2. Evaluate the dispute reason
3. Check the actual code
4. Determine if the dispute is valid

## Command
\`\`\`bash
# Submit resolution
${vars.scriptsPath}/resolve.sh ${vars.gameId} ${vars.disputeId} <SUCCESSFUL|FAILED> "<explanation>"
\`\`\`

SUCCESSFUL = Disputer was right, finding is invalid
FAILED = Finding was correct, dispute fails
`;
	}

	private formatScoreboard(entries: ScoreboardEntry[]): string {
		if (entries.length === 0) return "_No agents yet_";

		const header = "| Rank | Agent | Score | Valid | False | Dup | Disputes |";
		const separator =
			"|------|-------|-------|-------|-------|-----|----------|";

		const rows = entries.map((e, i) => {
			const disputes = `${e.disputesWon}W/${e.disputesLost}L`;
			return `| ${i + 1} | ${e.id} | ${e.score} | ${e.findingsValid} | ${e.findingsFalse} | ${e.findingsDuplicate} | ${disputes} |`;
		});

		return [header, separator, ...rows].join("\n");
	}

	private formatFindings(findings: Finding[]): string {
		if (findings.length === 0) return "_No findings to review_";

		return findings
			.map(
				(f) => `### Finding #${f.id}
- **File:** ${f.filePath}
- **Lines:** ${f.lineStart}-${f.lineEnd}
- **By:** ${f.agentId}
- **Description:** ${f.description}
`,
			)
			.join("\n");
	}

	private formatExistingFindings(findings: Finding[]): string {
		if (findings.length === 0) return "_No validated findings yet_";

		// Group by file for easier scanning
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
				lines.push(`- Lines ${f.lineStart}-${f.lineEnd}: ${desc}`);
			}
		}

		return lines.join("\n");
	}
}
