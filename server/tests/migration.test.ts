import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, schemaMigrations } from "../src/db.js";

/** Builds a database frozen at the pre-Phase-2 schema (only the first 3 original migrations), with legacy-shaped rows,
 *  so the Phase 2 migrations can be exercised against real pre-existing data rather than only a clean database. */
function buildLegacyDatabase(path: string) {
  const legacyMigrationCount = 3;
  const db = new Database(path);
  db.pragma("foreign_keys = OFF");
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (let version = 1; version <= legacyMigrationCount; version++) {
    db.exec(schemaMigrations[version - 1]);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
  }
  const ownerId = "u1", gameId = "g1", setId = "s1", q1 = "q1", q2 = "q2", p1 = "p1", p2 = "p2";
  db.prepare("INSERT INTO users VALUES (?,?,?,?)").run(ownerId, "legacy-host", "hash", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO games (id,owner_user_id,join_code,venue_name,game_name,state,scoring_json,active_set_id,active_question_id,created_at,updated_at,ended_at,question_time_limit_seconds,cumulative_scoring) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(gameId, ownerId, "ABC123", "Legacy Venue", "Legacy Game", "results", JSON.stringify({ correctPoints: 100, incorrectPoints: 0, firstCorrectBonus: 50, allowAnswerChange: false }), setId, q1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:05:00.000Z", null, 0, 0);
  db.prepare("INSERT INTO game_question_sets VALUES (?,?,?,?,?,?,?,?)").run(setId, gameId, "source-1", "Legacy Set", JSON.stringify({ format: "fftrivia-question-set", schemaVersion: 2, id: "source-1", title: "Legacy Set", description: "", author: "Kei Joi", version: "1.0.0", categories: [], tags: [], questions: [{ id: q1, question: "Q1?", correctAnswer: "Right", incorrectAnswers: ["A", "B", "C"], category: null, tags: [] }, { id: q2, question: "Q2?", correctAnswer: "Right2", incorrectAnswers: ["A", "B", "C"], category: null, tags: [] }] }), "inOrder", JSON.stringify([q1, q2]), "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO game_question_state VALUES (?,?,?,?,?,?,?,?)").run("gqs1", setId, q1, "completed", 0, "2026-01-01T00:00:30.000Z", "2026-01-01T00:01:00.000Z", "2026-01-01T00:01:30.000Z");
  db.prepare("INSERT INTO game_question_state VALUES (?,?,?,?,?,?,?,?)").run("gqs2", setId, q2, "unused", 1, null, null, null);
  db.prepare("INSERT INTO players VALUES (?,?,?,?,?,?,?,?,?)").run(p1, gameId, "Alice", "hash-alice", 150, 1, 0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:01:00.000Z");
  db.prepare("INSERT INTO players VALUES (?,?,?,?,?,?,?,?,?)").run(p2, gameId, "Bob", "hash-bob", 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:01:00.000Z");
  db.prepare("INSERT INTO player_question_layouts VALUES (?,?,?,?,?,?,?)").run("l1", p1, gameId, q1, JSON.stringify([{ id: "c1", text: "Right" }, { id: "c2", text: "A" }]), "c1", "2026-01-01T00:00:30.000Z");
  db.prepare("INSERT INTO player_question_layouts VALUES (?,?,?,?,?,?,?)").run("l2", p2, gameId, q1, JSON.stringify([{ id: "c3", text: "Right" }, { id: "c4", text: "A" }]), "c3", "2026-01-01T00:00:30.000Z");
  db.prepare("INSERT INTO player_answers VALUES (?,?,?,?,?,?,?,?,?,?)").run("a1", p1, gameId, q1, "c1", 1, 1, "2026-01-01T00:00:45.000Z", 15000, 150);
  db.prepare("INSERT INTO player_answers VALUES (?,?,?,?,?,?,?,?,?,?)").run("a2", p2, gameId, q1, "c4", 0, 2, "2026-01-01T00:00:50.000Z", 20000, 0);
  db.prepare("INSERT INTO game_history VALUES (?,?,?,?,?)").run("h1", gameId, "game.created", "{}", "2026-01-01T00:00:00.000Z");
  db.pragma("foreign_keys = ON");
  db.close();
  return { ownerId, gameId, setId, q1, q2, p1, p2 };
}

describe("Phase 2 migration upgrades a pre-existing database, not only a clean one", () => {
  it("backfills question occurrences and re-keys layouts/answers without losing data", () => {
    const dir = mkdtempSync(join(tmpdir(), "mairs-migration-"));
    const path = join(dir, "legacy.sqlite");
    try {
      const legacy = buildLegacyDatabase(path);
      const db = openDatabase(path); // applies every Phase 2 migration on top of the legacy rows just inserted

      const occurrences = db.prepare("SELECT * FROM question_occurrences WHERE game_id=?").all(legacy.gameId) as any[];
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0]).toMatchObject({ question_id: legacy.q1, occurrence_ordinal: 1, is_repeat: 0 });

      const game = db.prepare("SELECT active_occurrence_id FROM games WHERE id=?").get(legacy.gameId) as { active_occurrence_id: string };
      expect(game.active_occurrence_id).toBe(occurrences[0].id);

      const layouts = db.prepare("SELECT * FROM player_question_layouts WHERE game_id=?").all(legacy.gameId) as any[];
      expect(layouts).toHaveLength(2);
      expect(layouts.every((l) => l.occurrence_id === occurrences[0].id)).toBe(true);

      const answers = db.prepare("SELECT * FROM player_answers WHERE game_id=? ORDER BY receipt_order").all(legacy.gameId) as any[];
      expect(answers).toHaveLength(2);
      expect(answers[0]).toMatchObject({ occurrence_id: occurrences[0].id, is_correct: 1, points_awarded: 150, base_points: 150, first_correct_bonus: 0, time_bonus: 0 });
      expect(answers[1]).toMatchObject({ occurrence_id: occurrences[0].id, is_correct: 0, points_awarded: 0 });

      // Preexisting players/history/scores are untouched by the upgrade.
      const players = db.prepare("SELECT display_name,score,removed_at FROM players WHERE game_id=? ORDER BY display_name").all(legacy.gameId) as any[];
      expect(players).toEqual([{ display_name: "Alice", score: 150, removed_at: null }, { display_name: "Bob", score: 0, removed_at: null }]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM game_history WHERE game_id=?").get(legacy.gameId)).toMatchObject({ n: 1 });

      // The still-unused second question and its own progression state survive untouched.
      const secondState = db.prepare("SELECT state FROM game_question_state WHERE question_id=?").get(legacy.q2) as { state: string };
      expect(secondState.state).toBe("unused");
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("running the migration set twice is a no-op (idempotent re-open)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mairs-migration-idempotent-"));
    const path = join(dir, "trivia.sqlite");
    try {
      openDatabase(path).close();
      const db = openDatabase(path); // second open must not re-run or duplicate any migration
      const versions = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
      expect(versions.n).toBe(schemaMigrations.length);
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
