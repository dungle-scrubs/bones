-- Bug Hunt Game Schema v3
-- Round-based: Hunt phase → Review phase → Score → Repeat

-- Games table
CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    project_url TEXT NOT NULL,
    target_score INTEGER NOT NULL DEFAULT 21,
    hunt_duration INTEGER NOT NULL DEFAULT 180,    -- seconds per hunt phase (default 3 min)
    review_duration INTEGER NOT NULL DEFAULT 120,  -- seconds per review phase (default 2 min)
    num_agents INTEGER NOT NULL,
    categories TEXT NOT NULL,  -- JSON array
    current_round INTEGER NOT NULL DEFAULT 0,
    phase TEXT NOT NULL CHECK(phase IN ('setup', 'hunt', 'hunt_scoring', 'review', 'review_scoring', 'complete')) DEFAULT 'setup',
    phase_ends_at TEXT,
    winner_agent_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
    id TEXT NOT NULL,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    score INTEGER NOT NULL DEFAULT 0,
    bugs_submitted INTEGER NOT NULL DEFAULT 0,
    bugs_valid INTEGER NOT NULL DEFAULT 0,
    bugs_false INTEGER NOT NULL DEFAULT 0,
    bugs_duplicate INTEGER NOT NULL DEFAULT 0,
    disputes_won INTEGER NOT NULL DEFAULT 0,
    disputes_lost INTEGER NOT NULL DEFAULT 0,
    hunt_done_round INTEGER NOT NULL DEFAULT 0,   -- last round agent finished hunting
    review_done_round INTEGER NOT NULL DEFAULT 0, -- last round agent finished reviewing
    status TEXT NOT NULL CHECK(status IN ('active', 'eliminated', 'winner')) DEFAULT 'active',
    last_heartbeat TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (game_id, id)
);

-- Bugs table
CREATE TABLE IF NOT EXISTS bugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line_start INTEGER,
    line_end INTEGER,
    code_snippet TEXT,
    pattern_hash TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'valid', 'false_flag', 'duplicate')) DEFAULT 'pending',
    duplicate_of INTEGER REFERENCES bugs(id),
    referee_verdict TEXT,
    points_awarded INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    validated_at TEXT
);

-- Disputes table
CREATE TABLE IF NOT EXISTS disputes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    bug_id INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
    disputer_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'successful', 'failed')) DEFAULT 'pending',
    referee_verdict TEXT,
    points_awarded INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_bugs_game ON bugs(game_id);
CREATE INDEX IF NOT EXISTS idx_bugs_round ON bugs(game_id, round_number);
CREATE INDEX IF NOT EXISTS idx_bugs_pattern ON bugs(pattern_hash);
CREATE INDEX IF NOT EXISTS idx_disputes_game ON disputes(game_id);
CREATE INDEX IF NOT EXISTS idx_disputes_round ON disputes(game_id, round_number);
