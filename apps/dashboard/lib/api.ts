import { useQuery } from "@tanstack/react-query";
import type { GameResponse } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8019";

async function fetchGame(gameId: string): Promise<GameResponse> {
  const res = await fetch(`${API_BASE}/api/games/${gameId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch game: ${res.statusText}`);
  }
  return res.json();
}

export function useGame(gameId: string) {
  return useQuery({
    queryKey: ["game", gameId],
    queryFn: () => fetchGame(gameId),
    refetchInterval: (query) => {
      // Poll every second during active phases
      const phase = query.state.data?.game.phase;
      if (phase === "hunt" || phase === "review") {
        return 1000;
      }
      // Poll every 2 seconds during scoring
      if (phase === "hunt_scoring" || phase === "review_scoring") {
        return 2000;
      }
      // Poll every 5 seconds otherwise
      return 5000;
    },
    staleTime: 500,
    retry: 3,
    retryDelay: 1000,
  });
}
