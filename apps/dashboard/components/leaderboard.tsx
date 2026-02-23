"use client";

import { usePrevious } from "ahooks";
import { AnimatePresence, motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import type { Phase, ScoreboardEntry } from "@/lib/types";
import { cn, formatAgentName } from "@/lib/utils";

interface LeaderboardProps {
	scoreboard: ScoreboardEntry[];
	phase: Phase;
	targetScore: number;
}

function RankDisplay({ rank }: { rank: number }) {
	if (rank <= 3) {
		return (
			<span
				className={cn(
					"font-display text-xl font-bold tabular-nums leading-none",
					rank === 1 && "text-accent",
					rank === 2 && "text-muted-foreground",
					rank === 3 && "text-muted-foreground/60",
				)}
			>
				{rank}
			</span>
		);
	}
	return (
		<span className="font-mono text-sm tabular-nums text-muted-foreground">
			{rank}
		</span>
	);
}

function StatCell({
	value,
	variant,
	label,
}: {
	value: number;
	variant?: "valid" | "invalid" | "duplicate";
	label: string;
}) {
	const hasValue = value > 0;
	return (
		<span
			className={cn(
				"font-mono text-xs tabular-nums",
				!hasValue && "text-muted-foreground/30",
				hasValue && variant === "valid" && "text-valid",
				hasValue && variant === "invalid" && "text-invalid",
				hasValue && variant === "duplicate" && "text-duplicate",
				hasValue && !variant && "text-foreground",
			)}
			title={label}
		>
			{value}
		</span>
	);
}

function AgentRow({
	agent,
	rank,
	phase,
}: {
	agent: ScoreboardEntry;
	rank: number;
	phase: Phase;
}) {
	const prevScore = usePrevious(agent.score);
	const scoreChanged = prevScore !== undefined && prevScore !== agent.score;
	const isActive =
		phase === "hunt" ||
		phase === "review" ||
		phase === "hunt_scoring" ||
		phase === "review_scoring";

	return (
		<motion.tr
			layout="position"
			layoutId={agent.id}
			initial={false}
			animate={{
				backgroundColor: scoreChanged
					? [
							"oklch(0.965 0.008 80 / 0)",
							"oklch(0.7 0.15 85 / 0.1)",
							"oklch(0.965 0.008 80 / 0)",
						]
					: "oklch(0.965 0.008 80 / 0)",
			}}
			transition={{
				layout: { type: "spring", stiffness: 500, damping: 35 },
				backgroundColor: { duration: 0.8 },
			}}
			className={cn(
				"border-b border-border last:border-b-0 group",
				agent.status === "eliminated" && "opacity-40",
			)}
		>
			{/* Rank */}
			<td className="py-3 pr-3 w-10 text-center align-middle">
				<RankDisplay rank={rank} />
			</td>

			{/* Agent */}
			<td className="py-3 px-3 align-middle">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">
						{formatAgentName(agent.id)}
					</span>
					<Badge variant={agent.status} className="shrink-0">
						{agent.status}
					</Badge>
					{isActive && agent.status === "active" && (
						<motion.div
							className="h-1.5 w-1.5 rounded-full bg-valid shrink-0"
							animate={{ opacity: [1, 0.2, 1] }}
							transition={{ duration: 1.5, repeat: Infinity }}
						/>
					)}
				</div>
			</td>

			{/* Stats — desktop */}
			<td className="py-3 px-3 text-center align-middle hidden sm:table-cell">
				<StatCell value={agent.findingsValid} variant="valid" label="Valid" />
			</td>
			<td className="py-3 px-3 text-center align-middle hidden sm:table-cell">
				<StatCell value={agent.findingsFalse} variant="invalid" label="False" />
			</td>
			<td className="py-3 px-3 text-center align-middle hidden sm:table-cell">
				<StatCell
					value={agent.findingsDuplicate}
					variant="duplicate"
					label="Dupe"
				/>
			</td>
			<td className="py-3 px-3 text-center align-middle hidden sm:table-cell">
				<StatCell value={agent.findingsSubmitted} label="Total" />
			</td>

			{/* Score */}
			<td className="py-3 pl-3 text-right align-middle">
				<motion.span
					className={cn(
						"font-display text-2xl font-bold tabular-nums",
						agent.status === "winner" && "text-accent",
						agent.score < 0 && "text-invalid",
					)}
					animate={scoreChanged ? { scale: [1, 1.15, 1] } : {}}
					transition={{ duration: 0.3 }}
				>
					{agent.score}
				</motion.span>
			</td>
		</motion.tr>
	);
}

export function Leaderboard({
	scoreboard,
	phase,
	targetScore,
}: LeaderboardProps) {
	const sorted = [...scoreboard].sort((a, b) => b.score - a.score);
	const leader = sorted[0];

	return (
		<div>
			{/* Header */}
			<div className="flex items-baseline justify-between mb-2">
				<h3 className="font-display text-lg font-semibold">Standings</h3>
				<div className="flex items-baseline gap-4 text-xs">
					<span className="text-muted-foreground">
						Target{" "}
						<span className="font-mono font-medium text-foreground">
							{targetScore}
						</span>
					</span>
					<span className="text-muted-foreground">
						Leader{" "}
						<span
							className={cn(
								"font-mono font-medium",
								(leader?.score ?? 0) >= targetScore
									? "text-accent"
									: "text-foreground",
							)}
						>
							{leader?.score ?? 0}
						</span>
					</span>
				</div>
			</div>

			{/* Progress bar */}
			<div className="h-0.5 bg-border mb-1">
				<motion.div
					className="h-full bg-foreground"
					initial={false}
					animate={{
						width: `${Math.min(100, Math.max(0, ((leader?.score ?? 0) / targetScore) * 100))}%`,
					}}
					transition={{ duration: 0.5 }}
				/>
			</div>
			<div className="editorial-rule-thick mb-0" />

			{/* Table */}
			<table className="w-full">
				{/* Column headers — desktop */}
				<thead>
					<tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-foreground/10">
						<th className="py-2 pr-3 text-center font-medium w-10">#</th>
						<th className="py-2 px-3 text-left font-medium">Agent</th>
						<th className="py-2 px-3 text-center font-medium hidden sm:table-cell">
							V
						</th>
						<th className="py-2 px-3 text-center font-medium hidden sm:table-cell">
							F
						</th>
						<th className="py-2 px-3 text-center font-medium hidden sm:table-cell">
							D
						</th>
						<th className="py-2 px-3 text-center font-medium hidden sm:table-cell">
							Tot
						</th>
						<th className="py-2 pl-3 text-right font-medium">Score</th>
					</tr>
				</thead>
				<tbody>
					<AnimatePresence mode="popLayout">
						{sorted.map((agent, index) => (
							<AgentRow
								key={agent.id}
								agent={agent}
								rank={index + 1}
								phase={phase}
							/>
						))}
					</AnimatePresence>
				</tbody>
			</table>
		</div>
	);
}
