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

  // --- Phase 2: question occurrences (repeat/revisit + cross-set collision fix) ---
  // Every actual ASKING of a question (first time or a later Repeat) gets its own occurrence row.
  // Player layouts/answers key on occurrence_id instead of the bare source question UUID, so two
  // different sets that happen to reuse a question UUID (or a repeated question) never collide.
  , `CREATE TABLE question_occurrences (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), game_set_id TEXT NOT NULL REFERENCES game_question_sets(id), question_id TEXT NOT NULL, occurrence_ordinal INTEGER NOT NULL, is_repeat INTEGER NOT NULL DEFAULT 0, opened_at TEXT NOT NULL, closes_at TEXT, closed_at TEXT, close_reason TEXT, created_at TEXT NOT NULL, UNIQUE(game_set_id, question_id, occurrence_ordinal));
     CREATE INDEX occurrences_game_idx ON question_occurrences(game_id);
     CREATE INDEX occurrences_lookup_idx ON question_occurrences(game_set_id, question_id, occurrence_ordinal);
     ALTER TABLE games ADD COLUMN active_occurrence_id TEXT;
     -- Backfill: one synthetic first occurrence per already-asked (game_set,question) pair, from existing timestamps.
     INSERT INTO question_occurrences (id, game_id, game_set_id, question_id, occurrence_ordinal, is_repeat, opened_at, closes_at, closed_at, close_reason, created_at)
       SELECT lower(hex(randomblob(16))), s.game_id, qs.game_set_id, qs.question_id, 1, 0, qs.asked_at,
              CASE WHEN g.question_time_limit_seconds > 0 THEN datetime(qs.asked_at, '+' || g.question_time_limit_seconds || ' seconds') ELSE NULL END,
              qs.completed_at, CASE WHEN qs.completed_at IS NOT NULL THEN 'host' ELSE NULL END, qs.asked_at
         FROM game_question_state qs JOIN game_question_sets s ON s.id = qs.game_set_id JOIN games g ON g.id = s.game_id
        WHERE qs.asked_at IS NOT NULL;
     UPDATE games SET active_occurrence_id = (
       SELECT o.id FROM question_occurrences o JOIN game_question_sets s ON s.id = o.game_set_id
        WHERE s.game_id = games.id AND o.question_id = games.active_question_id ORDER BY o.occurrence_ordinal DESC LIMIT 1
     ) WHERE active_question_id IS NOT NULL;`

  // --- Phase 2: re-key layouts/answers on occurrence_id; add scoring-component breakdown ---
  , `CREATE TABLE player_question_layouts_rebuilt (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), game_id TEXT NOT NULL REFERENCES games(id), occurrence_id TEXT NOT NULL REFERENCES question_occurrences(id), choices_json TEXT NOT NULL, correct_answer_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(player_id, occurrence_id));
     -- Historical rows never recorded which attached set they belonged to; if two sibling sets on the
     -- same game happened to reuse a question UUID (the very collision this migration fixes going
     -- forward) the join below is ambiguous for that old row, so OR IGNORE drops it rather than failing
     -- the migration. New gameplay after this migration can never produce that ambiguity again.
     INSERT OR IGNORE INTO player_question_layouts_rebuilt (id, player_id, game_id, occurrence_id, choices_json, correct_answer_id, created_at)
       SELECT l.id, l.player_id, l.game_id, o.id, l.choices_json, l.correct_answer_id, l.created_at
         FROM player_question_layouts l
         JOIN game_question_sets s ON s.game_id = l.game_id
         JOIN question_occurrences o ON o.game_set_id = s.id AND o.question_id = l.question_id AND o.occurrence_ordinal = 1;
     DROP TABLE player_question_layouts;
     ALTER TABLE player_question_layouts_rebuilt RENAME TO player_question_layouts;
     CREATE INDEX layouts_lookup_idx ON player_question_layouts(player_id, occurrence_id);

     CREATE TABLE player_answers_rebuilt (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), game_id TEXT NOT NULL REFERENCES games(id), occurrence_id TEXT NOT NULL REFERENCES question_occurrences(id), answer_id TEXT NOT NULL, is_correct INTEGER NOT NULL, receipt_order INTEGER NOT NULL, received_at TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, base_points INTEGER NOT NULL DEFAULT 0, first_correct_bonus INTEGER NOT NULL DEFAULT 0, time_bonus INTEGER NOT NULL DEFAULT 0, points_awarded INTEGER NOT NULL, UNIQUE(player_id, occurrence_id));
     INSERT OR IGNORE INTO player_answers_rebuilt (id, player_id, game_id, occurrence_id, answer_id, is_correct, receipt_order, received_at, elapsed_ms, base_points, first_correct_bonus, time_bonus, points_awarded)
       SELECT a.id, a.player_id, a.game_id, o.id, a.answer_id, a.is_correct, a.receipt_order, a.received_at, a.elapsed_ms, a.points_awarded, 0, 0, a.points_awarded
         FROM player_answers a
         JOIN game_question_sets s ON s.game_id = a.game_id
         JOIN question_occurrences o ON o.game_set_id = s.id AND o.question_id = a.question_id AND o.occurrence_ordinal = 1;
     DROP TABLE player_answers;
     ALTER TABLE player_answers_rebuilt RENAME TO player_answers;
     CREATE INDEX answers_occurrence_idx ON player_answers(game_id, occurrence_id, receipt_order);`

  // --- Phase 2: soft player removal (game kick) ---
  , `ALTER TABLE players ADD COLUMN removed_at TEXT;`

  // --- Phase 2: Game Series ---
  , `CREATE TABLE series (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), join_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, state TEXT NOT NULL, current_game_id TEXT REFERENCES games(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT);
     CREATE INDEX series_owner_idx ON series(owner_user_id); CREATE INDEX series_join_idx ON series(join_code);
     CREATE TABLE series_participants (id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id), display_name TEXT NOT NULL, reconnect_hash TEXT NOT NULL UNIQUE, joined_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, removed_at TEXT);
     CREATE INDEX series_participants_series_idx ON series_participants(series_id);
     CREATE TABLE series_games (id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id), game_id TEXT NOT NULL UNIQUE REFERENCES games(id), sequence_ordinal INTEGER NOT NULL, created_at TEXT NOT NULL);
     CREATE INDEX series_games_series_idx ON series_games(series_id, sequence_ordinal);
     CREATE TABLE series_game_players (id TEXT PRIMARY KEY, series_participant_id TEXT NOT NULL REFERENCES series_participants(id), game_id TEXT NOT NULL REFERENCES games(id), player_id TEXT NOT NULL UNIQUE REFERENCES players(id), created_at TEXT NOT NULL, UNIQUE(series_participant_id, game_id));
     CREATE INDEX series_game_players_participant_idx ON series_game_players(series_participant_id);
     CREATE TABLE series_history (id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id), event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
     CREATE INDEX series_history_idx ON series_history(series_id, created_at);`

  // --- Phase 2: auditable manual score adjustments ---
  , `CREATE TABLE score_adjustments (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), player_id TEXT NOT NULL REFERENCES players(id), series_id TEXT REFERENCES series(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, adjusted_by_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
     CREATE INDEX score_adjustments_player_idx ON score_adjustments(player_id);
     CREATE INDEX score_adjustments_game_idx ON score_adjustments(game_id);`

  // --- Phase 3: no-answer scoring — answer_id becomes nullable so a question close can record an authoritative
  // "this eligible player never answered" row (answer_id IS NULL) distinct from "answered incorrectly"
  // (answer_id set, is_correct=0), while still applying the same configured incorrectPoints to both.
  , `CREATE TABLE player_answers_rebuilt2 (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), game_id TEXT NOT NULL REFERENCES games(id), occurrence_id TEXT NOT NULL REFERENCES question_occurrences(id), answer_id TEXT, is_correct INTEGER NOT NULL, receipt_order INTEGER NOT NULL, received_at TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, base_points INTEGER NOT NULL DEFAULT 0, first_correct_bonus INTEGER NOT NULL DEFAULT 0, time_bonus INTEGER NOT NULL DEFAULT 0, points_awarded INTEGER NOT NULL, UNIQUE(player_id, occurrence_id));
     INSERT INTO player_answers_rebuilt2 SELECT id, player_id, game_id, occurrence_id, answer_id, is_correct, receipt_order, received_at, elapsed_ms, base_points, first_correct_bonus, time_bonus, points_awarded FROM player_answers;
     DROP TABLE player_answers;
     ALTER TABLE player_answers_rebuilt2 RENAME TO player_answers;
     CREATE INDEX answers_occurrence_idx ON player_answers(game_id, occurrence_id, receipt_order);`
];

/** Exported only so migration tests can construct a pre-Phase-2 database and verify the upgrade path, not just clean-database creation. */
export const schemaMigrations = migrations;

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
