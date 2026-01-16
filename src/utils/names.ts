// Creative human names for agents - diverse, memorable, short
const AGENT_NAMES = [
	// Classic short names
	"Ada",
	"Max",
	"Zoe",
	"Leo",
	"Ivy",
	"Rex",
	"Mia",
	"Jay",
	"Eve",
	"Kai",
	"Ava",
	"Eli",
	"Uma",
	"Ian",
	"Lia",
	"Neo",
	"Tia",
	"Ash",
	"Sky",
	"Jax",
	// Slightly longer but punchy
	"Luna",
	"Finn",
	"Nova",
	"Cole",
	"Ruby",
	"Dean",
	"Jade",
	"Owen",
	"Aria",
	"Luca",
	"Maya",
	"Theo",
	"Vera",
	"Hugo",
	"Nora",
	"Axel",
	"Cleo",
	"Ezra",
	"Iris",
	"Nico",
	"Quinn",
	"Sage",
	"Wren",
	"Zara",
	"Felix",
	"Hazel",
	"Oscar",
	"Sadie",
	"Viola",
	"Atlas",
] as const;

/**
 * Fisher-Yates shuffle for uniform randomness.
 */
function shuffle<T>(array: T[]): T[] {
	const result = [...array];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

/**
 * Generate unique agent names for a game.
 * Returns names like "maya", "theo", "luna" etc.
 */
export function generateAgentNames(count: number): string[] {
	if (count > AGENT_NAMES.length) {
		throw new Error(
			`Cannot generate ${count} unique names, max is ${AGENT_NAMES.length}`,
		);
	}

	// Shuffle and pick
	const shuffled = shuffle([...AGENT_NAMES]);
	return shuffled.slice(0, count).map((name) => name.toLowerCase());
}
