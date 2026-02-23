"use client";

import { ArrowLeft, Check, Copy, RefreshCw } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { FindingsTable } from "@/components/findings-table";
import { GameStatus } from "@/components/game-status";
import { Leaderboard } from "@/components/leaderboard";
import { Button } from "@/components/ui/button";
import { useGame } from "@/lib/api";
import { addRecentGame } from "@/lib/recent-games";

export default function GamePage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id: gameId } = use(params);
	const { data, isLoading, isError, error, refetch, isFetching } =
		useGame(gameId);
	const [copied, setCopied] = useState(false);

	const copyGameId = useCallback(() => {
		navigator.clipboard.writeText(gameId);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [gameId]);

	useEffect(() => {
		if (data) {
			addRecentGame(gameId);
		}
	}, [data, gameId]);

	if (isLoading) {
		return (
			<main className="min-h-screen flex items-center justify-center">
				<p className="text-sm text-muted-foreground">Loading game…</p>
			</main>
		);
	}

	if (isError) {
		return (
			<main className="min-h-screen flex items-center justify-center p-6">
				<div className="text-center space-y-4 max-w-md">
					<h1 className="font-display text-xl font-bold">Connection Failed</h1>
					<p className="text-sm text-muted-foreground">
						{error instanceof Error ? error.message : "Unknown error"}
					</p>
					<div className="flex items-center justify-center gap-3 pt-2">
						<Button variant="outline" size="sm" onClick={() => refetch()}>
							<RefreshCw className="h-3 w-3 mr-2" />
							Retry
						</Button>
						<Link href="/">
							<Button variant="ghost" size="sm">
								<ArrowLeft className="h-3 w-3 mr-2" />
								Back
							</Button>
						</Link>
					</div>
				</div>
			</main>
		);
	}

	if (!data) return null;

	return (
		<main className="min-h-screen">
			{/* Header */}
			<header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
				<div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 pl-14">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Link
								href="/"
								className="text-xs text-muted-foreground hover:text-foreground transition-colors"
							>
								<ArrowLeft className="h-3 w-3" />
							</Link>
							<h1 className="font-display text-sm font-semibold">Game</h1>
							<span className="font-mono text-xs text-muted-foreground">
								{gameId}
							</span>
							<button
								type="button"
								onClick={copyGameId}
								className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
								title="Copy game ID"
							>
								{copied ? (
									<Check className="h-3 w-3 text-valid" />
								) : (
									<Copy className="h-3 w-3" />
								)}
							</button>
						</div>
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							{isFetching && <RefreshCw className="h-3 w-3 animate-spin" />}
							<span className="font-mono tabular-nums">
								{new Date(data.timestamp).toLocaleTimeString()}
							</span>
						</div>
					</div>
				</div>
			</header>

			{/* Content */}
			<div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-10">
				<GameStatus game={data.game} stats={data.stats} />

				<Leaderboard
					scoreboard={data.scoreboard}
					phase={data.game.phase}
					targetScore={data.game.targetScore}
				/>

				<FindingsTable gameId={gameId} />
			</div>
		</main>
	);
}
