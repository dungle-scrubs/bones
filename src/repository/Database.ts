import { Database as BunDatabase } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * SQLite schema for Bones game state.
 * Defines tables for games, agents, findings, and disputes with foreign key relationships.
 */
const SCHEMA = `
-- Games table
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  project_url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'bugs',
  user_prompt TEXT,
  target_score INTEGER NOT NULL,
  hunt_duration INTEGER NOT NULL,
  review_duration INTEGER NOT NULL,
  num_agents INTEGER NOT NULL,
  max_rounds INTEGER DEFAULT 3,
  current_round INTEGER DEFAULT 0,
  phase TEXT DEFAULT 'setup',
  phase_ends_at TEXT,
  winner_agent_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  findings_submitted INTEGER DEFAULT 0,
  findings_valid INTEGER DEFAULT 0,
  findings_false INTEGER DEFAULT 0,
  findings_duplicate INTEGER DEFAULT 0,
  disputes_won INTEGER DEFAULT 0,
  disputes_lost INTEGER DEFAULT 0,
  hunt_done_round INTEGER DEFAULT 0,
  review_done_round INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  last_heartbeat TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Findings table (generic - was bugs)
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  description TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  code_snippet TEXT,
  pattern_hash TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  duplicate_of INTEGER,
  referee_verdict TEXT,
  confidence TEXT,
  points_awarded INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  validated_at TEXT,
  confidence_score INTEGER,
  issue_type TEXT,
  impact_tier TEXT,
  rejection_reason TEXT,
  verification_status TEXT DEFAULT 'none',
  verifier_explanation TEXT,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (duplicate_of) REFERENCES findings(id)
);

-- Disputes table
CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  finding_id INTEGER NOT NULL,
  disputer_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  referee_verdict TEXT,
  points_awarded INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE CASCADE,
  FOREIGN KEY (disputer_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agents_game ON agents(game_id);
CREATE INDEX IF NOT EXISTS idx_findings_game ON findings(game_id);
CREATE INDEX IF NOT EXISTS idx_findings_agent ON findings(agent_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_pattern ON findings(pattern_hash);
CREATE INDEX IF NOT EXISTS idx_disputes_game ON disputes(game_id);
CREATE INDEX IF NOT EXISTS idx_disputes_finding ON disputes(finding_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
`;

/**
 * Manages SQLite database connection and schema migrations.
 * Provides transaction support and ensures data directory exists.
 * Uses WAL mode for better concurrent read performance.
 */
export class Database {
	private db: BunDatabase;

	constructor(dbPath: string) {
		// Ensure directory exists
		const dir = dirname(dbPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		this.db = new BunDatabase(dbPath);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA foreign_keys = ON");
		this.migrate();
	}

	/**
	 * Runs schema migrations to create/update tables.
	 * Idempotent - safe to run on existing databases.
	 */
	private migrate(): void {
		this.db.exec(SCHEMA);
		// Add max_rounds column if missing (migration for existing DBs)
		try {
			this.db.exec("ALTER TABLE games ADD COLUMN max_rounds INTEGER DEFAULT 3");
		} catch {
			// Column already exists
		}
		// Add confidence column if missing (migration for existing DBs)
		try {
			this.db.exec("ALTER TABLE findings ADD COLUMN confidence TEXT");
		} catch {
			// Column already exists
		}
		// Add verification columns if missing (migration for existing DBs)
		try {
			this.db.exec("ALTER TABLE findings ADD COLUMN confidence_score INTEGER");
		} catch {
			// Column already exists
		}
		// Migration: rename bug_category to issue_type, add impact_tier and rejection_reason
		try {
			this.db.exec("ALTER TABLE findings ADD COLUMN issue_type TEXT");
		} catch {
			// Column already exists
		}
		// Data migration — only runs if legacy bug_category column exists
		try {
			this.db.exec(
				"UPDATE findings SET issue_type = bug_category WHERE issue_type IS NULL AND bug_category IS NOT NULL",
			);
		} catch {
			// bug_category column doesn't exist on fresh DBs — safe to skip
		}
		try {
			this.db.exec("ALTER TABLE findings ADD COLUMN impact_tier TEXT");
		} catch {
			// Column already exists
		}
		try {
			this.db.exec("ALTER TABLE findings ADD COLUMN rejection_reason TEXT");
		} catch {
			// Column already exists
		}
		try {
			this.db.exec(
				"ALTER TABLE findings ADD COLUMN verification_status TEXT DEFAULT 'none'",
			);
		} catch {
			// Column already exists
		}
		try {
			this.db.exec("ALTER TABLE findings ADD COLUMN verifier_explanation TEXT");
		} catch {
			// Column already exists
		}
		// Migrate from hunt_prompt to category/user_prompt
		try {
			this.db.exec(
				"ALTER TABLE games ADD COLUMN category TEXT NOT NULL DEFAULT 'bugs'",
			);
		} catch {
			// Column already exists
		}
		try {
			this.db.exec("ALTER TABLE games ADD COLUMN user_prompt TEXT");
		} catch {
			// Column already exists
		}
		// Data migration — only runs if legacy hunt_prompt column exists
		try {
			this.db.exec(
				"UPDATE games SET user_prompt = hunt_prompt WHERE user_prompt IS NULL AND hunt_prompt IS NOT NULL",
			);
		} catch {
			// Column already exists
		}
	}

	/** Exposes the raw SQLite connection for repository layer queries. */
	get connection(): BunDatabase {
		return this.db;
	}

	/** Closes the database connection. Call when shutting down. */
	close(): void {
		this.db.close();
	}

	/**
	 * Wraps a function in a database transaction.
	 * Commits on success, rolls back on error.
	 */
	transaction<T>(fn: () => T): T {
		return this.db.transaction(fn)();
	}
}
