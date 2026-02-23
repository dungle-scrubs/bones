"use client";

import { useQuery } from "@tanstack/react-query";
import {
	ArrowRight,
	Check,
	CheckCircle,
	Clock,
	Copy,
	Play,
	Trophy,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8019";

interface GameSummary {
	id: string;
	projectUrl: string;
	category: string;
	phase: string;
	round: number;
	targetScore: number;
	isComplete: boolean;
	winner: string | null;
	createdAt: string;
	completedAt: string | null;
}

interface GamesResponse {
	games: GameSummary[];
	timestamp: string;
}

async function fetchGames(): Promise<GamesResponse> {
	const res = await fetch(`${API_BASE}/api/games`);
	if (!res.ok) throw new Error("Failed to fetch games");
	return res.json();
}

function getPhaseColor(phase: string): string {
	switch (phase) {
		case "hunt":
		case "review":
			return "text-valid";
		case "hunt_scoring":
		case "review_scoring":
			return "text-scoring";
		case "complete":
			return "text-muted-foreground";
		default:
			return "text-review";
	}
}

function getPhaseIcon(phase: string, isComplete: boolean) {
	if (isComplete) return <CheckCircle className="h-3 w-3" />;
	if (phase === "hunt" || phase === "review")
		return <Play className="h-3 w-3" />;
	return <Clock className="h-3 w-3" />;
}

function formatTimeAgo(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	return `${diffDays}d ago`;
}

export default function Home() {
	const router = useRouter();
	const [gameId, setGameId] = useState("");
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const copyGameId = useCallback(
		(id: string, e: React.MouseEvent | React.SyntheticEvent) => {
			e.stopPropagation();
			e.preventDefault();
			navigator.clipboard.writeText(id);
			setCopiedId(id);
			setTimeout(() => setCopiedId(null), 1500);
		},
		[],
	);

	const { data, isLoading, error } = useQuery({
		queryKey: ["games"],
		queryFn: fetchGames,
		refetchInterval: 5000,
	});

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const trimmed = gameId.trim();
		if (trimmed) {
			router.push(`/game/${trimmed}`);
		}
	}

	const activeGames = data?.games.filter((g) => !g.isComplete) ?? [];
	const completedGames = data?.games.filter((g) => g.isComplete) ?? [];

	return (
		<main className="min-h-screen pl-14">
			<div className="max-w-2xl mx-auto px-6 py-12">
				{/* Masthead */}
				<header className="mb-16">
					<div className="editorial-rule-thick mb-4" />
					<h1 className="font-display text-6xl font-bold tracking-tight leading-none">
						Bones
					</h1>
					<p className="mt-3 text-muted-foreground text-sm max-w-sm">
						Competitive multi-agent code review. Agents hunt for bugs, dispute
						findings, and race to the target score.
					</p>
					<div className="editorial-rule mt-4" />
				</header>

				{/* Game ID input */}
				<section className="mb-16">
					<h2 className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
						Go to Game
					</h2>
					<form onSubmit={handleSubmit} className="flex gap-3">
						<input
							type="text"
							value={gameId}
							onChange={(e) => setGameId(e.target.value)}
							placeholder="Enter a game ID"
							className="flex-1 px-3 py-2 bg-transparent border-b-2 border-foreground/20 text-foreground font-mono text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
						/>
						<Button type="submit" disabled={!gameId.trim()}>
							<span>View</span>
							<ArrowRight className="h-3 w-3" />
						</Button>
					</form>
				</section>

				{/* Loading */}
				{isLoading && (
					<p className="text-sm text-muted-foreground">Loading games…</p>
				)}

				{/* Error */}
				{error && (
					<p className="text-sm text-destructive">
						Failed to load games. Is the API server running on :8019?
					</p>
				)}

				{/* Active Games */}
				{activeGames.length > 0 && (
					<section className="mb-12">
						<div className="flex items-baseline justify-between mb-3">
							<h2 className="font-display text-lg font-semibold">Live</h2>
							<span className="text-xs text-muted-foreground tabular-nums">
								{activeGames.length} game{activeGames.length !== 1 && "s"}
							</span>
						</div>
						<div className="editorial-rule-double mb-4" />

						<div className="divide-y divide-border">
							{activeGames.map((game) => (
								<button
									type="button"
									key={game.id}
									onClick={() => router.push(`/game/${game.id}`)}
									className="w-full py-3 flex items-center gap-4 hover:bg-secondary/50 transition-colors text-left group"
								>
									<div
										className={cn("flex-shrink-0", getPhaseColor(game.phase))}
									>
										{getPhaseIcon(game.phase, game.isComplete)}
									</div>

									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-mono text-sm font-medium truncate group-hover:text-primary transition-colors">
												{game.id}
											</span>
											<button
												type="button"
												onClickCapture={(e) => copyGameId(game.id, e)}
												className="flex-shrink-0 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
												title="Copy game ID"
											>
												{copiedId === game.id ? (
													<Check className="h-3 w-3 text-valid" />
												) : (
													<Copy className="h-3 w-3" />
												)}
											</button>
										</div>
										<div className="text-xs text-muted-foreground truncate mt-0.5">
											{game.category} · {game.projectUrl}
										</div>
									</div>

									<div className="flex-shrink-0 text-right">
										<div
											className={cn(
												"text-xs font-mono font-medium",
												getPhaseColor(game.phase),
											)}
										>
											R{game.round} · {game.phase.replace("_", " ")}
										</div>
										<div className="text-xs text-muted-foreground mt-0.5">
											{formatTimeAgo(game.createdAt)}
										</div>
									</div>
								</button>
							))}
						</div>
					</section>
				)}

				{/* Completed Games */}
				{completedGames.length > 0 && (
					<section className="mb-12">
						<div className="flex items-baseline justify-between mb-3">
							<h2 className="font-display text-lg font-semibold">Completed</h2>
							<span className="text-xs text-muted-foreground tabular-nums">
								{completedGames.length} game{completedGames.length !== 1 && "s"}
							</span>
						</div>
						<div className="editorial-rule mb-4" />

						<div className="divide-y divide-border">
							{completedGames.map((game) => (
								<button
									type="button"
									key={game.id}
									onClick={() => router.push(`/game/${game.id}`)}
									className="w-full py-3 flex items-center gap-4 hover:bg-secondary/50 transition-colors text-left group"
								>
									<div className="flex-shrink-0 text-muted-foreground">
										<CheckCircle className="h-3 w-3" />
									</div>

									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-mono text-sm truncate group-hover:text-primary transition-colors">
												{game.id}
											</span>
											<button
												type="button"
												onClickCapture={(e) => copyGameId(game.id, e)}
												className="flex-shrink-0 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
												title="Copy game ID"
											>
												{copiedId === game.id ? (
													<Check className="h-3 w-3 text-valid" />
												) : (
													<Copy className="h-3 w-3" />
												)}
											</button>
											<span className="text-xs text-muted-foreground">
												{game.category}
											</span>
										</div>
									</div>

									<div className="flex-shrink-0 text-right">
										{game.winner ? (
											<span className="flex items-center gap-1 text-xs font-medium text-accent">
												<Trophy className="h-3 w-3" />
												{game.winner.split("-").pop()}
											</span>
										) : (
											<span className="text-xs text-muted-foreground">
												No winner
											</span>
										)}
										<div className="text-xs text-muted-foreground mt-0.5">
											{formatTimeAgo(game.createdAt)}
										</div>
									</div>
								</button>
							))}
						</div>
					</section>
				)}

				{/* Empty state */}
				{data && data.games.length === 0 && (
					<section className="py-12 text-center">
						<p className="font-display text-lg text-muted-foreground italic">
							No games yet
						</p>
						<p className="text-sm text-muted-foreground mt-2">
							Start one with{" "}
							<code className="font-mono text-foreground bg-secondary px-1.5 py-0.5">
								bones start
							</code>
						</p>
					</section>
				)}

				{/* Footer */}
				<footer className="pt-8 mt-8 border-t border-border">
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>API: localhost:8019</span>
						<span>Polling every 5s</span>
					</div>
				</footer>
			</div>
		</main>
	);
}
