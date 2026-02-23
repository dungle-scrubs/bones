"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Clock, Menu, Play, X } from "lucide-react";
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
	const currentGameId = pathname?.match(/^\/game\/([^/]+)/)?.[1] ?? null;

	useEffect(() => {
		setOpen(false);
	}, []);

	const formatTime = (dateStr: string) => {
		const diff = Date.now() - new Date(dateStr).getTime();
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (days > 0) return `${days}d`;
		if (hours > 0) return `${hours}h`;
		if (mins > 0) return `${mins}m`;
		return "now";
	};

	const getStatusIcon = (phase: string, isComplete: boolean) => {
		if (isComplete)
			return <CheckCircle className="h-3 w-3 text-muted-foreground" />;
		if (phase === "hunt" || phase === "review")
			return <Play className="h-3 w-3 text-valid" />;
		return <Clock className="h-3 w-3 text-duplicate" />;
	};

	return (
		<>
			{/* Hamburger */}
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="fixed top-3.5 left-3 z-50 p-1.5 hover:bg-secondary transition-colors"
				aria-label="Open menu"
			>
				<Menu className="h-5 w-5" />
			</button>

			{/* Backdrop */}
			{open && (
				<div
					className="fixed inset-0 z-50 bg-foreground/10 backdrop-blur-sm"
					onClick={() => setOpen(false)}
				/>
			)}

			{/* Panel */}
			<div
				className={cn(
					"fixed top-0 left-0 z-50 h-full w-72 border-r border-border bg-background transform transition-transform duration-200 ease-out shadow-lg shadow-foreground/5",
					open ? "translate-x-0" : "-translate-x-full",
				)}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3.5 border-b border-foreground">
					<Link
						href="/"
						className="font-display text-lg font-bold tracking-tight"
						onClick={() => setOpen(false)}
					>
						Bones
					</Link>
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="p-1 hover:bg-secondary transition-colors"
						aria-label="Close menu"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{/* Games list */}
				<div className="p-4 space-y-4">
					<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
						Games
					</span>

					{games.length === 0 ? (
						<p className="text-sm text-muted-foreground py-4 italic">
							No games yet
						</p>
					) : (
						<div className="space-y-0.5">
							{games.map((game) => {
								const isActive = currentGameId === game.id;
								return (
									<Link
										key={game.id}
										href={`/game/${game.id}`}
										onClick={() => setOpen(false)}
										className={cn(
											"group flex items-center gap-2.5 px-2.5 py-2 text-sm transition-colors",
											isActive
												? "bg-foreground text-background"
												: "hover:bg-secondary",
										)}
									>
										<span className={isActive ? "text-background/60" : ""}>
											{getStatusIcon(game.phase, game.isComplete)}
										</span>
										<div className="min-w-0 flex-1">
											<div
												className={cn(
													"font-mono text-xs truncate",
													isActive ? "text-background" : "text-foreground",
												)}
											>
												{game.id}
											</div>
										</div>
										<span
											className={cn(
												"text-[10px] tabular-nums font-mono",
												isActive
													? "text-background/50"
													: "text-muted-foreground",
											)}
										>
											{formatTime(game.createdAt)}
										</span>
									</Link>
								);
							})}
						</div>
					)}

					<div className="pt-4 border-t border-border">
						<Link href="/" onClick={() => setOpen(false)}>
							<Button variant="outline" size="sm" className="w-full">
								Enter Game ID
							</Button>
						</Link>
					</div>
				</div>
			</div>
		</>
	);
}
