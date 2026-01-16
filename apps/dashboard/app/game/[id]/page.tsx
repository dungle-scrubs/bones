"use client";

import { use, useEffect } from "react";
import { useGame } from "@/lib/api";
import { addRecentGame } from "@/lib/recent-games";
import { GameStatus } from "@/components/game-status";
import { Leaderboard } from "@/components/leaderboard";
import { FindingsTable } from "@/components/findings-table";
import { AlertCircle, Loader2, ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: gameId } = use(params);
  const { data, isLoading, isError, error, refetch, isFetching } = useGame(gameId);

  // Track game visit when data loads
  useEffect(() => {
    if (data) {
      addRecentGame(gameId);
    }
  }, [data, gameId]);

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-12 w-12 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <div className="absolute inset-2 h-8 w-8 border-2 border-muted-foreground/30 border-t-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
          </div>
          <span className="text-sm text-muted-foreground font-mono">Loading game data...</span>
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <div className="flex items-center justify-center gap-2 text-invalid">
            <AlertCircle className="h-5 w-5" />
            <span className="font-display text-lg font-semibold uppercase tracking-wider">
              Connection Failed
            </span>
          </div>
          <p className="text-sm text-muted-foreground font-mono">
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

  if (!data) {
    return null;
  }

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 pl-14">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="font-display text-sm font-bold uppercase tracking-wider">
                Game
                <span className="font-mono text-xs text-muted-foreground ml-2 normal-case tracking-normal">
                  {gameId.slice(0, 8)}...
                </span>
              </h1>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              {isFetching && (
                <RefreshCw className="h-3 w-3 animate-spin text-primary" />
              )}
              <span className="font-mono">
                {new Date(data.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Game status bar */}
        <GameStatus game={data.game} stats={data.stats} />

        {/* Leaderboard */}
        <Leaderboard
          scoreboard={data.scoreboard}
          phase={data.game.phase}
          targetScore={data.game.targetScore}
        />

        {/* Findings table */}
        <FindingsTable gameId={gameId} />
      </div>
    </main>
  );
}
