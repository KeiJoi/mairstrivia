import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

const migrations = [
  `CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), refresh_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL);
   CREATE INDEX sessions_user_idx ON sessions(user_id);
   CREATE TABLE games (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), join_code TEXT NOT NULL UNIQUE, venue_name TEXT NOT NULL, game_name TEXT NOT NULL, state TEXT NOT NULL, scoring_json TEXT NOT NULL, active_set_id TEXT, active_question_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT);
   CREATE INDEX games_owner_idx ON games(owner_user_id); CREATE INDEX games_join_idx ON games(join_code);
   CREATE TABLE players (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), display_name TEXT NOT NULL, reconnect_hash TEXT NOT NULL UNIQUE, score INTEGER NOT NULL DEFAULT 0, correct_count INTEGER NOT NULL DEFAULT 0, incorrect_count INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
   CREATE INDEX players_game_idx ON players(game_id);
   CREATE TABLE game_question_sets (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), source_set_id TEXT NOT NULL, title TEXT NOT NULL, set_json TEXT NOT NULL, ordering_mode TEXT NOT NULL, queue_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(game_id, source_set_id));
   CREATE INDEX game_sets_game_idx ON game_question_sets(game_id);
   CREATE TABLE game_question_state (id TEXT PRIMARY KEY, game_set_id TEXT NOT NULL REFERENCES game_question_sets(id), question_id TEXT NOT NULL, state TEXT NOT NULL, ordinal INTEGER NOT NULL, previewed_at TEXT, asked_at TEXT, completed_at TEXT, UNIQUE(game_set_id, question_id));
   CREATE INDEX question_state_set_idx ON game_question_state(game_set_id, state, ordinal);
   CREATE TABLE skipped_questions (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), game_set_id TEXT NOT NULL, question_id TEXT NOT NULL, skipped_at TEXT NOT NULL);
   CREATE TABLE player_question_layouts (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), game_id TEXT NOT NULL REFERENCES games(id), question_id TEXT NOT NULL, choices_json TEXT NOT NULL, correct_answer_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(player_id, question_id));
   CREATE INDEX layouts_lookup_idx ON player_question_layouts(player_id, question_id);
   CREATE TABLE player_answers (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), game_id TEXT NOT NULL REFERENCES games(id), question_id TEXT NOT NULL, answer_id TEXT NOT NULL, is_correct INTEGER NOT NULL, receipt_order INTEGER NOT NULL, received_at TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, points_awarded INTEGER NOT NULL, UNIQUE(player_id, question_id));
   CREATE INDEX answers_game_question_idx ON player_answers(game_id, question_id, receipt_order);
   CREATE TABLE game_history (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX history_game_idx ON game_history(game_id, created_at);`
  , `ALTER TABLE games ADD COLUMN question_time_limit_seconds INTEGER NOT NULL DEFAULT 0 CHECK(question_time_limit_seconds BETWEEN 0 AND 15);`
  , `ALTER TABLE games ADD COLUMN cumulative_scoring INTEGER NOT NULL DEFAULT 0 CHECK(cumulative_scoring IN (0, 1));`
  , `CREATE TABLE games_rebuilt (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), join_code TEXT NOT NULL UNIQUE, venue_name TEXT NOT NULL, game_name TEXT NOT NULL, state TEXT NOT NULL, scoring_json TEXT NOT NULL, active_set_id TEXT, active_question_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT, question_time_limit_seconds INTEGER NOT NULL DEFAULT 0 CHECK(question_time_limit_seconds BETWEEN 0 AND 20), cumulative_scoring INTEGER NOT NULL DEFAULT 0 CHECK(cumulative_scoring IN (0, 1)));
     INSERT INTO games_rebuilt SELECT id, owner_user_id, join_code, venue_name, game_name, state, scoring_json, active_set_id, active_question_id, created_at, updated_at, ended_at, question_time_limit_seconds, cumulative_scoring FROM games;
     DROP TABLE games;
     ALTER TABLE games_rebuilt RENAME TO games;
     CREATE INDEX games_owner_idx ON games(owner_user_id); CREATE INDEX games_join_idx ON games(join_code);`
];

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const current = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  if (current.version < migrations.length) db.pragma("foreign_keys = OFF");
  for (let version = current.version + 1; version <= migrations.length; version++) {
    db.transaction(() => { db.exec(migrations[version - 1]); db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString()); })();
  }
  db.pragma("foreign_keys = ON");
  return db;
}
export type TriviaDb = ReturnType<typeof openDatabase>;
