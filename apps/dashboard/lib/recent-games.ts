const STORAGE_KEY = "code-hunt-recent-games";
const MAX_RECENT = 10;

/** Check if we're in a browser with working localStorage */
function canUseLocalStorage(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			typeof window.localStorage !== "undefined" &&
			typeof window.localStorage.getItem === "function"
		);
	} catch {
		return false;
	}
}

export interface RecentGame {
	id: string;
	visitedAt: number;
}

export function getRecentGames(): RecentGame[] {
	if (!canUseLocalStorage()) return [];
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

export function addRecentGame(gameId: string): void {
	if (!canUseLocalStorage()) return;
	try {
		const games = getRecentGames().filter((g) => g.id !== gameId);
		games.unshift({ id: gameId, visitedAt: Date.now() });
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify(games.slice(0, MAX_RECENT)),
		);
	} catch {
		// Ignore storage errors
	}
}

export function removeRecentGame(gameId: string): void {
	if (!canUseLocalStorage()) return;
	try {
		const games = getRecentGames().filter((g) => g.id !== gameId);
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
	} catch {
		// Ignore storage errors
	}
}
