// Game phases - must progress in order
export enum Phase {
	Setup = "setup",
	Hunt = "hunt",
	HuntScoring = "hunt_scoring",
	Review = "review",
	ReviewScoring = "review_scoring",
	Complete = "complete",
}

// Valid phase transitions
export const PHASE_TRANSITIONS: Record<Phase, Phase | null> = {
	[Phase.Setup]: Phase.Hunt,
	[Phase.Hunt]: Phase.HuntScoring,
	[Phase.HuntScoring]: Phase.Review,
	[Phase.Review]: Phase.ReviewScoring,
	[Phase.ReviewScoring]: Phase.Hunt, // loops back, or Complete
	[Phase.Complete]: null,
};

export enum FindingStatus {
	Pending = "pending",
	Valid = "valid",
	FalseFlag = "false_flag",
	Duplicate = "duplicate",
}

export enum DisputeStatus {
	Pending = "pending",
	Successful = "successful",
	Failed = "failed",
}

export enum AgentStatus {
	Active = "active",
	Eliminated = "eliminated",
	Winner = "winner",
}

// Scoring constants
export const SCORING = {
	VALID_FINDING: 1,
	FALSE_FLAG: -2,
	DUPLICATE: -3,
	DISPUTE_WON: 2,
	DISPUTE_LOST: -1,
} as const;

// Default hunt prompt for bug hunting
export const DEFAULT_HUNT_PROMPT = `
Find **real, demonstrable bugs** in this codebase.

**What counts as a legitimate bug:**
- Code that will actually fail/crash under specific conditions
- Security vulnerabilities with a clear exploit path
- Logic errors that produce wrong results
- Resource leaks that occur in practice
- Race conditions with realistic trigger scenarios
- Null/undefined access that actually occurs
- Type mismatches that bypass validation

**What does NOT count:**
- Theoretical issues that require unrealistic conditions
- "Could be a problem if..." speculation
- Style/convention preferences
- Missing features or "could be better" suggestions
- Issues already handled by the runtime or framework

For each finding, you MUST:
1. Identify the exact bug (file, line range)
2. Explain how it manifests (concrete scenario)
3. Show why the code fails (not just "might fail")
`.trim();

// Hunt categories with built-in context
export enum HuntCategory {
	Bugs = "bugs",
	DocumentationDrift = "doc_drift",
	Security = "security",
	TestCoverage = "test_coverage",
	TechDebt = "tech_debt",
	Custom = "custom",
}

// Category-specific context for hunting and validation
export interface CategoryContext {
	description: string;
	validExamples: string[];
	exclusions: string[];
	focusPatterns?: string[];
	discoveryStep?: string; // Instructions to enumerate targets before hunting
	validationGuidance: string;
}

// Built-in category contexts
export const CATEGORY_CONTEXTS: Record<HuntCategory, CategoryContext | null> = {
	[HuntCategory.Bugs]: {
		description: "Find **real, demonstrable bugs** in this codebase.",
		validExamples: [
			"Code that will actually fail/crash under specific conditions",
			"Security vulnerabilities with a clear exploit path",
			"Logic errors that produce wrong results",
			"Resource leaks that occur in practice",
			"Race conditions with realistic trigger scenarios",
			"Null/undefined access that actually occurs",
			"Type mismatches that bypass validation",
		],
		exclusions: [
			"Unused imports or variables (linter responsibility)",
			"Code style or convention preferences",
			"Theoretical issues requiring unrealistic conditions",
			'"Could be a problem if..." speculation',
			'Missing features or "could be better" suggestions',
			"Issues already handled by runtime or framework",
			"Missing error handling that doesn't cause failures",
		],
		validationGuidance:
			"Only validate if the bug demonstrably causes incorrect behavior, crashes, or security issues. Lint/style issues are NOT bugs. Unused code is NOT a bug.",
	},
	[HuntCategory.DocumentationDrift]: {
		description:
			"Find **documentation that contradicts actual code behavior**.",
		validExamples: [
			"README claims a feature exists but it doesn't",
			"CLAUDE.md describes incorrect commands, paths, or configurations",
			"JSDoc/comments describe different behavior than the code implements",
			"API docs show wrong parameters, return types, or error codes",
			"Installation instructions that don't work",
			"Configuration examples with invalid options",
		],
		exclusions: [
			"Minor typos that don't affect understanding",
			"Missing documentation (only *incorrect* docs count)",
			"Formatting or style inconsistencies",
			"Outdated version numbers (unless they cause confusion)",
			"Grammar issues",
			"Submissions without evidence snippet",
		],
		discoveryStep: `**FIRST: Enumerate all documentation in the project.**

Run these searches to find all docs before hunting:
\`\`\`bash
# Find all markdown files
find . -name "*.md" -type f | head -50

# Find documentation directories
find . -type d -name "docs" -o -name "doc" -o -name "documentation" -o -name "wiki" 2>/dev/null

# Find API specs
find . -name "openapi*.json" -o -name "openapi*.yaml" -o -name "swagger*.json" -o -name "swagger*.yaml" 2>/dev/null

# Find config examples
find . -name "*.example" -o -name "*.sample" -o -name "example.*" 2>/dev/null | head -20
\`\`\`

Check each discovered file for contradictions with actual code behavior.`,
		focusPatterns: [
			"README.md, CONTRIBUTING.md, CHANGELOG.md",
			"CLAUDE.md, .cursorrules, AGENTS.md",
			"docs/**, documentation/**, wiki/**",
			".github/*.md (PR/issue templates)",
			"JSDoc/TSDoc comments with @param, @returns, @example",
			"Inline comments describing 'how it works'",
			"OpenAPI/Swagger specs",
			"Config file examples and samples",
		],
		validationGuidance:
			"Only validate if documentation actively contradicts code behavior. Missing docs don't count - only false/incorrect docs. The documentation must be provably wrong, not just incomplete.",
	},
	[HuntCategory.Security]: {
		description: "Find **security vulnerabilities** in this codebase.",
		validExamples: [
			"SQL/NoSQL injection vulnerabilities",
			"Cross-site scripting (XSS) vectors",
			"Authentication or authorization bypass",
			"Sensitive data exposure (secrets, PII leaks)",
			"CSRF vulnerabilities",
			"Path traversal / directory traversal",
			"Insecure deserialization",
			"Command injection",
		],
		exclusions: [
			"Missing security headers (unless exploitable)",
			"Theoretical attacks requiring unrealistic access",
			"Dependencies with CVEs (focus on first-party code)",
			"Missing rate limiting (unless clearly exploitable)",
			"Informational findings with no exploit path",
		],
		validationGuidance:
			"Only validate if there's a clear exploit path. Describe the attack scenario. Theoretical vulnerabilities without realistic exploitation are false positives.",
	},
	[HuntCategory.TestCoverage]: {
		description: "Find **code paths with no test coverage**.",
		validExamples: [
			"Functions with no unit tests",
			"Error handling paths never exercised",
			"Edge cases not covered by existing tests",
			"Critical business logic without tests",
			"Integration points without integration tests",
		],
		exclusions: [
			"Generated code or build artifacts",
			"Configuration files",
			"Type definitions without logic",
			"Simple getters/setters",
			"Code already marked as untestable with justification",
		],
		validationGuidance:
			"Validate if the code path is genuinely untested and should be tested. Trivial code that doesn't need tests is a false positive.",
	},
	[HuntCategory.TechDebt]: {
		description: "Find **technical debt** that impacts maintainability.",
		validExamples: [
			"Dead code that's never executed",
			"Duplicated logic that should be extracted",
			"Overly complex functions (high cyclomatic complexity)",
			"TODO/FIXME comments indicating known issues",
			"Deprecated API usage",
			"Inconsistent patterns within the same codebase",
		],
		exclusions: [
			"Style preferences without maintainability impact",
			"Code that's intentionally simple/verbose for clarity",
			"Reasonable trade-offs documented in comments",
			"Dependencies that are old but working",
		],
		validationGuidance:
			"Validate if the tech debt genuinely impacts maintainability or could cause issues. Subjective style preferences are false positives.",
	},
	[HuntCategory.Custom]: null, // User provides full context
};

// Conflict between user prompt and category exclusions
export interface PromptConflict {
	exclusion: string;
	matchedKeywords: string[];
	promptExcerpt: string;
}

// Result of conflict detection
export interface ConflictDetectionResult {
	hasConflicts: boolean;
	conflicts: PromptConflict[];
}

// Detect conflicts between user prompt and category exclusions
export function detectPromptConflicts(
	category: HuntCategory,
	userPrompt: string | null,
): ConflictDetectionResult {
	const ctx = CATEGORY_CONTEXTS[category];
	if (!ctx || !userPrompt) {
		return { hasConflicts: false, conflicts: [] };
	}

	const conflicts: PromptConflict[] = [];
	const lowerPrompt = userPrompt.toLowerCase();

	for (const exclusion of ctx.exclusions) {
		const keywords = extractConflictKeywords(exclusion);
		const matched = keywords.filter((k) => lowerPrompt.includes(k));

		// Require at least 2 keyword matches or 1 for short exclusions
		const threshold = keywords.length <= 2 ? 1 : 2;
		if (matched.length >= threshold) {
			// Find the excerpt containing the match
			const firstMatch = matched[0];
			const idx = lowerPrompt.indexOf(firstMatch);
			const start = Math.max(0, idx - 20);
			const end = Math.min(userPrompt.length, idx + firstMatch.length + 20);
			const excerpt = userPrompt.slice(start, end);

			conflicts.push({
				exclusion,
				matchedKeywords: matched,
				promptExcerpt:
					(start > 0 ? "..." : "") +
					excerpt +
					(end < userPrompt.length ? "..." : ""),
			});
		}
	}

	return { hasConflicts: conflicts.length > 0, conflicts };
}

// Extract keywords from exclusion text for matching
function extractConflictKeywords(exclusion: string): string[] {
	const stopWords = new Set([
		"a",
		"an",
		"the",
		"is",
		"are",
		"was",
		"were",
		"be",
		"been",
		"being",
		"have",
		"has",
		"had",
		"do",
		"does",
		"did",
		"will",
		"would",
		"could",
		"should",
		"may",
		"might",
		"must",
		"shall",
		"can",
		"need",
		"dare",
		"ought",
		"used",
		"to",
		"of",
		"in",
		"for",
		"on",
		"with",
		"at",
		"by",
		"from",
		"as",
		"into",
		"through",
		"during",
		"before",
		"after",
		"above",
		"below",
		"between",
		"under",
		"again",
		"further",
		"then",
		"once",
		"that",
		"this",
		"these",
		"those",
		"or",
		"and",
		"but",
		"if",
		"because",
		"until",
		"while",
		"although",
		"though",
		"unless",
		"only",
		"already",
		"just",
		"not",
		"no",
		"without",
	]);

	return exclusion
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !stopWords.has(w));
}

// Build the complete hunt prompt from category + user additions
export function buildHuntPrompt(
	category: HuntCategory,
	userPrompt: string | null,
): string {
	const ctx = CATEGORY_CONTEXTS[category];

	// Custom category: user provides everything
	if (!ctx) {
		return userPrompt || "Find issues in this codebase.";
	}

	const parts: string[] = [];

	parts.push(ctx.description);

	// Discovery step comes first if present
	if (ctx.discoveryStep) {
		parts.push("");
		parts.push(ctx.discoveryStep);
	}

	parts.push("");
	parts.push("**What counts:**");
	for (const example of ctx.validExamples) {
		parts.push(`- ${example}`);
	}

	parts.push("");
	parts.push("**What does NOT count (these will be marked false positives):**");
	for (const exclusion of ctx.exclusions) {
		parts.push(`- ${exclusion}`);
	}

	if (ctx.focusPatterns && ctx.focusPatterns.length > 0) {
		parts.push("");
		parts.push("**Where to look:**");
		for (const pattern of ctx.focusPatterns) {
			parts.push(`- ${pattern}`);
		}
	}

	if (userPrompt) {
		parts.push("");
		parts.push("**Additional focus:**");
		parts.push(userPrompt);
	}

	parts.push("");
	parts.push("For each finding, you MUST:");
	parts.push("1. Identify the exact location (file, line range)");
	parts.push("2. Explain how the issue manifests (concrete scenario)");
	parts.push('3. Show why it\'s a problem (not just "might be")');

	return parts.join("\n");
}

// Get validation guidance for referee
export function getValidationGuidance(category: HuntCategory): string | null {
	const ctx = CATEGORY_CONTEXTS[category];
	return ctx?.validationGuidance ?? null;
}

// Configuration for creating a new game
export interface GameConfig {
	projectUrl: string;
	category: HuntCategory;
	userPrompt: string | null; // Additional focus, merged with category context
	targetScore: number;
	huntDuration: number; // seconds
	reviewDuration: number; // seconds
	numAgents: number;
	maxRounds: number; // 0 = no limit, default 3
}

// Agent statistics
export interface AgentStats {
	findingsSubmitted: number;
	findingsValid: number;
	findingsFalse: number;
	findingsDuplicate: number;
	disputesWon: number;
	disputesLost: number;
}

// Scoreboard entry for display
export interface ScoreboardEntry {
	id: string;
	score: number;
	findingsSubmitted: number;
	findingsValid: number;
	findingsFalse: number;
	findingsDuplicate: number;
	disputesWon: number;
	disputesLost: number;
	status: AgentStatus;
}

// Result types for orchestrator operations
export interface SetupResult {
	action: "GAME_CREATED";
	gameId: string;
	agents: string[];
	config: Omit<GameConfig, "projectUrl">;
	next: string;
}

export interface HuntPhaseResult {
	action: "SPAWN_HUNT_AGENTS";
	round: number;
	phase: Phase;
	endsAt: string;
	durationSeconds: number;
	agents: Array<{ agentId: string; prompt: string }>;
	instructions: string[];
}

export interface HuntCheckResult {
	round: number;
	timeExpired: boolean;
	remainingSeconds: number;
	allAgentsFinished: boolean;
	readyForScoring: boolean;
	pending: string[];
	next: string;
}

export interface ScoringPhaseResult {
	action: "VALIDATE_FINDINGS";
	round: number;
	phase: Phase;
	pendingFindings: number;
	findingValidations: Array<{
		findingId: number;
		type: "finding_validation";
		prompt: string;
	}>;
	instructions: string[];
}

export interface ReviewPhaseResult {
	action: "SPAWN_REVIEW_AGENTS";
	round: number;
	phase: Phase;
	endsAt: string;
	durationSeconds: number;
	findingsToReview: number;
	agents: Array<{ agentId: string; prompt: string }>;
	instructions: string[];
}

export interface ReviewCheckResult {
	round: number;
	timeExpired: boolean;
	remainingSeconds: number;
	allAgentsFinished: boolean;
	readyForScoring: boolean;
	pending: string[];
	next: string;
}

export interface DisputeScoringResult {
	action: "RESOLVE_DISPUTES";
	round: number;
	phase: Phase;
	pendingDisputes: number;
	disputeResolutions: Array<{
		disputeId: number;
		findingId: number;
		type: "dispute_resolution";
		prompt: string;
	}>;
	instructions: string[];
}

export interface WinnerCheckResult {
	action: "GAME_COMPLETE" | "TIE_BREAKER" | "CONTINUE";
	winner?: string;
	reason: string;
	finalScores?: ScoreboardEntry[];
	tiedAgents?: string[];
	scores?: ScoreboardEntry[];
	next?: string;
}

// Database row types (for repository layer)
export interface GameRow {
	id: string;
	project_url: string;
	category: string;
	user_prompt: string | null;
	target_score: number;
	hunt_duration: number;
	review_duration: number;
	num_agents: number;
	max_rounds: number;
	current_round: number;
	phase: string;
	phase_ends_at: string | null;
	winner_agent_id: string | null;
	created_at: string;
	completed_at: string | null;
}

export interface AgentRow {
	id: string;
	game_id: string;
	score: number;
	findings_submitted: number;
	findings_valid: number;
	findings_false: number;
	findings_duplicate: number;
	disputes_won: number;
	disputes_lost: number;
	hunt_done_round: number;
	review_done_round: number;
	status: string;
	last_heartbeat: string | null;
	created_at: string;
}

export type Confidence = "high" | "medium" | "low";

export interface FindingRow {
	id: number;
	game_id: string;
	round_number: number;
	agent_id: string;
	description: string;
	file_path: string;
	line_start: number;
	line_end: number;
	code_snippet: string | null;
	pattern_hash: string;
	status: string;
	duplicate_of: number | null;
	referee_verdict: string | null;
	confidence: Confidence | null;
	points_awarded: number;
	created_at: string;
	validated_at: string | null;
}

export interface DisputeRow {
	id: number;
	game_id: string;
	round_number: number;
	finding_id: number;
	disputer_id: string;
	reason: string;
	status: string;
	referee_verdict: string | null;
	points_awarded: number;
	created_at: string;
	resolved_at: string | null;
}
