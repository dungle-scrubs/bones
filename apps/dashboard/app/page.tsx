"use client";

import { useQuery } from "@tanstack/react-query";
import {
	ArrowRight,
	CheckCircle,
	Clock,
	Crosshair,
	Play,
	Trophy,
	Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
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
			return "text-green-400";
		case "hunt_scoring":
		case "review_scoring":
			return "text-yellow-400";
		case "complete":
			return "text-muted-foreground";
		default:
			return "text-blue-400";
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

	return (
		<main className="min-h-screen flex flex-col items-center p-6 pl-14">
			<div className="w-full max-w-2xl space-y-8 mt-8">
				{/* Logo / Title */}
				<div className="text-center space-y-4">
					<div className="flex items-center justify-center gap-3 mb-6">
						<div className="relative">
							<Crosshair className="h-10 w-10 text-primary" strokeWidth={1.5} />
							<div className="absolute inset-0 flex items-center justify-center">
								<div className="h-2 w-2 bg-primary rounded-full animate-pulse-glow" />
							</div>
						</div>
					</div>
					<h1 className="font-display text-3xl font-bold uppercase tracking-wider">
						Code Hunt
					</h1>
					<p className="text-sm text-muted-foreground max-w-xs mx-auto">
						Real-time race visualization for competitive code review games
					</p>
				</div>

				{/* Input form */}
				<div className="border border-border bg-card p-6 space-y-4">
					<label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-3">
						Enter Game ID
					</label>
					<form onSubmit={handleSubmit} className="flex gap-2">
						<input
							type="text"
							value={gameId}
							onChange={(e) => setGameId(e.target.value)}
							placeholder="my-project-abc123"
							className="flex-1 px-3 py-2 bg-input border border-border text-foreground font-mono text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
						/>
						<Button type="submit" disabled={!gameId.trim()}>
							<span>View</span>
							<ArrowRight className="h-3 w-3" />
						</Button>
					</form>
				</div>

				{/* Games list */}
				<div className="border border-border bg-card">
					<div className="px-4 py-3 border-b border-border">
						<h2 className="text-[10px] text-muted-foreground uppercase tracking-wider">
							Recent Games
						</h2>
					</div>

					{isLoading && (
						<div className="p-8 text-center text-muted-foreground text-sm">
							Loading games...
						</div>
					)}

					{error && (
						<div className="p-8 text-center text-red-400 text-sm">
							Failed to load games. Is the API server running?
						</div>
					)}

					{data && data.games.length === 0 && (
						<div className="p-8 text-center text-muted-foreground text-sm">
							No games yet. Start one with the CLI.
						</div>
					)}

					{data && data.games.length > 0 && (
						<div className="divide-y divide-border">
							{data.games.map((game) => (
								<button
									type="button"
									key={game.id}
									onClick={() => router.push(`/game/${game.id}`)}
									className="w-full px-4 py-3 flex items-center gap-4 hover:bg-muted/50 transition-colors text-left"
								>
									<div
										className={cn("flex-shrink-0", getPhaseColor(game.phase))}
									>
										{getPhaseIcon(game.phase, game.isComplete)}
									</div>

									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-mono text-sm truncate">
												{game.id}
											</span>
											<span className="text-[10px] text-muted-foreground uppercase">
												{game.category}
											</span>
										</div>
										<div className="text-[10px] text-muted-foreground truncate">
											{game.projectUrl}
										</div>
									</div>

									<div className="flex-shrink-0 text-right">
										<div
											className={cn(
												"text-xs font-mono",
												getPhaseColor(game.phase),
											)}
										>
											{game.isComplete ? (
												<span className="flex items-center gap-1">
													<Trophy className="h-3 w-3" />
													{game.winner?.split("-").pop()}
												</span>
											) : (
												<span>
													R{game.round} · {game.phase.replace("_", " ")}
												</span>
											)}
										</div>
										<div className="text-[10px] text-muted-foreground">
											{formatTimeAgo(game.createdAt)}
										</div>
									</div>
								</button>
							))}
						</div>
					)}
				</div>

				{/* Status indicator */}
				<div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
					<Zap className="h-3 w-3" />
					<span>API: </span>
					<code className="font-mono text-muted-foreground/70">
						localhost:8019
					</code>
				</div>
			</div>
		</main>
	);
}
