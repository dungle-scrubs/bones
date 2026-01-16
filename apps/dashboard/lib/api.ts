import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
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
	const queryClient = useQueryClient();
	const eventSourceRef = useRef<EventSource | null>(null);
	const sseFailedRef = useRef(false);

	// Set up SSE connection
	useEffect(() => {
		// Reset SSE failure state when gameId changes
		sseFailedRef.current = false;

		const eventSource = new EventSource(
			`${API_BASE}/api/games/${gameId}/events`,
		);
		eventSourceRef.current = eventSource;

		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as GameResponse;
				queryClient.setQueryData(["game", gameId], data);
			} catch {
				// Ignore parse errors
			}
		};

		eventSource.onerror = () => {
			// SSE failed, fall back to polling
			sseFailedRef.current = true;
			eventSource.close();
			eventSourceRef.current = null;
		};

		return () => {
			eventSource.close();
			eventSourceRef.current = null;
		};
	}, [gameId, queryClient]);

	return useQuery({
		queryKey: ["game", gameId],
		queryFn: () => fetchGame(gameId),
		// Only poll if SSE is not connected
		refetchInterval: (query) => {
			// If SSE is connected and working, don't poll
			if (eventSourceRef.current?.readyState === EventSource.OPEN) {
				return false;
			}

			// Fall back to polling
			const phase = query.state.data?.game.phase;
			if (phase === "hunt" || phase === "review") {
				return 1000;
			}
			if (phase === "hunt_scoring" || phase === "review_scoring") {
				return 2000;
			}
			return 5000;
		},
		staleTime: 500,
		retry: 3,
		retryDelay: 1000,
	});
}
