/**
 * Game phases that define the state machine for a Bones session.
 * Phases progress in order with ReviewScoring looping back to Hunt for new rounds.
 */
export enum Phase {
	Setup = "setup",
	Hunt = "hunt",
	HuntScoring = "hunt_scoring",
	Review = "review",
	ReviewScoring = "review_scoring",
	Complete = "complete",
}

/**
 * Maps each phase to its valid next phase, defining the game state machine.
 * ReviewScoring can transition to either Hunt (new round) or Complete (game over).
 */
export const PHASE_TRANSITIONS: Record<Phase, Phase | null> = {
	[Phase.Setup]: Phase.Hunt,
	[Phase.Hunt]: Phase.HuntScoring,
	[Phase.HuntScoring]: Phase.Review,
	[Phase.Review]: Phase.ReviewScoring,
	[Phase.ReviewScoring]: Phase.Hunt, // loops back, or Complete
	[Phase.Complete]: null,
};

/** Status of a finding after referee validation. */
export enum FindingStatus {
	Pending = "pending",
	Valid = "valid",
	FalseFlag = "false_flag",
	Duplicate = "duplicate",
}

/** Status of a dispute after referee resolution. */
export enum DisputeStatus {
	Pending = "pending",
	Successful = "successful",
	Failed = "failed",
}

/** Lifecycle status of an agent in the game. */
export enum AgentStatus {
	Active = "active",
	Eliminated = "eliminated",
	Winner = "winner",
}

/**
 * Point values for different game outcomes.
 * Designed to reward accuracy and penalize spam/duplicates.
 */
export const SCORING = {
	VALID_FINDING: 1,
	FALSE_FLAG: -2,
	DUPLICATE: -3,
	DISPUTE_WON: 2,
	DISPUTE_LOST: -1,
} as const;

/** Default hunt prompt used when category is 'bugs' with no custom context. */
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

/**
 * Predefined hunt categories with built-in prompts and validation guidance.
 * Each category focuses agents on a specific type of issue (bugs, security, etc.).
 */
export enum HuntCategory {
	Bugs = "bugs",
	DocumentationDrift = "doc_drift",
	Security = "security",
	TestCoverage = "test_coverage",
	TechDebt = "tech_debt",
	Custom = "custom",
}

/**
 * Configuration for a hunt category defining what counts as valid/invalid.
 * Used to generate agent prompts and guide referee validation.
 */
export interface CategoryContext {
	description: string;
	validExamples: string[];
	exclusions: string[];
	focusPatterns?: string[];
	/** Instructions to enumerate targets before hunting (e.g., find all docs first). */
	discoveryStep?: string;
	validationGuidance: string;
}

/**
 * Built-in category contexts with curated prompts for common hunt types.
 * Custom category has null context - user provides everything.
 */
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

/**
 * Represents a detected conflict between user's focus prompt and category exclusions.
 * Warns users when they ask for things the category explicitly excludes.
 */
export interface PromptConflict {
	exclusion: string;
	matchedKeywords: string[];
	promptExcerpt: string;
}

/** Result of checking user prompt against category exclusions. */
export interface ConflictDetectionResult {
	hasConflicts: boolean;
	conflicts: PromptConflict[];
}

/**
 * Checks if the user's focus prompt conflicts with the category's exclusions.
 * Prevents users from accidentally requesting things that will be marked as false positives.
 */
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

/**
 * Extracts meaningful keywords from exclusion text for conflict matching.
 * Removes stop words to focus on domain-specific terms.
 */
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

/**
 * Builds the complete hunt prompt combining category context with user additions.
 * For custom category, returns user prompt directly. For built-in categories,
 * constructs a structured prompt with valid examples, exclusions, and focus areas.
 */
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

/**
 * Returns category-specific guidance for the referee when validating findings.
 * Helps ensure consistent validation standards across different hunt types.
 */
export function getValidationGuidance(category: HuntCategory): string | null {
	const ctx = CATEGORY_CONTEXTS[category];
	return ctx?.validationGuidance ?? null;
}

/** Configuration for creating a new game session. */
export interface GameConfig {
	projectUrl: string;
	category: HuntCategory;
	/** Additional focus prompt merged with category context. */
	userPrompt: string | null;
	targetScore: number;
	/** Hunt phase duration in seconds. */
	huntDuration: number;
	/** Review phase duration in seconds. */
	reviewDuration: number;
	numAgents: number;
	/** Maximum rounds before tiebreaker. 0 = no limit, default 3. */
	maxRounds: number;
}

/** Accumulated statistics for an agent's performance. */
export interface AgentStats {
	findingsSubmitted: number;
	findingsValid: number;
	findingsFalse: number;
	findingsDuplicate: number;
	disputesWon: number;
	disputesLost: number;
}

/** Agent data formatted for display in the scoreboard UI. */
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

// =============================================================================
// Orchestrator Result Types
// These types define the JSON responses returned by CLI commands to the caller.
// =============================================================================

/** Returned by setup command after creating a new game. */
export interface SetupResult {
	action: "GAME_CREATED";
	gameId: string;
	agents: string[];
	config: Omit<GameConfig, "projectUrl">;
	next: string;
}

/** Returned by start-hunt command with agent prompts to spawn. */
export interface HuntPhaseResult {
	action: "SPAWN_HUNT_AGENTS";
	round: number;
	phase: Phase;
	endsAt: string;
	durationSeconds: number;
	agents: Array<{ agentId: string; prompt: string }>;
	instructions: string[];
}

/** Returned by check-hunt command with phase status. */
export interface HuntCheckResult {
	round: number;
	timeExpired: boolean;
	remainingSeconds: number;
	allAgentsFinished: boolean;
	readyForScoring: boolean;
	pending: string[];
	next: string;
}

/** Returned by start-hunt-scoring with validation prompts for each finding. */
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

/** Returned by start-review command with review prompts for agents. */
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

/** Returned by check-review command with phase status. */
export interface ReviewCheckResult {
	round: number;
	timeExpired: boolean;
	remainingSeconds: number;
	allAgentsFinished: boolean;
	readyForScoring: boolean;
	pending: string[];
	next: string;
}

/** Returned by start-review-scoring with resolution prompts for disputes. */
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

/** Returned by check-winner to determine if game should continue or end. */
export interface WinnerCheckResult {
	action: "GAME_COMPLETE" | "TIE_BREAKER" | "CONTINUE";
	winner?: string;
	reason: string;
	finalScores?: ScoreboardEntry[];
	tiedAgents?: string[];
	scores?: ScoreboardEntry[];
	next?: string;
}

// =============================================================================
// Database Row Types
// These match the SQLite table schemas with snake_case column names.
// =============================================================================

/** SQLite row format for games table. */
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

/** SQLite row format for agents table. */
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

/** Referee's confidence level in a validation decision. */
export type Confidence = "high" | "medium" | "low";

// =============================================================================
// Finding Classification Taxonomy
// =============================================================================

/**
 * Impact severity of a valid finding.
 * How bad is this issue if it's real?
 */
export enum ImpactTier {
	/** Data corruption, security breach, crash - must fix */
	Critical = "critical",
	/** Wrong output, resource leak, degraded functionality */
	Major = "major",
	/** Edge case incorrect, cosmetic, minimal user impact */
	Minor = "minor",
}

/**
 * Why a finding was rejected as invalid.
 * Only populated when the finding is marked FALSE.
 */
export enum RejectionReason {
	/** "Add validation" suggestion where code already works correctly */
	DefensiveSuggestion = "defensive_suggestion",
	/** Issue path can't be reached through public API */
	UnreachablePath = "unreachable_path",
	/** Validation exists at call site or middleware */
	AlreadyGuarded = "already_guarded",
	/** Style/naming preference, not correctness */
	StylePreference = "style_preference",
	/** "Could fail if..." without demonstrating reachable trigger */
	Speculative = "speculative",
	/** Type system or framework prevents the issue */
	PreventedBySystem = "prevented_by_system",
	/** Linter would catch this, not a runtime issue */
	LinterTerritory = "linter_territory",
	/** Agent misread the code or documentation */
	MisanalyzedSource = "misanalyzed_source",
	/** Valid issue but wrong hunt category */
	OutOfScope = "out_of_scope",
	/** Claim doesn't match reality when verified */
	CantVerify = "cant_verify",
}

// =============================================================================
// Category-Specific Issue Types
// =============================================================================

/** Issue types for bugs category */
export enum BugIssueType {
	/** Code executes wrong branch or produces wrong value */
	LogicError = "logic_error",
	/** Missing null/bounds/type check where input can violate assumption */
	MissingValidation = "missing_validation",
	/** Concurrent access corrupts shared state */
	RaceCondition = "race_condition",
	/** File handle, connection, memory not released */
	ResourceLeak = "resource_leak",
	/** Error swallowed or mishandled causing silent failure */
	ErrorMishandling = "error_mishandling",
	/** API contract violated (caller sends bad input, callee returns unexpected) */
	ContractViolation = "contract_violation",
	/** Runtime type differs from expected */
	TypeMismatch = "type_mismatch",
}

/** Issue types for documentation drift category */
export enum DocDriftIssueType {
	/** Docs describe feature/behavior that doesn't exist */
	NonexistentFeature = "nonexistent_feature",
	/** Docs show wrong parameters, return types, or signatures */
	WrongSignature = "wrong_signature",
	/** Example code doesn't work as shown */
	BrokenExample = "broken_example",
	/** Setup/install instructions fail */
	WrongInstructions = "wrong_instructions",
	/** Docs say X happens, code does Y */
	BehaviorMismatch = "behavior_mismatch",
	/** Comment describes algorithm incorrectly */
	StaleComment = "stale_comment",
	/** Config options documented don't exist or work differently */
	WrongConfig = "wrong_config",
}

/** Issue types for security category */
export enum SecurityIssueType {
	/** SQL, command, template injection */
	Injection = "injection",
	/** Cross-site scripting */
	XSS = "xss",
	/** Missing or broken authentication check */
	AuthBypass = "auth_bypass",
	/** Broken authorization/permissions */
	AuthzBypass = "authz_bypass",
	/** Sensitive data leaked */
	DataExposure = "data_exposure",
	/** Hardcoded creds, weak crypto */
	InsecureSecret = "insecure_secret",
	/** Directory traversal */
	PathTraversal = "path_traversal",
	/** Server-side request forgery */
	SSRF = "ssrf",
	/** Insecure deserialization */
	Deserialization = "deserialization",
}

/** Issue types for test coverage category */
export enum TestCoverageIssueType {
	/** No tests exercise this code */
	UntestedFunction = "untested_function",
	/** Specific branch never taken in tests */
	UntestedBranch = "untested_branch",
	/** Error handling not tested */
	UntestedErrorPath = "untested_error_path",
	/** Boundary condition not tested */
	UntestedEdgeCase = "untested_edge_case",
	/** Components work but integration not tested */
	MissingIntegrationTest = "missing_integration",
}

/** Issue types for tech debt category */
export enum TechDebtIssueType {
	/** Unreachable, never called */
	DeadCode = "dead_code",
	/** Copy-paste that should be extracted */
	DuplicatedLogic = "duplicated_logic",
	/** Too many responsibilities in one function */
	GodFunction = "god_function",
	/** Hardcoded numbers/strings without context */
	MagicValues = "magic_values",
	/** Leaky or wrong abstraction */
	BrokenAbstraction = "broken_abstraction",
	/** Using deprecated APIs */
	DeprecatedUsage = "deprecated_usage",
	/** Known issue marked but not fixed */
	TodoFixme = "todo_fixme",
	/** Same thing done different ways */
	InconsistentPattern = "inconsistent_pattern",
}

/** All possible issue type values across categories */
export type IssueType =
	| BugIssueType
	| DocDriftIssueType
	| SecurityIssueType
	| TestCoverageIssueType
	| TechDebtIssueType
	| string; // For custom category

/** Maps hunt categories to their valid issue types */
export const ISSUE_TYPES_BY_CATEGORY: Record<HuntCategory, readonly string[]> =
	{
		[HuntCategory.Bugs]: Object.values(BugIssueType),
		[HuntCategory.DocumentationDrift]: Object.values(DocDriftIssueType),
		[HuntCategory.Security]: Object.values(SecurityIssueType),
		[HuntCategory.TestCoverage]: Object.values(TestCoverageIssueType),
		[HuntCategory.TechDebt]: Object.values(TechDebtIssueType),
		[HuntCategory.Custom]: [], // Free-form for custom hunts
	};

/**
 * Status of the verification step after initial referee validation.
 * Verification is an optional second pass for uncertain validations.
 */
export enum VerificationStatus {
	/** No verification needed - referee was confident */
	None = "none",
	/** Awaiting verification by a second agent */
	Pending = "pending",
	/** Second agent confirmed the initial verdict */
	Confirmed = "confirmed",
	/** Second agent overrode the initial verdict */
	Overridden = "overridden",
}

/**
 * Structured output from referee validation including confidence and categorization.
 * Used to determine if verification is needed before scoring.
 */
export interface ValidationResult {
	verdict: "VALID" | "FALSE" | "DUPLICATE";
	/** Confidence score 0-100 */
	confidenceScore: number;
	/** Referee's explanation of the verdict */
	explanation: string;
	/** True if a second verification pass should be spawned */
	needsVerification: boolean;
	/** Why verification is needed, if applicable */
	verificationReason?: string;
	/** For duplicates, the ID of the original finding */
	duplicateOfId?: number;

	// Classification for VALID findings
	/** Impact severity: critical, major, minor */
	impactTier?: ImpactTier;
	/** Category-specific issue type (e.g., logic_error, broken_example) */
	issueType?: IssueType;

	// Classification for FALSE findings
	/** Why the finding was rejected */
	rejectionReason?: RejectionReason;
}

/** SQLite row format for findings table. */
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
	/** 0-100 confidence score from referee */
	confidence_score: number | null;
	/** Category-specific issue type (e.g., logic_error, broken_example) */
	issue_type: string | null;
	/** Impact severity: critical, major, minor (for valid findings) */
	impact_tier: string | null;
	/** Why finding was rejected (for invalid findings) */
	rejection_reason: string | null;
	/** Verification status: none, pending, confirmed, overridden */
	verification_status: string;
	/** Explanation from verifier if verification was performed */
	verifier_explanation: string | null;
}

/** SQLite row format for disputes table. */
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
