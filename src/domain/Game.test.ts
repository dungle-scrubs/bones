import { describe, expect, it } from "bun:test";
import { Game } from "./Game.js";
import { type GameConfig, HuntCategory, Phase } from "./types.js";

function createGameConfig(overrides: Partial<GameConfig> = {}): GameConfig {
	return {
		projectUrl: "/test/project",
		category: HuntCategory.Bugs,
		userPrompt: null,
		targetScore: 10,
		huntDuration: 300,
		reviewDuration: 180,
		numAgents: 3,
		maxRounds: 3,
		...overrides,
	};
}

function createGame(
	phase: Phase = Phase.Setup,
	overrides: Partial<GameConfig> = {},
): Game {
	return new Game(
		"test-game-1",
		createGameConfig(overrides),
		phase,
		0,
		null,
		null,
		new Date(),
		null,
	);
}

describe("Game", () => {
	describe("phase transitions", () => {
		it("can transition from Setup to Hunt", () => {
			const game = createGame(Phase.Setup);
			expect(game.canTransitionTo(Phase.Hunt)).toBe(true);
		});

		it("cannot transition from Setup directly to Review", () => {
			const game = createGame(Phase.Setup);
			expect(game.canTransitionTo(Phase.Review)).toBe(false);
		});

		it("cannot transition from Setup to Complete", () => {
			const game = createGame(Phase.Setup);
			expect(game.canTransitionTo(Phase.Complete)).toBe(false);
		});

		it("can transition from Hunt to HuntScoring", () => {
			const game = createGame(Phase.Hunt);
			expect(game.canTransitionTo(Phase.HuntScoring)).toBe(true);
		});

		it("can transition from HuntScoring to Review", () => {
			const game = createGame(Phase.HuntScoring);
			expect(game.canTransitionTo(Phase.Review)).toBe(true);
		});

		it("can transition from Review to ReviewScoring", () => {
			const game = createGame(Phase.Review);
			expect(game.canTransitionTo(Phase.ReviewScoring)).toBe(true);
		});

		it("can transition from ReviewScoring to Hunt (next round)", () => {
			const game = createGame(Phase.ReviewScoring);
			expect(game.canTransitionTo(Phase.Hunt)).toBe(true);
		});

		it("can transition from ReviewScoring to Complete", () => {
			const game = createGame(Phase.ReviewScoring);
			expect(game.canTransitionTo(Phase.Complete)).toBe(true);
		});

		it("cannot transition after game is complete", () => {
			const game = createGame(Phase.Complete);
			expect(game.canTransitionTo(Phase.Hunt)).toBe(false);
			expect(game.canTransitionTo(Phase.Setup)).toBe(false);
		});
	});

	describe("startHuntPhase", () => {
		it("increments round number when starting hunt", () => {
			const game = createGame(Phase.Setup);
			expect(game.round).toBe(0);
			game.startHuntPhase();
			expect(game.round).toBe(1);
			expect(game.phase).toBe(Phase.Hunt);
		});

		it("sets phaseEndsAt based on huntDuration", () => {
			const game = createGame(Phase.Setup, { huntDuration: 300 });
			const before = Date.now();
			game.startHuntPhase();
			const after = Date.now();

			expect(game.phaseEndsAt).not.toBeNull();
			const endsAt = game.phaseEndsAt?.getTime();
			expect(endsAt).toBeGreaterThanOrEqual(before + 300_000);
			expect(endsAt).toBeLessThanOrEqual(after + 300_000);
		});

		it("throws when starting hunt from invalid phase", () => {
			const game = createGame(Phase.Hunt);
			expect(() => game.startHuntPhase()).toThrow(
				"Cannot start hunt from phase: hunt",
			);
		});

		it("can start hunt from ReviewScoring (new round)", () => {
			const game = new Game(
				"test",
				createGameConfig(),
				Phase.ReviewScoring,
				1,
				null,
				null,
				new Date(),
				null,
			);
			game.startHuntPhase();
			expect(game.round).toBe(2);
			expect(game.phase).toBe(Phase.Hunt);
		});
	});

	describe("startReviewPhase", () => {
		it("transitions to review and sets timer", () => {
			const game = new Game(
				"test",
				createGameConfig({ reviewDuration: 180 }),
				Phase.HuntScoring,
				1,
				null,
				null,
				new Date(),
				null,
			);

			const before = Date.now();
			game.startReviewPhase();
			const after = Date.now();

			expect(game.phase).toBe(Phase.Review);
			const endsAt = game.phaseEndsAt?.getTime();
			expect(endsAt).toBeGreaterThanOrEqual(before + 180_000);
			expect(endsAt).toBeLessThanOrEqual(after + 180_000);
		});

		it("throws when starting review from wrong phase", () => {
			const game = createGame(Phase.Hunt);
			expect(() => game.startReviewPhase()).toThrow(
				"Cannot start review from phase: hunt",
			);
		});
	});

	describe("complete", () => {
		it("sets winner and completion time", () => {
			const game = new Game(
				"test",
				createGameConfig(),
				Phase.ReviewScoring,
				1,
				null,
				null,
				new Date(),
				null,
			);

			game.complete("winner-agent");

			expect(game.phase).toBe(Phase.Complete);
			expect(game.winnerId).toBe("winner-agent");
			expect(game.completedAt).not.toBeNull();
			expect(game.isComplete).toBe(true);
		});

		it("throws when completing from wrong phase", () => {
			const game = createGame(Phase.Hunt);
			expect(() => game.complete("agent")).toThrow(
				"Cannot complete game from phase: hunt",
			);
		});
	});

	describe("time tracking", () => {
		it("reports expired when past phaseEndsAt", () => {
			const game = new Game(
				"test",
				createGameConfig(),
				Phase.Hunt,
				1,
				new Date(Date.now() - 1000), // 1 second ago
				null,
				new Date(),
				null,
			);

			expect(game.isPhaseExpired).toBe(true);
			expect(game.timeRemaining).toBe(0);
		});

		it("reports remaining time correctly", () => {
			const game = new Game(
				"test",
				createGameConfig(),
				Phase.Hunt,
				1,
				new Date(Date.now() + 60_000), // 60 seconds from now
				null,
				new Date(),
				null,
			);

			expect(game.isPhaseExpired).toBe(false);
			expect(game.timeRemaining).toBeGreaterThanOrEqual(59);
			expect(game.timeRemaining).toBeLessThanOrEqual(60);
		});
	});

	describe("isTimedPhase", () => {
		it("returns true for Hunt phase", () => {
			const game = createGame(Phase.Hunt);
			expect(game.isTimedPhase).toBe(true);
		});

		it("returns true for Review phase", () => {
			const game = createGame(Phase.Review);
			expect(game.isTimedPhase).toBe(true);
		});

		it("returns false for scoring phases", () => {
			expect(createGame(Phase.HuntScoring).isTimedPhase).toBe(false);
			expect(createGame(Phase.ReviewScoring).isTimedPhase).toBe(false);
		});
	});

	describe("fromRow/toRow serialization", () => {
		it("round-trips through database row format", () => {
			const original = new Game(
				"test-id",
				createGameConfig({ category: HuntCategory.Security }),
				Phase.Hunt,
				2,
				new Date("2024-01-15T10:00:00Z"),
				null,
				new Date("2024-01-15T09:00:00Z"),
				null,
			);

			const row = original.toRow();
			const restored = Game.fromRow(row);

			expect(restored.id).toBe(original.id);
			expect(restored.phase).toBe(original.phase);
			expect(restored.round).toBe(original.round);
			expect(restored.category).toBe(HuntCategory.Security);
			expect(restored.config.targetScore).toBe(original.config.targetScore);
		});

		it("handles null phaseEndsAt", () => {
			const game = createGame(Phase.Setup);
			const row = game.toRow();
			expect(row.phase_ends_at).toBeNull();

			const restored = Game.fromRow(row);
			expect(restored.phaseEndsAt).toBeNull();
		});
	});
});
