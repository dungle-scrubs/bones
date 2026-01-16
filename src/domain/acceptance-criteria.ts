/**
 * Acceptance Criteria for Code Hunt Categories
 *
 * IMPORTANT: No code execution is possible. All validation is based on
 * static analysis and argument quality. Claims cannot be "verified", only
 * evaluated for logical soundness.
 */

import { HuntCategory } from "./types.js";

/**
 * Evidence levels for static analysis claims
 */
export enum EvidenceLevel {
	/** Code path clearly shows the issue - no interpretation needed */
	Obvious = "obvious",
	/** Requires understanding context but conclusion is sound */
	Analytical = "analytical",
	/** Depends on assumptions about runtime state/input */
	Conditional = "conditional",
	/** Requires unlikely conditions or adversarial input */
	Speculative = "speculative",
}

/**
 * What makes a finding VALID (referee accepts)
 */
export interface AcceptanceCriteria {
	/** Minimum evidence level required */
	minEvidence: EvidenceLevel;
	/** What the finding must demonstrate */
	mustShow: string[];
	/** Automatic rejection triggers */
	autoReject: string[];
	/** Edge case rulings */
	edgeCases: EdgeCaseRuling[];
}

export interface EdgeCaseRuling {
	scenario: string;
	ruling: "VALID" | "INVALID";
	reason: string;
}

/**
 * Acceptance criteria by category
 */
export const ACCEPTANCE_CRITERIA: Record<
	HuntCategory,
	AcceptanceCriteria | null
> = {
	[HuntCategory.Bugs]: {
		minEvidence: EvidenceLevel.Analytical,
		mustShow: [
			"Specific code location (file + line range)",
			"What the code does vs what it should do",
			"A plausible trigger scenario (input, state, or sequence)",
			"Why no existing guard prevents this",
		],
		autoReject: [
			"No trigger scenario provided ('this could fail' without how)",
			"Issue prevented by type system (TypeScript strict mode)",
			"Issue prevented by framework guarantees (React, etc.)",
			"Linter-detectable issues (unused vars, imports)",
			"Style preferences disguised as bugs",
			"'Missing feature' framed as bug",
			"Defensive programming suggestions (adding validation to internal APIs that are already validated at boundaries)",
			"Unreachable code paths (internal functions receiving invalid input that public API already validates)",
			"Missing transactions where partial state cannot occur in practice (single-threaded, sequential phases)",
		],
		edgeCases: [
			{
				scenario: "Race condition in async code",
				ruling: "VALID",
				reason: "IF finder shows specific interleaving that causes corruption",
			},
			{
				scenario: "Race condition in async code",
				ruling: "INVALID",
				reason:
					"IF just 'these two things are async' without showing harmful interleaving",
			},
			{
				scenario: "Null/undefined access",
				ruling: "VALID",
				reason:
					"IF TypeScript allows it (no strict null) AND caller can pass null",
			},
			{
				scenario: "Null/undefined access",
				ruling: "INVALID",
				reason: "IF strict null checks enabled OR all callers verified",
			},
			{
				scenario: "Error not handled",
				ruling: "VALID",
				reason: "IF the error causes silent corruption or wrong state",
			},
			{
				scenario: "Error not handled",
				ruling: "INVALID",
				reason: "IF error bubbles up and fails loudly (fail-fast is fine)",
			},
			{
				scenario: "Logic error in edge case",
				ruling: "VALID",
				reason: "IF the edge case is reachable through normal API usage",
			},
			{
				scenario: "Logic error in edge case",
				ruling: "INVALID",
				reason:
					"IF reaching the edge case requires violating function contract",
			},
			{
				scenario: "Missing validation in internal function",
				ruling: "VALID",
				reason: "IF the invalid input can reach it through the public API",
			},
			{
				scenario: "Missing validation in internal function",
				ruling: "INVALID",
				reason:
					"IF public API already validates - internal functions can trust their callers",
			},
			{
				scenario: "Missing transaction around loop",
				ruling: "VALID",
				reason:
					"IF partial completion causes observable corruption in normal operation",
			},
			{
				scenario: "Missing transaction around loop",
				ruling: "INVALID",
				reason:
					"IF failure would only occur from external factors (disk full) that transaction wouldn't help anyway",
			},
		],
	},

	[HuntCategory.DocumentationDrift]: {
		minEvidence: EvidenceLevel.Obvious,
		mustShow: [
			"Exact doc location (file + line) with quoted text",
			"Exact code location (file + line) showing contrary behavior",
			"Evidence snippet in format: DOC: <quote>, CODE: <behavior>, CONTRADICTION: <explanation>",
			"A real contradiction (not just incompleteness)",
		],
		autoReject: [
			"Missing documentation (absence ≠ drift)",
			"Outdated examples that still work",
			"Minor imprecision that doesn't mislead",
			"Typos, grammar, formatting",
			"Version numbers unless they cause real confusion",
			"No evidence snippet provided",
			"Quoted doc text doesn't match actual file content",
			"Code behavior claim not verifiable from cited location",
		],
		edgeCases: [
			{
				scenario: "Docs say 'returns X', code returns 'X | null'",
				ruling: "VALID",
				reason: "Caller might not handle null, this is a contract violation",
			},
			{
				scenario:
					"Docs say 'returns X', code returns 'X | undefined' but only in unreachable case",
				ruling: "INVALID",
				reason: "No practical impact if the undefined path is dead code",
			},
			{
				scenario: "README shows old API, new API is backward compatible",
				ruling: "INVALID",
				reason: "Old usage still works - no one will be misled into failure",
			},
			{
				scenario: "README shows old API, new API breaks old usage",
				ruling: "VALID",
				reason: "Someone following docs will get errors",
			},
			{
				scenario: "JSDoc says param is required, code has default",
				ruling: "INVALID",
				reason: "Code is more permissive than docs - caller won't fail",
			},
			{
				scenario: "JSDoc says param is optional, code throws without it",
				ruling: "VALID",
				reason: "Caller following docs will hit unexpected error",
			},
			{
				scenario:
					"Comment describes algorithm, algorithm changed but comment stale",
				ruling: "VALID",
				reason: "IF comment is wrong about observable behavior",
			},
			{
				scenario:
					"Comment describes algorithm, algorithm changed but comment stale",
				ruling: "INVALID",
				reason: "IF comment is just implementation detail, not API contract",
			},
		],
	},

	[HuntCategory.Security]: {
		minEvidence: EvidenceLevel.Analytical,
		mustShow: [
			"Vulnerability type (injection, XSS, auth bypass, etc.)",
			"Attack vector (how malicious input reaches the vulnerable code)",
			"Impact (what attacker gains)",
			"Why existing sanitization/validation doesn't prevent it",
		],
		autoReject: [
			"No attack vector provided ('this is injectable' without showing path)",
			"Internal tools not exposed to untrusted input",
			"Input already sanitized upstream (must prove it's not)",
			"Dependency CVEs (first-party code only)",
			"Missing security headers without exploit scenario",
			"Theoretical attacks requiring physical access or pre-existing compromise",
		],
		edgeCases: [
			{
				scenario: "SQL built with string concat",
				ruling: "VALID",
				reason: "IF user input flows into that string (show the path)",
			},
			{
				scenario: "SQL built with string concat",
				ruling: "INVALID",
				reason: "IF only internal/hardcoded values used",
			},
			{
				scenario: "eval() or Function() usage",
				ruling: "VALID",
				reason: "IF user input can reach the evaluated string",
			},
			{
				scenario: "eval() or Function() usage",
				ruling: "INVALID",
				reason:
					"IF only internal config/computed values (still note as code smell)",
			},
			{
				scenario: "Secrets in code",
				ruling: "VALID",
				reason: "IF actual secrets (API keys, passwords) - even if 'dev only'",
			},
			{
				scenario: "Secrets in code",
				ruling: "INVALID",
				reason: "IF obviously fake/example values ('xxx', 'changeme', etc.)",
			},
			{
				scenario: "Missing auth check",
				ruling: "VALID",
				reason:
					"IF endpoint is reachable without auth AND does something sensitive",
			},
			{
				scenario: "Missing auth check",
				ruling: "INVALID",
				reason: "IF auth enforced at router/middleware level",
			},
		],
	},

	[HuntCategory.TestCoverage]: {
		minEvidence: EvidenceLevel.Obvious,
		mustShow: [
			"Untested code location (file + function/block)",
			"What behavior is not tested",
			"Why it should be tested (not trivial/generated code)",
		],
		autoReject: [
			"Generated code (protobuf, GraphQL codegen, etc.)",
			"Type definitions without logic",
			"Trivial getters/setters with no logic",
			"Code explicitly marked as not needing tests with justification",
			"Config files",
			"Third-party integration setup (test the integration, not the setup)",
		],
		edgeCases: [
			{
				scenario: "Private helper function not directly tested",
				ruling: "INVALID",
				reason: "IF exercised through public function tests",
			},
			{
				scenario: "Private helper function not directly tested",
				ruling: "VALID",
				reason: "IF the helper has branches not covered by public API tests",
			},
			{
				scenario: "Error handling path not tested",
				ruling: "VALID",
				reason: "IF error handling has logic beyond re-throwing",
			},
			{
				scenario: "Error handling path not tested",
				ruling: "INVALID",
				reason: "IF it just re-throws or logs (testing adds no value)",
			},
			{
				scenario: "Function with 80% branch coverage",
				ruling: "INVALID",
				reason:
					"Partial coverage alone isn't a finding - identify the specific untested branch",
			},
		],
	},

	[HuntCategory.TechDebt]: {
		minEvidence: EvidenceLevel.Analytical,
		mustShow: [
			"Location of the debt (file + lines)",
			"Type of debt (duplication, complexity, dead code, etc.)",
			"Maintainability impact (why this makes the code harder to work with)",
		],
		autoReject: [
			"Style preferences without maintainability impact",
			"Intentional verbosity for clarity (sometimes explicit > clever)",
			"Reasonable trade-offs documented in comments",
			"'Old' code that works fine",
			"Subjective 'I would do it differently'",
		],
		edgeCases: [
			{
				scenario: "Duplicated code blocks",
				ruling: "VALID",
				reason: "IF 3+ copies OR changes to one require finding all others",
			},
			{
				scenario: "Duplicated code blocks",
				ruling: "INVALID",
				reason: "IF only 2 copies AND they're intentionally diverging",
			},
			{
				scenario: "High cyclomatic complexity",
				ruling: "VALID",
				reason: "IF function has 10+ branches AND is hard to reason about",
			},
			{
				scenario: "High cyclomatic complexity",
				ruling: "INVALID",
				reason: "IF complexity is inherent to domain (state machines, parsers)",
			},
			{
				scenario: "TODO/FIXME comment",
				ruling: "VALID",
				reason: "IF it indicates a known bug or incomplete implementation",
			},
			{
				scenario: "TODO/FIXME comment",
				ruling: "INVALID",
				reason: "IF it's aspirational ('TODO: could optimize') with no impact",
			},
			{
				scenario: "Dead code",
				ruling: "VALID",
				reason: "IF code is unreachable (after return, impossible condition)",
			},
			{
				scenario: "Dead code",
				ruling: "INVALID",
				reason: "IF code is unused but reachable (might be future API)",
			},
		],
	},

	[HuntCategory.Custom]: null,
};

/**
 * Format acceptance criteria for inclusion in prompts
 */
export function formatAcceptanceCriteria(
	category: HuntCategory,
): string | null {
	const criteria = ACCEPTANCE_CRITERIA[category];
	if (!criteria) return null;

	const lines: string[] = [];

	lines.push(`## Acceptance Criteria for ${category.toUpperCase()}`);
	lines.push("");
	lines.push(`**Minimum Evidence Level:** ${criteria.minEvidence}`);
	lines.push(
		"(obvious = self-evident, analytical = requires reasoning, conditional = depends on assumptions, speculative = unlikely conditions)",
	);
	lines.push("");

	lines.push("### Finding MUST show:");
	for (const item of criteria.mustShow) {
		lines.push(`- ${item}`);
	}
	lines.push("");

	lines.push("### Automatic REJECTION (don't submit these):");
	for (const item of criteria.autoReject) {
		lines.push(`- ${item}`);
	}
	lines.push("");

	lines.push("### Edge Case Rulings:");
	// Group by scenario for cleaner output
	const grouped = new Map<string, EdgeCaseRuling[]>();
	for (const edge of criteria.edgeCases) {
		const existing = grouped.get(edge.scenario) || [];
		existing.push(edge);
		grouped.set(edge.scenario, existing);
	}

	for (const [scenario, rulings] of grouped) {
		lines.push(`\n**${scenario}:**`);
		for (const r of rulings) {
			const icon = r.ruling === "VALID" ? "✓" : "✗";
			lines.push(`- ${icon} ${r.ruling}: ${r.reason}`);
		}
	}

	return lines.join("\n");
}
