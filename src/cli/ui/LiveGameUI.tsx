/**
 * Live game TUI — renders real-time game progress via Ink.
 * Consumes GameEvents from an EventEmitter and renders a dashboard
 * with scoreboard, phase-specific views, and progress tracking.
 */

import type { EventEmitter } from "node:events";
import { Box, Static, Text } from "ink";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AgentRunResult } from "../../agents/AgentRunner.js";
import {
	DisputeStatus,
	FindingStatus,
	type ScoreboardEntry,
} from "../../domain/types.js";
import type { GameEvent } from "../../services/GameRunner.js";
import type { Orchestrator } from "../../services/Orchestrator.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extracts the short human name from a full agent ID.
 * Full IDs are "gameId-name" (e.g., "afk-2561f963d1f5-maya" → "maya").
 */
function shortName(agentId: string): string {
	return agentId.split("-").pop() ?? agentId;
}

/**
 * Renders a unicode progress bar.
 * @param current - Completed items
 * @param total - Total items
 * @param width - Character width of the bar
 */
function progressBar(current: number, total: number, width = 20): string {
	if (total === 0) return "░".repeat(width);
	const ratio = Math.min(current / total, 1);
	const filled = Math.round(ratio * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Formats a dollar cost with 2 decimal places. */
function formatCost(cost: number): string {
	return `$${cost.toFixed(2)}`;
}

/**
 * Counts how many times a specific tool was called in an agent run.
 * @param result - Completed agent run result
 * @param toolName - Tool name to count
 */
function countToolCalls(result: AgentRunResult, toolName: string): number {
	return result.toolCalls.filter((tc) => tc.tool === toolName).length;
}

/**
 * Pluralizes a word based on count.
 * @param count - Number of items
 * @param singular - Singular form
 * @param plural - Plural form (defaults to singular + "s")
 */
function plural(count: number, singular: string, pluralForm?: string): string {
	return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

// ─── State ───────────────────────────────────────────────────────────────────

interface AgentStatus {
	fullId: string;
	short: string;
	done: boolean;
	turns?: number;
	cost?: number;
	findings?: number;
	disputes?: number;
	aborted?: string;
}

type Phase =
	| "setup"
	| "hunt"
	| "scoring"
	| "verification"
	| "review"
	| "dispute_scoring"
	| "complete";

interface State {
	gameId: string;
	round: number;
	phase: Phase;
	agents: AgentStatus[];
	progressTotal: number;
	progressDone: number;
	totalCost: number;
	winner: string | null;
	reason: string | null;
}

const INITIAL_STATE: State = {
	gameId: "",
	round: 0,
	phase: "setup",
	agents: [],
	progressTotal: 0,
	progressDone: 0,
	totalCost: 0,
	winner: null,
	reason: null,
};

/** Pure reducer — maps GameEvents to state transitions. */
function reducer(state: State, event: GameEvent): State {
	switch (event.type) {
		case "game_created":
			return {
				...state,
				gameId: event.gameId,
				agents: event.agents.map((id) => ({
					fullId: id,
					short: shortName(id),
					done: false,
				})),
			};

		case "round_start":
			return {
				...state,
				round: event.round,
				agents: state.agents.map((a) => ({
					...a,
					done: false,
					turns: undefined,
					cost: undefined,
					findings: undefined,
					disputes: undefined,
					aborted: undefined,
				})),
			};

		case "hunt_start":
			return { ...state, phase: "hunt" };

		case "hunt_agent_done": {
			const r = event.result;
			const cost = r.totalUsage.cost.total;
			return {
				...state,
				totalCost: state.totalCost + cost,
				agents: state.agents.map((a) =>
					a.fullId === event.agentId
						? {
								...a,
								done: true,
								turns: r.turnCount,
								cost,
								findings: countToolCalls(r, "submit_finding"),
								aborted: r.aborted ? (r.abortReason ?? "aborted") : undefined,
							}
						: a,
				),
			};
		}

		case "scoring_start":
			return {
				...state,
				phase: "scoring",
				progressTotal: event.findingCount,
				progressDone: 0,
			};

		case "finding_validated":
			return { ...state, progressDone: state.progressDone + 1 };

		case "verification_start":
			return {
				...state,
				phase: "verification",
				progressTotal: event.count,
				progressDone: 0,
			};

		case "finding_verified":
			return { ...state, progressDone: state.progressDone + 1 };

		case "review_start":
			return {
				...state,
				phase: "review",
				agents: state.agents.map((a) => ({
					...a,
					done: false,
					turns: undefined,
					cost: undefined,
					findings: undefined,
					disputes: undefined,
					aborted: undefined,
				})),
			};

		case "review_agent_done": {
			const r = event.result;
			const cost = r.totalUsage.cost.total;
			return {
				...state,
				totalCost: state.totalCost + cost,
				agents: state.agents.map((a) =>
					a.fullId === event.agentId
						? {
								...a,
								done: true,
								turns: r.turnCount,
								cost,
								disputes: countToolCalls(r, "submit_dispute"),
								aborted: r.aborted ? (r.abortReason ?? "aborted") : undefined,
							}
						: a,
				),
			};
		}

		case "dispute_scoring_start":
			return {
				...state,
				phase: "dispute_scoring",
				progressTotal: event.disputeCount,
				progressDone: 0,
			};

		case "dispute_resolved":
			return { ...state, progressDone: state.progressDone + 1 };

		case "round_complete":
			return {
				...state,
				phase: event.action === "GAME_COMPLETE" ? "complete" : state.phase,
			};

		case "game_complete":
			return {
				...state,
				phase: "complete",
				winner: event.winner,
				reason: event.reason,
			};

		default:
			return state;
	}
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Top banner with game ID, round, phase, and cost. */
function Header({
	state,
	category,
	targetScore,
}: {
	state: State;
	category: string;
	targetScore: number;
}) {
	const phaseLabel = state.phase.replace("_", " ").toUpperCase();

	return (
		<Box flexDirection="column" borderStyle="round" paddingX={1}>
			<Text bold>
				BONES
				<Text dimColor> · </Text>
				Round {state.round}
				<Text dimColor> · </Text>
				<Text color="cyan">{phaseLabel}</Text>
				<Text dimColor> · </Text>
				<Text color="yellow">{formatCost(state.totalCost)}</Text>
			</Text>
			<Text dimColor>
				{category} · target {targetScore}
			</Text>
		</Box>
	);
}

/** Live scoreboard table. */
function ScoreboardView({ scoreboard }: { scoreboard: ScoreboardEntry[] }) {
	if (scoreboard.length === 0) return null;

	const nameW =
		Math.max(6, ...scoreboard.map((e) => shortName(e.id).length)) + 1;

	return (
		<Box flexDirection="column" marginTop={1} marginLeft={2}>
			<Box>
				<Text dimColor>
					{"Agent".padEnd(nameW)}
					{"Score".padStart(6)}
					{"Valid".padStart(7)}
					{"False".padStart(7)}
					{"Dup".padStart(5)}
					{"W/L".padStart(6)}
				</Text>
			</Box>
			{scoreboard.map((e) => (
				<Box key={e.id}>
					<Text
						color={e.status === "winner" ? "green" : "white"}
						bold={e.status === "winner"}
					>
						{shortName(e.id).padEnd(nameW)}
					</Text>
					<Text color="cyan" bold>
						{String(e.score).padStart(6)}
					</Text>
					<Text color="green">{String(e.findingsValid).padStart(7)}</Text>
					<Text color="red">{String(e.findingsFalse).padStart(7)}</Text>
					<Text color="yellow">{String(e.findingsDuplicate).padStart(5)}</Text>
					<Text dimColor>
						{`${e.disputesWon}/${e.disputesLost}`.padStart(6)}
					</Text>
				</Box>
			))}
		</Box>
	);
}

/** Completed-phase one-liner for the static log. */
interface LogEntry {
	key: string;
	text: string;
	color?: string;
}

/** Renders static log entries (completed phases — rendered once, never re-rendered). */
function LogView({ entries }: { entries: LogEntry[] }) {
	if (entries.length === 0) return null;

	return (
		<Static items={entries}>
			{(entry) => (
				<Text key={entry.key} color={entry.color ?? "gray"}>
					{entry.text}
				</Text>
			)}
		</Static>
	);
}

/** Phase section header (e.g., "── HUNT ──────────"). */
function PhaseHeader({ label }: { label: string }) {
	const pad = Math.max(0, 42 - label.length - 4);
	return (
		<Box marginTop={1}>
			<Text color="cyan" bold>
				── {label} {"─".repeat(pad)}
			</Text>
		</Box>
	);
}

/** Agent status list for hunt or review phases. */
function AgentList({
	agents,
	mode,
}: {
	agents: AgentStatus[];
	mode: "hunt" | "review";
}) {
	return (
		<Box flexDirection="column" marginLeft={2}>
			{agents.map((a) => (
				<Box key={a.fullId}>
					{a.done ? (
						<Text>
							<Text color="green">✓</Text> <Text bold>{a.short}</Text>
							{"  "}
							{mode === "hunt" && a.findings !== undefined && (
								<Text dimColor>
									{a.findings} {plural(a.findings, "finding")}
								</Text>
							)}
							{mode === "review" && a.disputes !== undefined && (
								<Text dimColor>
									{a.disputes} {plural(a.disputes, "dispute")}
								</Text>
							)}
							{a.turns !== undefined && (
								<Text dimColor> · {a.turns} turns</Text>
							)}
							{a.cost !== undefined && (
								<Text dimColor> · {formatCost(a.cost)}</Text>
							)}
							{a.aborted && <Text color="yellow"> ({a.aborted})</Text>}
						</Text>
					) : (
						<Text>
							<Text color="yellow">⏳</Text> <Text bold>{a.short}</Text>
							{"  "}
							<Text dimColor>
								{mode === "hunt" ? "hunting…" : "reviewing…"}
							</Text>
						</Text>
					)}
				</Box>
			))}
		</Box>
	);
}

/** Progress bar for scoring/verification/dispute phases. */
function ProgressView({
	total,
	done,
	label,
}: {
	total: number;
	done: number;
	label: string;
}) {
	return (
		<Box marginLeft={2}>
			<Text>
				<Text color="cyan">{progressBar(done, total)}</Text>{" "}
				<Text>
					{done}/{total}
				</Text>{" "}
				<Text dimColor>{label}</Text>
			</Text>
		</Box>
	);
}

/** Winner banner shown at game completion. */
function WinnerBanner({
	winner,
	reason,
	cost,
}: {
	winner: string;
	reason: string;
	cost: number;
}) {
	return (
		<Box
			flexDirection="column"
			marginTop={1}
			borderStyle="round"
			borderColor="green"
			paddingX={1}
		>
			<Text color="green" bold>
				🏆 {shortName(winner)} wins!
			</Text>
			<Text dimColor>{reason}</Text>
			<Text dimColor>Total cost: {formatCost(cost)}</Text>
		</Box>
	);
}

/** Renders the current phase's view. */
function CurrentPhase({ state }: { state: State }) {
	switch (state.phase) {
		case "hunt":
			return (
				<>
					<PhaseHeader label="HUNT" />
					<AgentList agents={state.agents} mode="hunt" />
				</>
			);
		case "scoring":
			return (
				<>
					<PhaseHeader label="REFEREE" />
					<ProgressView
						total={state.progressTotal}
						done={state.progressDone}
						label="findings"
					/>
				</>
			);
		case "verification":
			return (
				<>
					<PhaseHeader label="VERIFICATION" />
					<ProgressView
						total={state.progressTotal}
						done={state.progressDone}
						label="uncertain"
					/>
				</>
			);
		case "review":
			return (
				<>
					<PhaseHeader label="REVIEW" />
					<AgentList agents={state.agents} mode="review" />
				</>
			);
		case "dispute_scoring":
			return (
				<>
					<PhaseHeader label="DISPUTES" />
					<ProgressView
						total={state.progressTotal}
						done={state.progressDone}
						label="disputes"
					/>
				</>
			);
		case "complete":
			return state.winner ? (
				<WinnerBanner
					winner={state.winner}
					reason={state.reason ?? ""}
					cost={state.totalCost}
				/>
			) : null;
		default:
			return null;
	}
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface Props {
	emitter: EventEmitter;
	orchestrator: Orchestrator;
}

/**
 * Live game dashboard rendered via Ink.
 * Subscribes to GameEvents from the emitter and renders a real-time
 * view with scoreboard, phase progress, and agent statuses.
 */
export function LiveGameUI({ emitter, orchestrator }: Props) {
	const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
	const [scoreboard, setScoreboard] = useState<ScoreboardEntry[]>([]);
	const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
	const [category, setCategory] = useState("");
	const [targetScore, setTargetScore] = useState(0);

	// Refs for values needed in event handler (avoids stale closures)
	const gameIdRef = useRef("");
	const agentResultsRef = useRef<
		Map<string, { short: string; result: AgentRunResult }>
	>(new Map());
	const logCounterRef = useRef(0);

	// Keep gameId ref in sync
	useEffect(() => {
		gameIdRef.current = state.gameId;
	}, [state.gameId]);

	/** Appends a log entry (rendered once via Static). */
	const addLog = useCallback((text: string, color?: string) => {
		const key = `log-${logCounterRef.current++}`;
		setLogEntries((prev) => [...prev, { key, text, color }]);
	}, []);

	/** Refreshes the scoreboard from the database. */
	const refreshScoreboard = useCallback(() => {
		if (!gameIdRef.current) return;
		try {
			setScoreboard(orchestrator.getScoreboard(gameIdRef.current));
		} catch {
			/* game may not exist yet */
		}
	}, [orchestrator]);

	// Fetch game metadata once we have a gameId
	useEffect(() => {
		if (!state.gameId) return;
		const game = orchestrator.getGame(state.gameId);
		if (game) {
			setCategory(game.category);
			setTargetScore(game.config.targetScore);
		}
	}, [state.gameId, orchestrator]);

	// Subscribe to game events
	useEffect(() => {
		const handler = (event: GameEvent) => {
			dispatch(event);

			// ── Phase transition logging ─────────────────────────
			if (event.type === "round_start") {
				addLog(`\n═══ Round ${event.round} ${"═".repeat(34)}`);
			}

			// Track agent results for hunt summaries
			if (event.type === "hunt_agent_done") {
				agentResultsRef.current.set(event.agentId, {
					short: shortName(event.agentId),
					result: event.result,
				});
			}

			// Hunt complete → log summary, refresh scoreboard
			if (event.type === "hunt_end") {
				const parts = [...agentResultsRef.current.values()].map((a) => {
					const n = countToolCalls(a.result, "submit_finding");
					return `${a.short}: ${n}`;
				});
				addLog(`  ✓ Hunt — ${parts.join(", ")} findings`);
				agentResultsRef.current.clear();
			}

			// Scoring complete → log summary from DB
			if (event.type === "scoring_end") {
				refreshScoreboard();
				if (gameIdRef.current) {
					try {
						const findings = orchestrator.getFindings(gameIdRef.current);
						const valid = findings.filter(
							(f) => f.status === FindingStatus.Valid,
						).length;
						const falseFl = findings.filter(
							(f) => f.status === FindingStatus.FalseFlag,
						).length;
						const dup = findings.filter(
							(f) => f.status === FindingStatus.Duplicate,
						).length;
						addLog(
							`  ✓ Referee — ${valid} valid, ${falseFl} false, ${dup} duplicate`,
						);
					} catch {
						addLog("  ✓ Referee — scoring complete");
					}
				}
			}

			if (event.type === "verification_end") {
				refreshScoreboard();
				addLog("  ✓ Verification complete");
			}

			// Track agent results for review summaries
			if (event.type === "review_agent_done") {
				agentResultsRef.current.set(event.agentId, {
					short: shortName(event.agentId),
					result: event.result,
				});
			}

			// Review complete → log summary
			if (event.type === "review_end") {
				const parts = [...agentResultsRef.current.values()].map((a) => {
					const n = countToolCalls(a.result, "submit_dispute");
					return `${a.short}: ${n}`;
				});
				addLog(`  ✓ Review — ${parts.join(", ")} disputes`);
				agentResultsRef.current.clear();
			}

			// Dispute scoring complete → refresh scoreboard
			if (event.type === "dispute_scoring_end") {
				refreshScoreboard();
				if (gameIdRef.current) {
					try {
						const disputes = orchestrator.getDisputes(gameIdRef.current);
						const won = disputes.filter(
							(d) => d.status === DisputeStatus.Successful,
						).length;
						const lost = disputes.filter(
							(d) => d.status === DisputeStatus.Failed,
						).length;
						addLog(`  ✓ Disputes — ${won} successful, ${lost} failed`);
					} catch {
						addLog("  ✓ Disputes resolved");
					}
				}
			}

			if (event.type === "round_complete") {
				const w = event.winner
					? `${shortName(event.winner)} wins`
					: "no winner";
				addLog(`  → ${event.action} — ${w}`);
			}

			if (event.type === "game_complete") {
				refreshScoreboard();
			}
		};

		emitter.on("game-event", handler);
		return () => {
			emitter.off("game-event", handler);
		};
	}, [emitter, orchestrator, addLog, refreshScoreboard]);

	// Poll scoreboard during active phases
	useEffect(() => {
		if (!state.gameId) return;
		const interval = setInterval(refreshScoreboard, 3000);
		return () => clearInterval(interval);
	}, [state.gameId, refreshScoreboard]);

	return (
		<Box flexDirection="column">
			<LogView entries={logEntries} />
			<Header state={state} category={category} targetScore={targetScore} />
			<ScoreboardView scoreboard={scoreboard} />
			<CurrentPhase state={state} />
		</Box>
	);
}
