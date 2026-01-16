import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useState } from "react";
import type { Finding } from "../../domain/Finding.js";
import type { Game } from "../../domain/Game.js";
import type { ScoreboardEntry } from "../../domain/types.js";
import type { Orchestrator } from "../../services/Orchestrator.js";

interface GameState {
	game: Game;
	scoreboard: ScoreboardEntry[];
	findings: Finding[];
	activity: string[];
}

interface Props {
	gameId: string;
	orchestrator: Orchestrator;
}

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function Header({ game }: { game: Game }) {
	const timeRemaining = game.timeRemaining;
	const phaseDisplay = game.phase.replace("_", " ").toUpperCase();

	return (
		<Box
			flexDirection="column"
			borderStyle="single"
			paddingX={1}
			alignSelf="flex-start"
		>
			<Text bold>CODE HUNT - Round {game.round}</Text>
			<Text>
				Phase: <Text color="cyan">{phaseDisplay}</Text>
				{"  "}
				{timeRemaining > 0 && (
					<Text color="yellow">⏱ {formatTime(timeRemaining)} remaining</Text>
				)}
				{game.isComplete && <Text color="green">Winner: {game.winnerId}</Text>}
			</Text>
		</Box>
	);
}

function Scoreboard({ scoreboard }: { scoreboard: ScoreboardEntry[] }) {
	// Calculate max agent name width dynamically
	const maxNameLen = Math.max(
		5, // "Agent" header
		...scoreboard.map((e) => e.id.length),
	);
	const nameWidth = maxNameLen + 2;

	return (
		<Box
			flexDirection="column"
			borderStyle="single"
			paddingX={1}
			alignSelf="flex-start"
		>
			<Box>
				<Text bold>
					<Text color="white">{"Agent".padEnd(nameWidth)}</Text>
					<Text color="white">{"Score".padStart(7)}</Text>
					<Text color="white">{"Valid".padStart(7)}</Text>
					<Text color="white">{"False".padStart(7)}</Text>
					<Text color="white">{"Dup".padStart(5)}</Text>
				</Text>
			</Box>
			{scoreboard.map((entry) => (
				<Box key={entry.id}>
					<Text>
						<Text color={entry.status === "winner" ? "green" : "white"}>
							{entry.id.padEnd(nameWidth)}
						</Text>
						<Text color="cyan">{String(entry.score).padStart(7)}</Text>
						<Text color="green">{String(entry.findingsValid).padStart(7)}</Text>
						<Text color="red">{String(entry.findingsFalse).padStart(7)}</Text>
						<Text color="yellow">
							{String(entry.findingsDuplicate).padStart(5)}
						</Text>
					</Text>
				</Box>
			))}
		</Box>
	);
}

function Activity({ messages }: { messages: string[] }) {
	const recent = messages.slice(-3);
	return (
		<Box
			flexDirection="column"
			borderStyle="single"
			paddingX={1}
			alignSelf="flex-start"
		>
			<Text bold dimColor>
				Activity
			</Text>
			{recent.length === 0 && <Text dimColor>Waiting for activity...</Text>}
			{recent.map((msg, i) => (
				<Text key={i} dimColor>
					{msg}
				</Text>
			))}
		</Box>
	);
}

function Footer() {
	return (
		<Box marginTop={1}>
			<Text dimColor>Press </Text>
			<Text color="yellow">q</Text>
			<Text dimColor> to exit</Text>
		</Box>
	);
}

export function GameUI({ gameId, orchestrator }: Props) {
	const { exit } = useApp();
	const [state, setState] = useState<GameState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [prevFindingCount, setPrevFindingCount] = useState(0);

	useInput((input) => {
		if (input === "q") {
			exit();
		}
	});

	useEffect(() => {
		const poll = () => {
			try {
				const game = orchestrator.getGame(gameId);
				if (!game) {
					setError(`Game not found: ${gameId}`);
					setTimeout(() => exit(), 2000);
					return;
				}

				const scoreboard = orchestrator.getScoreboard(gameId);
				const findings = orchestrator.getFindings(gameId);

				setState((prev) => {
					// Create new activity array to avoid mutating state
					let activity = prev?.activity ?? [];

					// Detect new findings
					// Findings are sorted DESC (newest first), so new findings are at the start
					if (findings.length > prevFindingCount) {
						const newCount = findings.length - prevFindingCount;
						const newFindings = findings.slice(0, newCount);
						// Create new array with new messages appended
						activity = [
							...activity,
							...newFindings.map(
								(f) => `${f.agentId} submitted finding #${f.id}`,
							),
						];
						setPrevFindingCount(findings.length);
					}

					return { game, scoreboard, findings, activity };
				});

				// Auto-exit after game completion
				if (game.isComplete) {
					setTimeout(() => exit(), 3000);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Unknown error");
				setTimeout(() => exit(), 2000);
			}
		};

		poll();
		const interval = setInterval(poll, 1000);
		return () => clearInterval(interval);
	}, [gameId, orchestrator, exit, prevFindingCount]);

	if (error) {
		return (
			<Box
				flexDirection="column"
				borderStyle="single"
				borderColor="red"
				paddingX={1}
			>
				<Text color="red" bold>
					Error
				</Text>
				<Text color="red">{error}</Text>
				<Text dimColor>Exiting...</Text>
			</Box>
		);
	}

	if (!state) {
		return <Text>Loading...</Text>;
	}

	return (
		<Box flexDirection="column">
			<Header game={state.game} />
			<Scoreboard scoreboard={state.scoreboard} />
			<Activity messages={state.activity} />
			<Footer />
		</Box>
	);
}
