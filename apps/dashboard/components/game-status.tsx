"use client";

import { useInterval } from "ahooks";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import type { GameState, GameStats, Phase } from "@/lib/types";
import { PHASE_CONFIG } from "@/lib/types";
import { cn } from "@/lib/utils";

interface GameStatusProps {
	game: GameState;
	stats: GameStats;
}

function formatTime(seconds: number): string {
	if (seconds <= 0) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
	if (seconds <= 0) return "0:00";
	const hours = Math.floor(seconds / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	if (hours > 0) {
		return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
	}
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function PhaseIndicator({ phase }: { phase: Phase }) {
	const displayPhases: Phase[] = [
		"hunt",
		"hunt_scoring",
		"review",
		"review_scoring",
	];

	const currentIndex =
		phase === "setup"
			? -1
			: phase === "complete"
				? displayPhases.length
				: displayPhases.indexOf(phase);

	return (
		<div className="flex items-center gap-0.5">
			{displayPhases.map((p, i) => {
				const isActive = p === phase;
				const isPast = currentIndex > i;
				const phaseConfig = PHASE_CONFIG[p];

				return (
					<div key={p} className="flex items-center">
						<div
							className={cn(
								"relative px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border transition-all",
								isActive && "bg-foreground text-background border-foreground",
								isPast && "text-muted-foreground border-border bg-transparent",
								!isActive &&
									!isPast &&
									"text-muted-foreground/30 border-transparent bg-transparent",
							)}
						>
							{isActive && (
								<motion.div
									className="absolute left-0 bottom-0 h-0.5 bg-primary"
									initial={{ width: 0 }}
									animate={{ width: "100%" }}
									transition={{ duration: 0.4, ease: "easeOut" }}
								/>
							)}
							<span className="relative z-10">{phaseConfig.label}</span>
						</div>
						{i < displayPhases.length - 1 && (
							<div
								className={cn(
									"w-4 h-px",
									isPast ? "bg-foreground/30" : "bg-border",
								)}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}

function TotalTimer({
	createdAt,
	completedAt,
}: {
	createdAt: string;
	completedAt: string | null;
}) {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		const start = new Date(createdAt).getTime();
		const end = completedAt ? new Date(completedAt).getTime() : Date.now();
		setElapsed(Math.floor((end - start) / 1000));
	}, [createdAt, completedAt]);

	useInterval(
		() => {
			const start = new Date(createdAt).getTime();
			setElapsed(Math.floor((Date.now() - start) / 1000));
		},
		completedAt ? undefined : 1000,
	);

	return (
		<span className="font-mono text-sm tabular-nums text-muted-foreground">
			{formatDuration(elapsed)}
		</span>
	);
}

function Timer({
	endTime,
	duration,
}: {
	endTime: string | null;
	duration: number;
}) {
	const [remaining, setRemaining] = useState(0);

	useEffect(() => {
		if (!endTime) {
			setRemaining(0);
			return;
		}
		const end = new Date(endTime).getTime();
		setRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)));
	}, [endTime]);

	useInterval(
		() => {
			if (!endTime) return;
			const end = new Date(endTime).getTime();
			setRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)));
		},
		endTime ? 1000 : undefined,
	);

	if (!endTime) {
		return <span className="text-muted-foreground text-sm font-mono">—</span>;
	}

	const progress = duration > 0 ? (remaining / duration) * 100 : 0;
	const isUrgent = remaining <= 30;
	const isCritical = remaining <= 10;

	return (
		<div className="flex items-center gap-3">
			<div className="relative w-20 h-1 bg-border overflow-hidden">
				<motion.div
					className={cn(
						"absolute inset-y-0 left-0 transition-colors",
						isCritical
							? "bg-destructive"
							: isUrgent
								? "bg-duplicate"
								: "bg-foreground",
					)}
					initial={false}
					animate={{ width: `${progress}%` }}
					transition={{ duration: 0.3 }}
				/>
			</div>
			<motion.span
				className={cn(
					"font-mono text-xl tabular-nums font-bold tracking-tight",
					isCritical && "text-destructive",
					isUrgent && !isCritical && "text-duplicate",
				)}
				animate={isCritical ? { opacity: [1, 0.5, 1] } : {}}
				transition={{ duration: 0.8, repeat: isCritical ? Infinity : 0 }}
			>
				{formatTime(remaining)}
			</motion.span>
		</div>
	);
}

function Stat({
	label,
	value,
	pending,
	highlight,
}: {
	label: string;
	value: string | number;
	pending?: number;
	highlight?: boolean;
}) {
	return (
		<div className="flex items-baseline gap-1.5">
			<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
				{label}
			</span>
			<span
				className={cn(
					"font-mono text-sm font-semibold tabular-nums",
					highlight && "text-accent",
				)}
			>
				{value}
			</span>
			{pending !== undefined && pending > 0 && (
				<span className="text-[10px] text-duplicate font-mono">+{pending}</span>
			)}
		</div>
	);
}

export function GameStatus({ game, stats }: GameStatusProps) {
	const config = PHASE_CONFIG[game.phase];
	const isTimedPhase = game.phase === "hunt" || game.phase === "review";
	const duration =
		game.phase === "hunt" ? game.huntDuration : game.reviewDuration;

	return (
		<div>
			{/* Top: Round + Phase + Timer */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
				<div className="flex items-center gap-5">
					{/* Round */}
					<div>
						<span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">
							Round
						</span>
						<span className="font-display text-4xl font-bold tabular-nums leading-none">
							{game.round}
						</span>
					</div>

					<div className="w-px h-10 bg-border" />

					{/* Phase */}
					<div>
						<span className="text-xs text-muted-foreground block mb-1.5">
							{config.description}
						</span>
						<PhaseIndicator phase={game.phase} />
					</div>
				</div>

				{/* Timers */}
				<div className="flex items-center gap-5">
					<div className="flex items-baseline gap-1.5">
						<span className="text-[10px] text-muted-foreground uppercase tracking-wider">
							Elapsed
						</span>
						<TotalTimer
							createdAt={game.createdAt}
							completedAt={game.completedAt}
						/>
					</div>

					<div className="w-px h-5 bg-border" />

					{isTimedPhase ? (
						<Timer endTime={game.phaseEndsAt} duration={duration} />
					) : (
						<span className="text-sm text-muted-foreground font-mono">
							{game.isComplete ? "Final" : "Waiting…"}
						</span>
					)}
				</div>
			</div>

			<div className="editorial-rule" />

			{/* Bottom: Stats row */}
			<div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-3">
				<Stat label="Target" value={game.targetScore} />
				<Stat
					label="Findings"
					value={`${stats.validFindings}/${stats.totalFindings}`}
					pending={stats.pendingFindings}
				/>
				<Stat
					label="Disputes"
					value={stats.totalDisputes}
					pending={stats.pendingDisputes}
				/>
				{game.winner && (
					<div className="flex items-center gap-1.5 ml-auto">
						<Trophy className="h-4 w-4 text-accent" />
						<span className="font-display text-sm font-semibold text-accent">
							{game.winner.split("-").pop()}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
