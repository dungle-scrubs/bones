"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Clock, Gamepad2, Menu, Play, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8019";

interface GameSummary {
	id: string;
	phase: string;
	isComplete: boolean;
	createdAt: string;
}

interface GamesResponse {
	games: GameSummary[];
}

async function fetchGames(): Promise<GamesResponse> {
	const res = await fetch(`${API_BASE}/api/games`);
	if (!res.ok) throw new Error("Failed to fetch games");
	return res.json();
}

export function Sidebar() {
	const [open, setOpen] = useState(false);
	const pathname = usePathname();

	const { data } = useQuery({
		queryKey: ["sidebar-games"],
		queryFn: fetchGames,
		refetchInterval: 5000,
	});

	const games = data?.games ?? [];

	// Extract current game ID from URL if on a game page
	const currentGameId = pathname?.match(/^\/game\/([^/]+)/)?.[1] ?? null;

	// Close on route change
	useEffect(() => {
		setOpen(false);
	}, []);

	const formatTime = (dateStr: string) => {
		const diff = Date.now() - new Date(dateStr).getTime();
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (mins > 0) return `${mins}m ago`;
		return "just now";
	};

	const getStatusIcon = (phase: string, isComplete: boolean) => {
		if (isComplete)
			return <CheckCircle className="h-3 w-3 text-muted-foreground" />;
		if (phase === "hunt" || phase === "review")
			return <Play className="h-3 w-3 text-green-400" />;
		return <Clock className="h-3 w-3 text-yellow-400" />;
	};

	return (
		<>
			{/* Hamburger button */}
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="fixed top-3 left-3 z-50 p-2 border border-border bg-card hover:bg-secondary hover:border-primary cursor-pointer transition-colors"
				aria-label="Open menu"
			>
				<Menu className="h-5 w-5" />
			</button>

			{/* Backdrop */}
			{open && (
				<div
					className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
					onClick={() => setOpen(false)}
				/>
			)}

			{/* Sidebar panel */}
			<div
				className={cn(
					"fixed top-0 left-0 z-50 h-full w-80 border-r border-border bg-card transform transition-transform duration-200 ease-out",
					open ? "translate-x-0" : "-translate-x-full",
				)}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-border">
					<div className="flex items-center gap-2">
						<Gamepad2 className="h-5 w-5 text-primary" />
						<span className="font-display text-sm font-semibold uppercase tracking-wider">
							Code Hunt
						</span>
					</div>
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="p-1 hover:bg-secondary hover:text-primary cursor-pointer transition-colors"
						aria-label="Close menu"
					>
						<X className="h-5 w-5" />
					</button>
				</div>

				{/* Content */}
				<div className="p-4 space-y-4">
					<div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
						<Clock className="h-3 w-3" />
						Recent Games
					</div>

					{games.length === 0 ? (
						<div className="text-sm text-muted-foreground py-4">
							No games yet. Start one with the CLI.
						</div>
					) : (
						<div className="space-y-1">
							{games.map((game) => {
								const isActive = currentGameId === game.id;
								return (
									<Link
										key={game.id}
										href={`/game/${game.id}`}
										className={cn(
											"group flex items-center gap-3 px-3 py-2 text-sm cursor-pointer transition-colors",
											isActive
												? "bg-primary/10 text-primary border border-primary/30"
												: "hover:bg-secondary hover:border-border border border-transparent",
										)}
									>
										{getStatusIcon(game.phase, game.isComplete)}
										<div className="min-w-0 flex-1">
											<div className="font-mono text-xs truncate">
												{game.id}
											</div>
											<div className="text-[10px] text-muted-foreground">
												{formatTime(game.createdAt)}
											</div>
										</div>
									</Link>
								);
							})}
						</div>
					)}

					<div className="pt-4 border-t border-border">
						<Link href="/">
							<Button variant="outline" size="sm" className="w-full">
								Enter New Game ID
							</Button>
						</Link>
					</div>
				</div>
			</div>
		</>
	);
}
