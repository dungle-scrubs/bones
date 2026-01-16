const STORAGE_KEY = "code-hunt-recent-games";
const MAX_RECENT = 10;

export interface RecentGame {
  id: string;
  visitedAt: number;
}

export function getRecentGames(): RecentGame[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function addRecentGame(gameId: string): void {
  if (typeof window === "undefined") return;
  try {
    const games = getRecentGames().filter((g) => g.id !== gameId);
    games.unshift({ id: gameId, visitedAt: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games.slice(0, MAX_RECENT)));
  } catch {
    // Ignore storage errors
  }
}

export function removeRecentGame(gameId: string): void {
  if (typeof window === "undefined") return;
  try {
    const games = getRecentGames().filter((g) => g.id !== gameId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  } catch {
    // Ignore storage errors
  }
}
