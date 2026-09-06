import argon2 from "argon2";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import type { TriviaDb } from "./db.js";
import type { Config } from "./config.js";
import { hasValidAnswerSet, type QuestionSet, type TriviaQuestion } from "./shared/question-set.js";

type GameRow = { id: string; owner_user_id: string; join_code: string; venue_name: string; game_name: string; state: string; scoring_json: string; active_set_id: string | null; active_question_id: string | null; active_occurrence_id: string | null; question_time_limit_seconds: number; cumulative_scoring: number; created_at: string; updated_at: string; ended_at: string | null };
type OccurrenceRow = { id: string; game_id: string; game_set_id: string; question_id: string; occurrence_ordinal: number; is_repeat: number; opened_at: string; closes_at: string | null; closed_at: string | null; close_reason: string | null };
type SeriesRow = { id: string; owner_user_id: string; join_code: string; name: string; state: string; current_game_id: string | null; created_at: string; updated_at: string; ended_at: string | null };
type PlayerRow = { id: string; game_id: string; display_name: string; reconnect_hash: string; score: number; correct_count: number; incorrect_count: number; joined_at: string; last_seen_at: string; removed_at: string | null };
type ParticipantRow = { id: string; series_id: string; display_name: string; reconnect_hash: string; joined_at: string; last_seen_at: string; removed_at: string | null };

const now = () => new Date().toISOString();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const json = <T>(s: string) => JSON.parse(s) as T;

export class ServiceError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

export interface Scoring { correctPoints: number; incorrectPoints: number; firstCorrectBonus: number; secondCorrectBonus?: number; thirdCorrectBonus?: number; allowAnswerChange: boolean; timeBonusMultiplier?: number; }
const defaultScoring: Scoring = { correctPoints: 100, incorrectPoints: 0, firstCorrectBonus: 50, allowAnswerChange: false, timeBonusMultiplier: 5 };

// correctCount/incorrectCount ride along on every leaderboard entry (game AND series) so "N / M correct" can be
// shown next to score without the client ever computing it from raw per-question rows — answered = correct + incorrect,
// deliberately never a source-question-count denominator (a player who joined late or missed a question is not "behind").
export interface LeaderboardEntry { rank: number; id: string; displayName: string; score: number; correctCount: number; incorrectCount: number; }
export interface FirstResponder { playerId: string; displayName: string; }
export interface QuestionResult { questionId: string; correctAnswer: string; firstResponder: FirstResponder | null; }
export interface GameCompleteResult { winners: LeaderboardEntry[]; standings: LeaderboardEntry[]; seriesId: string | null; seriesStandings: LeaderboardEntry[] | null; }
export interface SeriesCompleteResult { champions: LeaderboardEntry[]; standings: LeaderboardEntry[]; }

/** Dense ranking: ties occupy one place, the next distinct score takes the next place. Never join-time or name order. */
function denseRank(entries: { id: string; displayName: string; score: number; correctCount: number; incorrectCount: number }[]): LeaderboardEntry[] {
  const sorted = [...entries].sort((a, b) => b.score - a.score || a.displayName.toLocaleLowerCase().localeCompare(b.displayName.toLocaleLowerCase()) || a.id.localeCompare(b.id));
  let rank = 0, previousScore: number | null = null;
  return sorted.map((entry) => { if (previousScore === null || entry.score !== previousScore) { rank++; previousScore = entry.score; } return { rank, id: entry.id, displayName: entry.displayName, score: entry.score, correctCount: entry.correctCount, incorrectCount: entry.incorrectCount }; });
}

export class TriviaService {
  readonly events = new EventEmitter();
  private readonly questionTimers = new Map<string, NodeJS.Timeout>();
  /** Cancels every pending auto-close timer. Must be called before the database is closed so a scheduled callback can never fire against a closed handle. */
  shutdown() { for (const timer of this.questionTimers.values()) clearTimeout(timer); this.questionTimers.clear(); }
  constructor(private db: TriviaDb, private config: Config) {
    for (const game of this.db.prepare("SELECT * FROM games WHERE state='question_open'").all() as GameRow[]) this.scheduleClose(game);
  }

  private fail(status: number, code: string, message: string): never { throw new ServiceError(status, code, message); }
  private changed(gameId: string) { this.events.emit("game", gameId); }
  private seriesChanged(seriesId: string) { this.events.emit("series", seriesId); }

  // ---------------------------------------------------------------- auth ---
  verifyServerAccess(value: unknown) { const given = Buffer.from(String(value ?? "")); const expected = Buffer.from(this.config.serverAccessPassword); return given.length === expected.length && timingSafeEqual(given, expected); }
  private issueAccess(userId: string, sessionId: string) { const payload = Buffer.from(JSON.stringify({ sub: userId, sid: sessionId, exp: Date.now() + 15 * 60_000 })).toString("base64url"); return `${payload}.${createHmac("sha256", this.config.tokenSecret).update(payload).digest("base64url")}`; }
  private parseAccess(token: string) {
    const [payload, signature] = token.split(".");
    if (!payload || !signature || !timingSafeEqual(Buffer.from(signature), Buffer.from(createHmac("sha256", this.config.tokenSecret).update(payload).digest("base64url")))) this.fail(401, "invalid_token", "Access token is invalid.");
    const value = json<{ sub: string; sid: string; exp: number }>(Buffer.from(payload, "base64url").toString());
    if (value.exp < Date.now()) this.fail(401, "expired_token", "Access token has expired.");
    const session = this.db.prepare("SELECT revoked_at, expires_at FROM sessions WHERE id=? AND user_id=?").get(value.sid, value.sub) as { revoked_at: string | null; expires_at: string } | undefined;
    if (!session || session.revoked_at || session.expires_at < now()) this.fail(401, "revoked_token", "Session is no longer active.");
    return value.sub;
  }
  authenticate(token: string | undefined) { if (!token) this.fail(401, "missing_token", "Host authentication is required."); return this.parseAccess(token); }
  async register(username: string, password: string) {
    if (!this.config.registrationEnabled) this.fail(403, "registration_disabled", "Registration is disabled.");
    if (!/^[\w.-]{3,64}$/.test(username)) this.fail(400, "invalid_username", "Username must be 3-64 letters, numbers, periods, underscores, or hyphens.");
    const id = randomUUID();
    try { this.db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, username, await argon2.hash(password, { type: argon2.argon2id }), now()); }
    catch { this.fail(409, "username_taken", "That username is already registered."); }
    return this.login(username, password);
  }
  async login(username: string, password: string) {
    const user = this.db.prepare("SELECT * FROM users WHERE username=?").get(username) as { id: string; username: string; password_hash: string; created_at: string } | undefined;
    if (!user || !(await argon2.verify(user.password_hash, password))) this.fail(401, "invalid_login", "Username or password is incorrect.");
    const refreshToken = secret(), sessionId = randomUUID();
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(sessionId, user.id, hash(refreshToken), new Date(Date.now() + 30 * 86400_000).toISOString(), null, now());
    return { accessToken: this.issueAccess(user.id, sessionId), refreshToken, user: { id: user.id, username: user.username, createdAt: user.created_at } };
  }
  refresh(refreshToken: string) {
    const row = this.db.prepare("SELECT * FROM sessions WHERE refresh_hash=? AND revoked_at IS NULL AND expires_at>?").get(hash(refreshToken), now()) as { id: string; user_id: string } | undefined;
    if (!row) this.fail(401, "invalid_refresh", "Refresh credential is invalid.");
    const replacement = secret();
    this.db.prepare("UPDATE sessions SET refresh_hash=? WHERE id=?").run(hash(replacement), row.id);
    return { accessToken: this.issueAccess(row.user_id, row.id), refreshToken: replacement };
  }
  logout(token: string) { const payload = token.split(".")[0]; if (!payload) return; try { const v = json<{ sid: string }>(Buffer.from(payload, "base64url").toString()); this.db.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").run(now(), v.sid); } catch { /* idempotent */ } }
  me(userId: string) { const u = this.db.prepare("SELECT id,username,created_at FROM users WHERE id=?").get(userId) as { id: string; username: string; created_at: string }; return { id: u.id, username: u.username, createdAt: u.created_at }; }

  // --------------------------------------------------------------- games ---
  private gameForOwner(owner: string, id: string) { const game = this.db.prepare("SELECT * FROM games WHERE id=? AND owner_user_id=?").get(id, owner) as GameRow | undefined; if (!game) this.fail(404, "game_not_found", "Game was not found."); return game; }
  // attachedSourceSetIds lets a caller (Mair's Editor) determine whether a canonical library set is referenced by
  // any non-finished game, WITHOUT an N+1 fetch per resumable game — needed to block deletion of an in-use set.
  private attachedSourceSetIds(gameId: string): string[] { return (this.db.prepare("SELECT DISTINCT source_set_id FROM game_question_sets WHERE game_id=?").all(gameId) as { source_set_id: string }[]).map((r) => r.source_set_id); }
  listGames(owner: string) { return (this.db.prepare("SELECT id,join_code,venue_name,game_name,state,created_at,updated_at FROM games WHERE owner_user_id=? ORDER BY created_at DESC").all(owner) as any[]).map((g) => ({ id: g.id, joinCode: g.join_code, venueName: g.venue_name, gameName: g.game_name, state: g.state, createdAt: g.created_at, updatedAt: g.updated_at, attachedSourceSetIds: this.attachedSourceSetIds(g.id) })); }

  private joinCode() { let code = ""; do { code = randomBytes(5).toString("base64url").replace(/[-_]/g, "A").slice(0, 6).toUpperCase(); } while (this.db.prepare("SELECT 1 FROM games WHERE join_code=? UNION SELECT 1 FROM series WHERE join_code=?").get(code, code)); return code; }
  private validateSet(set: QuestionSet) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
    const list = (v: unknown) => Array.isArray(v) && v.every(text) && new Set(v.map((x) => x.trim().toLowerCase())).size === v.length;
    const minimum = set?.schemaVersion === 1 ? 9 : 3;
    const ids = new Set<string>();
    const uniqueIds = Array.isArray(set?.questions) && set.questions.every((q) => { if (ids.has(q.id)) return false; ids.add(q.id); return true; });
    if (!set || set.format !== "fftrivia-question-set" || ![1, 2].includes(set.schemaVersion) || !uuid.test(set.id) || !text(set.title) || typeof set.description !== "string" || !text(set.author) || !text(set.version) || !list(set.categories) || !list(set.tags) || !Array.isArray(set.questions) || !uniqueIds || !set.questions.every((q) => uuid.test(q.id) && text(q.question) && hasValidAnswerSet(q, minimum, 9) && list(q.tags) && (q.category === null || text(q.category))))
      this.fail(400, "invalid_question_set", "Question set does not meet the .fftrivia contract.");
  }
  private insertSet(gameId: string, id: string, set: QuestionSet, ordering: string, queue: string[], created: string) {
    this.db.prepare("INSERT INTO game_question_sets VALUES(?,?,?,?,?,?,?,?)").run(id, gameId, set.id, set.title, JSON.stringify(set), ordering, JSON.stringify(queue), created);
    const ins = this.db.prepare("INSERT INTO game_question_state VALUES(?,?,?,?,?,?,?,?)");
    queue.forEach((q, index) => ins.run(randomUUID(), id, q, "unused", index, null, null, null));
  }
  private history(gameId: string, event: string, payload: unknown) { this.db.prepare("INSERT INTO game_history VALUES(?,?,?,?,?)").run(randomUUID(), gameId, event, JSON.stringify(payload), now()); }
  private seriesHistory(seriesId: string, event: string, payload: unknown) { this.db.prepare("INSERT INTO series_history VALUES(?,?,?,?,?)").run(randomUUID(), seriesId, event, JSON.stringify(payload), now()); }

  createGame(owner: string, input: { venueName: string; gameName: string; questionSet: QuestionSet; orderingMode: "inOrder" | "shuffleOnce"; scoring?: Partial<Scoring>; questionTimeLimitSeconds?: number; cumulativeScoring?: boolean }) {
    if (!input.venueName?.trim() || !input.gameName?.trim()) this.fail(400, "game_name_required", "Venue Name and Game Name are required.");
    const timeLimit = input.questionTimeLimitSeconds ?? 0;
    if (!Number.isInteger(timeLimit) || timeLimit < 0 || timeLimit > 20) this.fail(400, "invalid_question_time_limit", "Question time limit must be a whole number from 0 to 20 seconds.");
    this.validateSet(input.questionSet);
    const id = randomUUID(), joinCode = this.joinCode(), setId = randomUUID(), created = now(), scoring = { ...defaultScoring, ...input.scoring }, cumulative = input.cumulativeScoring ? 1 : 0;
    const questions = [...input.questionSet.questions]; if (input.orderingMode === "shuffleOnce") this.shuffle(questions);
    const queue = questions.map((q) => q.id);
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO games (id,owner_user_id,join_code,venue_name,game_name,state,scoring_json,active_set_id,active_question_id,created_at,updated_at,ended_at,question_time_limit_seconds,cumulative_scoring,active_occurrence_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, owner, joinCode, input.venueName.trim(), input.gameName.trim(), "lobby", JSON.stringify(scoring), setId, null, created, created, null, timeLimit, cumulative, null);
      this.insertSet(id, setId, input.questionSet, input.orderingMode, queue, created);
      this.history(id, "game.created", { venueName: input.venueName, gameName: input.gameName, questionTimeLimitSeconds: timeLimit, cumulativeScoring: !!cumulative });
    })();
    return this.hostState(owner, id);
  }

  // A game-level kick stops further play but a kicked player's earned score still stands in that game's own history/standings (only Series-level removal excludes someone from standings).
  private leaderboardForGame(gameId: string): LeaderboardEntry[] { return denseRank((this.db.prepare("SELECT id, display_name AS displayName, score, correct_count AS correctCount, incorrect_count AS incorrectCount FROM players WHERE game_id=?").all(gameId) as any[]).map((p) => ({ id: p.id, displayName: p.displayName, score: p.score, correctCount: p.correctCount, incorrectCount: p.incorrectCount }))); }

  hostState(owner: string, id: string) {
    const g = this.gameForOwner(owner, id);
    const players = this.db.prepare("SELECT id,display_name,score,correct_count,incorrect_count,removed_at FROM players WHERE game_id=? ORDER BY score DESC,joined_at").all(id) as any[];
    const cumulativePlayers = g.cumulative_scoring ? this.db.prepare("SELECT p.display_name AS displayName, SUM(p.score) AS score FROM players p JOIN games g ON g.id=p.game_id WHERE g.owner_user_id=? AND g.cumulative_scoring=1 GROUP BY lower(p.display_name) ORDER BY score DESC, displayName").all(owner) : [];
    const seriesGame = this.db.prepare("SELECT series_id AS seriesId FROM series_games WHERE game_id=?").get(id) as { seriesId: string } | undefined;
    return {
      id: g.id, joinCode: g.join_code, playerUrl: `${this.config.publicBaseUrl}/play/${g.join_code}`, venueName: g.venue_name, gameName: g.game_name, state: g.state,
      scoring: json(g.scoring_json), questionTimeLimitSeconds: g.question_time_limit_seconds, cumulativeScoring: !!g.cumulative_scoring, cumulativePlayers,
      activeSetId: g.active_set_id, activeQuestionId: g.active_question_id, activeQuestionClosesAt: this.questionClosesAt(g),
      players: players.map((p) => ({ id: p.id, displayName: p.display_name, score: p.score, correctCount: p.correct_count, incorrectCount: p.incorrect_count, removed: !!p.removed_at })),
      leaderboard: this.leaderboardForGame(id),
      seriesId: seriesGame?.seriesId ?? null,
      seriesStandings: seriesGame ? this.seriesStandings(seriesGame.seriesId) : null,
      attachedSourceSetIds: this.attachedSourceSetIds(id),
    };
  }

  addSet(owner: string, gameId: string, set: QuestionSet, ordering: "inOrder" | "shuffleOnce") {
    const g = this.gameForOwner(owner, gameId);
    if (g.state === "finished") this.fail(409, "game_finished", "This game has already ended.");
    this.validateSet(set);
    const existing = this.db.prepare("SELECT id FROM game_question_sets WHERE game_id=? AND source_set_id=?").get(g.id, set.id) as { id: string } | undefined;
    if (existing) return { gameSetId: existing.id, reused: true };
    const questions = [...set.questions]; if (ordering === "shuffleOnce") this.shuffle(questions);
    const id = randomUUID();
    this.db.transaction(() => { this.insertSet(g.id, id, set, ordering, questions.map((q) => q.id), now()); this.history(g.id, "questionSet.added", { sourceSetId: set.id }); })();
    return { gameSetId: id, reused: false };
  }
  selectSet(owner: string, gameId: string, setId: string) {
    const g = this.gameForOwner(owner, gameId);
    if (g.state === "question_open") this.fail(409, "question_open", "Question set cannot change while answers are open.");
    if (g.state === "finished") this.fail(409, "game_finished", "This game has already ended; a finished game cannot return to the lobby.");
    const set = this.db.prepare("SELECT id FROM game_question_sets WHERE id=? AND game_id=?").get(setId, g.id);
    if (!set) this.fail(404, "question_set_not_found", "Question set is not attached to this game.");
    // Fix: clear the active question/occurrence pointer so a stale question from the previous set can never leak into host/player state.
    this.db.prepare("UPDATE games SET active_set_id=?, state=?, active_question_id=NULL, active_occurrence_id=NULL, updated_at=? WHERE id=?").run(setId, "lobby", now(), g.id);
    this.history(g.id, "questionSet.selected", { gameSetId: setId });
    this.changed(g.id);
    return this.hostState(owner, g.id);
  }

  // ----------------------------------------------------------- questions ---
  private questionForHost(g: GameRow, qid: string) { const set = this.db.prepare("SELECT set_json FROM game_question_sets WHERE id=?").get(g.active_set_id!) as { set_json: string }; return json<QuestionSet>(set.set_json).questions.find((q) => q.id === qid)!; }
  private questionByOccurrence(occurrence: OccurrenceRow): TriviaQuestion { const set = this.db.prepare("SELECT set_json FROM game_question_sets WHERE id=?").get(occurrence.game_set_id) as { set_json: string }; return json<QuestionSet>(set.set_json).questions.find((q) => q.id === occurrence.question_id)!; }
  private occurrence(id: string) { return this.db.prepare("SELECT * FROM question_occurrences WHERE id=?").get(id) as OccurrenceRow | undefined; }

  preview(owner: string, gameId: string) {
    const g = this.gameForOwner(owner, gameId);
    if (!g.active_set_id) this.fail(409, "no_question_set", "Select a question set first.");
    if (!["lobby", "results"].includes(g.state)) this.fail(409, "invalid_state", "A question cannot be previewed now.");
    let q = this.db.prepare("SELECT * FROM game_question_state WHERE game_set_id=? AND state='previewed' ORDER BY ordinal LIMIT 1").get(g.active_set_id) as any;
    if (!q) q = this.db.prepare("SELECT * FROM game_question_state WHERE game_set_id=? AND state='unused' ORDER BY ordinal LIMIT 1").get(g.active_set_id) as any;
    if (!q) this.fail(409, "no_questions", "No unused questions remain.");
    this.db.prepare("UPDATE game_question_state SET state='previewed',previewed_at=? WHERE id=?").run(now(), q.id);
    this.db.prepare("UPDATE games SET state='preview',active_question_id=?,updated_at=? WHERE id=?").run(q.question_id, now(), g.id);
    // No changed()/push here deliberately: preview is host-only (players see nothing new), and pushing here
    // would race the very next open() push on the same event, delivering the stale pre-open state instead.
    return this.questionForHost(g, q.question_id);
  }

  /** A previously COMPLETED question only. Creates a brand-new scored occurrence; the original occurrence's history is untouched. */
  repeatQuestion(owner: string, gameId: string, questionId: string) {
    const g = this.gameForOwner(owner, gameId);
    if (!g.active_set_id) this.fail(409, "no_question_set", "Select a question set first.");
    if (!["lobby", "results"].includes(g.state)) this.fail(409, "invalid_state", "A question cannot be repeated now.");
    const row = this.db.prepare("SELECT * FROM game_question_state WHERE game_set_id=? AND question_id=?").get(g.active_set_id, questionId) as { state: string } | undefined;
    if (!row || row.state !== "completed") this.fail(409, "question_not_repeatable", "Only a previously completed question can be repeated.");
    this.db.prepare("UPDATE games SET state='preview',active_question_id=?,updated_at=? WHERE id=?").run(questionId, now(), g.id);
    return this.questionForHost(g, questionId);
  }

  skip(owner: string, gameId: string) {
    const g = this.gameForOwner(owner, gameId);
    if (g.state !== "preview" || !g.active_set_id || !g.active_question_id) this.fail(409, "invalid_state", "Only a previewed question can be skipped.");
    this.db.transaction(() => {
      this.db.prepare("UPDATE game_question_state SET state='skipped' WHERE game_set_id=? AND question_id=? AND state != 'completed'").run(g.active_set_id, g.active_question_id);
      this.db.prepare("INSERT INTO skipped_questions VALUES(?,?,?,?,?)").run(randomUUID(), g.id, g.active_set_id, g.active_question_id, now());
      this.db.prepare("UPDATE games SET state='lobby',active_question_id=NULL,active_occurrence_id=NULL,updated_at=? WHERE id=?").run(now(), g.id);
      this.history(g.id, "question.skipped", { questionId: g.active_question_id });
    })();
    this.changed(g.id);
    return this.hostState(owner, g.id);
  }

  open(owner: string, gameId: string) {
    const g = this.gameForOwner(owner, gameId);
    if (g.state !== "preview" || !g.active_question_id) this.fail(409, "invalid_state", "Preview a question before opening it.");
    const question = this.questionForHost(g, g.active_question_id);
    const players = this.db.prepare("SELECT id FROM players WHERE game_id=? AND removed_at IS NULL").all(g.id) as { id: string }[];
    const occurrenceId = randomUUID();
    const ordinal = ((this.db.prepare("SELECT COALESCE(MAX(occurrence_ordinal),0) AS n FROM question_occurrences WHERE game_set_id=? AND question_id=?").get(g.active_set_id, g.active_question_id) as { n: number }).n) + 1;
    const isRepeat = ordinal > 1 ? 1 : 0;
    const opened = now();
    const closesAt = g.question_time_limit_seconds > 0 ? new Date(Date.now() + g.question_time_limit_seconds * 1000).toISOString() : null;
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO question_occurrences (id,game_id,game_set_id,question_id,occurrence_ordinal,is_repeat,opened_at,closes_at,closed_at,close_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(occurrenceId, g.id, g.active_set_id, g.active_question_id, ordinal, isRepeat, opened, closesAt, null, null, opened);
      for (const p of players) this.layout(p.id, g.id, occurrenceId, question);
      if (!isRepeat) this.db.prepare("UPDATE game_question_state SET state='asked',asked_at=? WHERE game_set_id=? AND question_id=?").run(opened, g.active_set_id, g.active_question_id);
      this.db.prepare("UPDATE games SET state='question_open',active_occurrence_id=?,updated_at=? WHERE id=?").run(occurrenceId, opened, g.id);
      this.history(g.id, "question.opened", { questionId: g.active_question_id, occurrenceId, isRepeat: !!isRepeat });
    })();
    this.scheduleClose(this.gameForOwner(owner, gameId));
    this.changed(g.id);
  }

  private layout(playerId: string, gameId: string, occurrenceId: string, q: TriviaQuestion) {
    const selected = this.shuffle([...q.incorrectAnswers]).slice(0, 3);
    const answers = this.shuffle([q.correctAnswer, ...selected]).map((text) => ({ id: secret(), text }));
    const correct = answers.find((a) => a.text === q.correctAnswer)!;
    this.db.prepare("INSERT OR IGNORE INTO player_question_layouts VALUES(?,?,?,?,?,?,?)").run(randomUUID(), playerId, gameId, occurrenceId, JSON.stringify(answers), correct.id, now());
  }

  // ------------------------------------------------------------- players ---
  join(joinCode: string, displayName: string) {
    const g = this.db.prepare("SELECT * FROM games WHERE join_code=? AND state!='finished'").get(joinCode) as GameRow | undefined;
    if (g) return this.joinGame(g, displayName);
    const s = this.db.prepare("SELECT * FROM series WHERE join_code=? AND state!='finished'").get(joinCode) as SeriesRow | undefined;
    if (s) return this.joinSeries(s, displayName);
    this.fail(404, "game_not_found", "That game is unavailable.");
  }
  private validateDisplayName(displayName: string) { if (!displayName?.trim() || displayName.length > 48) this.fail(400, "invalid_display_name", "Enter a display name up to 48 characters."); }
  private joinGame(g: GameRow, displayName: string) {
    this.validateDisplayName(displayName);
    const id = randomUUID(), reconnect = secret();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO players VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, g.id, displayName.trim(), hash(reconnect), 0, 0, 0, now(), now(), null);
      if (g.state === "question_open" && g.active_occurrence_id) { const occurrence = this.occurrence(g.active_occurrence_id)!; this.layout(id, g.id, occurrence.id, this.questionByOccurrence(occurrence)); }
    })();
    this.changed(g.id);
    return { playerId: id, reconnectToken: reconnect, game: this.playerState(g, id) };
  }
  private joinSeries(s: SeriesRow, displayName: string) {
    this.validateDisplayName(displayName);
    const id = randomUUID(), reconnect = secret();
    this.db.prepare("INSERT INTO series_participants VALUES(?,?,?,?,?,?,?)").run(id, s.id, displayName.trim(), hash(reconnect), now(), now(), null);
    const enrolled = s.current_game_id ? this.enrollParticipantInGame(id, displayName.trim(), s.current_game_id) : null;
    return { playerId: enrolled?.playerId ?? id, reconnectToken: reconnect, game: enrolled ? this.playerState(this.gameRow(s.current_game_id!)!, enrolled.playerId) : this.seriesLobbyState(s, displayName.trim()) };
  }
  private gameRow(id: string) { return this.db.prepare("SELECT * FROM games WHERE id=?").get(id) as GameRow | undefined; }
  private enrollParticipantInGame(participantId: string, displayName: string, gameId: string) {
    const existing = this.db.prepare("SELECT player_id AS playerId FROM series_game_players WHERE series_participant_id=? AND game_id=?").get(participantId, gameId) as { playerId: string } | undefined;
    if (existing) return existing;
    const playerId = randomUUID();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO players VALUES(?,?,?,?,?,?,?,?,?,?)").run(playerId, gameId, displayName, hash(secret()), 0, 0, 0, now(), now(), null);
      this.db.prepare("INSERT INTO series_game_players VALUES(?,?,?,?,?)").run(randomUUID(), participantId, gameId, playerId, now());
    })();
    return { playerId };
  }
  private seriesLobbyState(s: SeriesRow, displayName: string) { return { venueName: "", gameName: s.name, state: "series_lobby" as const, player: { displayName, score: 0, correctCount: 0, incorrectCount: 0 }, question: null, result: null, seriesId: s.id, seriesName: s.name, seriesStandings: this.seriesStandings(s.id) }; }

  /** Resolves an opaque reconnect token to either a standalone game player or a Series participant's current-game player. Identical browser code works for both. */
  private resolveToken(token: string) {
    const player = this.db.prepare("SELECT * FROM players WHERE reconnect_hash=?").get(hash(token)) as PlayerRow | undefined;
    if (player) { if (player.removed_at) this.fail(403, "player_removed", "You have been removed from this game."); return { kind: "game" as const, player, seriesId: null as string | null }; }
    const participant = this.db.prepare("SELECT * FROM series_participants WHERE reconnect_hash=?").get(hash(token)) as ParticipantRow | undefined;
    if (!participant) this.fail(401, "invalid_player_session", "Player reconnect credential is invalid.");
    if (participant.removed_at) this.fail(403, "player_removed", "You have been removed from this series.");
    const series = this.db.prepare("SELECT * FROM series WHERE id=?").get(participant.series_id) as SeriesRow;
    if (!series.current_game_id) return { kind: "series-lobby" as const, participant, series };
    const mapped = this.db.prepare("SELECT p.* FROM series_game_players m JOIN players p ON p.id=m.player_id WHERE m.series_participant_id=? AND m.game_id=?").get(participant.id, series.current_game_id) as PlayerRow | undefined;
    if (!mapped) { const enrolled = this.enrollParticipantInGame(participant.id, participant.display_name, series.current_game_id); return { kind: "game" as const, player: this.db.prepare("SELECT * FROM players WHERE id=?").get(enrolled.playerId) as PlayerRow, seriesId: series.id }; }
    if (mapped.removed_at) this.fail(403, "player_removed", "You have been removed from this game.");
    return { kind: "game" as const, player: mapped, seriesId: series.id, participant };
  }

  playerReconnect(token: string) {
    const resolved = this.resolveToken(token);
    if (resolved.kind === "series-lobby") { this.db.prepare("UPDATE series_participants SET last_seen_at=? WHERE id=?").run(now(), resolved.participant.id); return { playerId: resolved.participant.id, gameId: null, game: this.seriesLobbyState(resolved.series, resolved.participant.display_name) }; }
    this.db.prepare("UPDATE players SET last_seen_at=? WHERE id=?").run(now(), resolved.player.id);
    const g = this.gameRow(resolved.player.game_id)!;
    return { playerId: resolved.player.id, gameId: g.id, game: this.playerState(g, resolved.player.id) };
  }

  private playerState(g: GameRow, playerId: string) {
    const p = this.db.prepare("SELECT display_name,score,correct_count,incorrect_count FROM players WHERE id=?").get(playerId) as any;
    const seriesGame = this.db.prepare("SELECT series_id AS seriesId FROM series_games WHERE game_id=?").get(g.id) as { seriesId: string } | undefined;
    const series = seriesGame ? (this.db.prepare("SELECT * FROM series WHERE id=?").get(seriesGame.seriesId) as SeriesRow) : null;
    let question: unknown = null, result: unknown = null, gameResult: unknown = null, seriesResult: unknown = null;
    if (g.active_occurrence_id) {
      const occurrence = this.occurrence(g.active_occurrence_id)!;
      const answer = this.db.prepare("SELECT answer_id,is_correct,base_points,first_correct_bonus,time_bonus,points_awarded FROM player_answers WHERE player_id=? AND occurrence_id=?").get(playerId, occurrence.id) as any;
      if (g.state === "question_open") {
        const l = this.db.prepare("SELECT choices_json FROM player_question_layouts WHERE player_id=? AND occurrence_id=?").get(playerId, occurrence.id) as { choices_json: string } | undefined;
        question = l ? { id: occurrence.question_id, question: this.questionByOccurrence(occurrence).question, choices: json(l.choices_json), closesAt: occurrence.closes_at, answerSubmitted: !!answer, selectedAnswerId: answer?.answer_id ?? null } : null;
      } else if (g.state === "results") {
        const source = this.questionByOccurrence(occurrence), layout = this.db.prepare("SELECT choices_json FROM player_question_layouts WHERE player_id=? AND occurrence_id=?").get(playerId, occurrence.id) as { choices_json: string } | undefined;
        const selected = layout && answer ? json<{ id: string; text: string }[]>(layout.choices_json).find((choice) => choice.id === answer.answer_id) : undefined;
        result = { question: source.question, correctAnswer: source.correctAnswer, selectedAnswer: selected?.text ?? null, isCorrect: answer?.is_correct === 1, pointsAwarded: answer?.points_awarded ?? 0, basePoints: answer?.base_points ?? 0, firstCorrectBonus: answer?.first_correct_bonus ?? 0, timeBonus: answer?.time_bonus ?? 0, leaderboard: this.leaderboardForGame(g.id), seriesStandings: series ? this.seriesStandings(series.id) : null };
      }
    }
    if (g.state === "finished") {
      const standings = this.leaderboardForGame(g.id);
      gameResult = { winners: standings.filter((e) => e.rank === 1), standings, seriesId: series?.id ?? null, seriesStandings: series ? this.seriesStandings(series.id) : null, waitingForNextGame: !!series && series.state === "active" };
      if (series && series.state === "finished") { const finalStandings = this.seriesStandings(series.id); seriesResult = { champions: finalStandings.filter((e) => e.rank === 1), standings: finalStandings }; }
    }
    return { venueName: g.venue_name, gameName: g.game_name, state: g.state, player: { displayName: p.display_name, score: p.score, correctCount: p.correct_count, incorrectCount: p.incorrect_count }, question, result, gameResult, seriesResult, seriesId: series?.id ?? null, seriesName: series?.name ?? null };
  }

  answer(token: string, questionId: string, answerId: string) {
    const resolved = this.resolveToken(token);
    if (resolved.kind !== "game") this.fail(409, "invalid_state", "This question is not accepting answers.");
    const g = this.gameRow(resolved.player.game_id)!;
    if (g.state !== "question_open" || !g.active_occurrence_id) this.fail(409, "invalid_state", "This question is not accepting answers.");
    const occurrence = this.occurrence(g.active_occurrence_id)!;
    if (occurrence.question_id !== questionId) this.fail(409, "invalid_state", "This question is not accepting answers.");
    const p = resolved.player;
    const prior = this.db.prepare("SELECT id FROM player_answers WHERE player_id=? AND occurrence_id=?").get(p.id, occurrence.id);
    const scoring = json<Scoring>(g.scoring_json);
    if (prior && !scoring.allowAnswerChange) this.fail(409, "answer_locked", "Your answer is already locked.");
    const layout = this.db.prepare("SELECT * FROM player_question_layouts WHERE player_id=? AND occurrence_id=?").get(p.id, occurrence.id) as any;
    if (!layout || !json<{ id: string }[]>(layout.choices_json).some((c) => c.id === answerId)) this.fail(400, "invalid_answer", "That answer is not assigned to this player.");
    const correct = layout.correct_answer_id === answerId;
    const receipt = (this.db.prepare("SELECT COALESCE(MAX(receipt_order),0)+1 AS n FROM player_answers WHERE game_id=? AND occurrence_id=?").get(g.id, occurrence.id) as any).n;
    this.db.transaction(() => {
      if (prior) this.db.prepare("DELETE FROM player_answers WHERE player_id=? AND occurrence_id=?").run(p.id, occurrence.id);
      this.db.prepare("INSERT INTO player_answers (id,player_id,game_id,occurrence_id,answer_id,is_correct,receipt_order,received_at,elapsed_ms,base_points,first_correct_bonus,time_bonus,points_awarded) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), p.id, g.id, occurrence.id, answerId, correct ? 1 : 0, receipt, now(), Math.max(0, Date.now() - Date.parse(occurrence.opened_at)), 0, 0, 0, 0);
    })();
    this.changed(g.id);
    return { accepted: true, locked: !scoring.allowAnswerChange };
  }

  // -------------------------------------------------------------- close ---
  close(owner: string, gameId: string) { const g = this.gameForOwner(owner, gameId); const result = this.closeGame(g, "host"); if (!result) this.fail(409, "invalid_state", "No open question exists."); return { game: this.hostState(owner, gameId), result }; }
  private questionClosesAt(g: GameRow) { if (!g.active_occurrence_id) return null; return this.occurrence(g.active_occurrence_id)?.closes_at ?? null; }
  private scheduleClose(g: GameRow) {
    const closesAt = this.questionClosesAt(g); if (!closesAt) return;
    const existing = this.questionTimers.get(g.id); if (existing) clearTimeout(existing);
    const timer = setTimeout(() => { this.questionTimers.delete(g.id); const current = this.gameRow(g.id); if (current) this.closeGame(current, "timer"); }, Math.max(0, Date.parse(closesAt) - Date.now()));
    timer.unref();
    this.questionTimers.set(g.id, timer);
  }
  private closeGame(g: GameRow, reason: "host" | "timer"): QuestionResult | false {
    if (g.state !== "question_open" || !g.active_occurrence_id) return false;
    const existing = this.questionTimers.get(g.id); if (existing) clearTimeout(existing); this.questionTimers.delete(g.id);
    const occurrence = this.occurrence(g.active_occurrence_id)!;
    let result: QuestionResult;
    this.db.transaction(() => {
      result = this.settleAnswers(g, occurrence);
      this.db.prepare("UPDATE question_occurrences SET closed_at=?,close_reason=? WHERE id=?").run(now(), reason, occurrence.id);
      if (!occurrence.is_repeat) this.db.prepare("UPDATE game_question_state SET state='completed',completed_at=? WHERE game_set_id=? AND question_id=?").run(now(), g.active_set_id, occurrence.question_id);
      this.db.prepare("UPDATE games SET state='results',updated_at=? WHERE id=?").run(now(), g.id);
      this.history(g.id, "question.closed", { questionId: occurrence.question_id, occurrenceId: occurrence.id, reason, isRepeat: !!occurrence.is_repeat });
    })();
    this.changed(g.id);
    return result!;
  }
  private settleAnswers(g: GameRow, occurrence: OccurrenceRow): QuestionResult {
    const scoring = json<Scoring>(g.scoring_json);
    const multiplier = scoring.timeBonusMultiplier ?? 5;
    const answers = this.db.prepare("SELECT id,player_id,is_correct,receipt_order,received_at FROM player_answers WHERE game_id=? AND occurrence_id=? ORDER BY receipt_order").all(g.id, occurrence.id) as { id: string; player_id: string; is_correct: number; receipt_order: number; received_at: string }[];
    let correctRank = 0; let firstResponder: FirstResponder | null = null;
    for (const answer of answers) {
      const isCorrect = answer.is_correct === 1;
      const base = isCorrect ? scoring.correctPoints : scoring.incorrectPoints;
      let firstBonus = 0;
      if (isCorrect) {
        correctRank++;
        if (correctRank === 1) { firstBonus = scoring.firstCorrectBonus; const player = this.db.prepare("SELECT display_name FROM players WHERE id=?").get(answer.player_id) as { display_name: string }; firstResponder = { playerId: answer.player_id, displayName: player.display_name }; }
        else if (correctRank === 2) firstBonus = scoring.secondCorrectBonus ?? 0;
        else if (correctRank === 3) firstBonus = scoring.thirdCorrectBonus ?? 0;
      }
      let timeBonus = 0;
      if (isCorrect && occurrence.closes_at) { const remaining = Math.max(0, (Date.parse(occurrence.closes_at) - Date.parse(answer.received_at)) / 1000); timeBonus = Math.floor(remaining * multiplier); }
      const total = base + firstBonus + timeBonus;
      this.db.prepare("UPDATE player_answers SET base_points=?,first_correct_bonus=?,time_bonus=?,points_awarded=? WHERE id=?").run(base, firstBonus, timeBonus, total, answer.id);
      this.db.prepare("UPDATE players SET score=score+?,correct_count=correct_count+?,incorrect_count=incorrect_count+? WHERE id=?").run(total, isCorrect ? 1 : 0, isCorrect ? 0 : 1, answer.player_id);
    }
    return { questionId: occurrence.question_id, correctAnswer: this.questionByOccurrence(occurrence).correctAnswer, firstResponder };
  }

  end(owner: string, gameId: string): GameCompleteResult {
    const g = this.gameForOwner(owner, gameId);
    if (g.state === "question_open") this.fail(409, "question_open", "Close the current question before ending the game.");
    this.db.prepare("UPDATE games SET state='finished',ended_at=?,updated_at=? WHERE id=?").run(now(), now(), g.id);
    this.history(g.id, "game.ended", {});
    const seriesGame = this.db.prepare("SELECT series_id AS seriesId FROM series_games WHERE game_id=?").get(g.id) as { seriesId: string } | undefined;
    this.changed(g.id);
    if (seriesGame) this.seriesChanged(seriesGame.seriesId);
    const standings = this.leaderboardForGame(g.id);
    return { winners: standings.filter((e) => e.rank === 1), standings, seriesId: seriesGame?.seriesId ?? null, seriesStandings: seriesGame ? this.seriesStandings(seriesGame.seriesId) : null };
  }

  // ---------------------------------------------------- player management ---
  kickFromGame(owner: string, gameId: string, playerId: string) {
    const g = this.gameForOwner(owner, gameId);
    const player = this.db.prepare("SELECT id FROM players WHERE id=? AND game_id=?").get(playerId, g.id);
    if (!player) this.fail(404, "player_not_found", "That player is not part of this game.");
    this.db.prepare("UPDATE players SET removed_at=? WHERE id=?").run(now(), playerId);
    this.history(g.id, "player.kicked", { playerId });
    this.changed(g.id);
    return this.hostState(owner, g.id);
  }
  adjustScore(owner: string, gameId: string, playerId: string, delta: number, reason: string) {
    const g = this.gameForOwner(owner, gameId);
    if (!Number.isInteger(delta) || delta === 0) this.fail(400, "invalid_adjustment", "Score adjustment must be a nonzero whole number.");
    if (!reason?.trim()) this.fail(400, "reason_required", "A reason is required for a manual score adjustment.");
    const player = this.db.prepare("SELECT id FROM players WHERE id=? AND game_id=?").get(playerId, g.id);
    if (!player) this.fail(404, "player_not_found", "That player is not part of this game.");
    const seriesGame = this.db.prepare("SELECT series_id AS seriesId FROM series_games WHERE game_id=?").get(g.id) as { seriesId: string } | undefined;
    this.db.transaction(() => {
      this.db.prepare("UPDATE players SET score=score+? WHERE id=?").run(delta, playerId);
      this.db.prepare("INSERT INTO score_adjustments VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(), g.id, playerId, seriesGame?.seriesId ?? null, delta, reason.trim(), owner, now());
      this.history(g.id, "score.adjusted", { playerId, delta, reason: reason.trim() });
    })();
    this.changed(g.id);
    if (seriesGame) this.seriesChanged(seriesGame.seriesId);
    return this.hostState(owner, g.id);
  }

  // --------------------------------------------------------------- series ---
  private seriesForOwner(owner: string, id: string) { const s = this.db.prepare("SELECT * FROM series WHERE id=? AND owner_user_id=?").get(id, owner) as SeriesRow | undefined; if (!s) this.fail(404, "series_not_found", "Series was not found."); return s; }
  listSeries(owner: string) { return (this.db.prepare("SELECT id,name,state,created_at,updated_at,ended_at FROM series WHERE owner_user_id=? ORDER BY created_at DESC").all(owner) as any[]).map((s) => ({ id: s.id, name: s.name, state: s.state, createdAt: s.created_at, updatedAt: s.updated_at, endedAt: s.ended_at })); }
  createSeries(owner: string, name: string) {
    if (!name?.trim()) this.fail(400, "series_name_required", "A series name is required.");
    const id = randomUUID(), joinCode = this.joinCode(), created = now();
    this.db.prepare("INSERT INTO series VALUES(?,?,?,?,?,?,?,?,?)").run(id, owner, joinCode, name.trim(), "active", null, created, created, null);
    this.seriesHistory(id, "series.created", { name: name.trim() });
    return this.seriesState(owner, id);
  }
  /** Aggregates score AND correct/incorrect counts across every Game this Series participant has ever been mapped
   * into (via series_game_players -> players). A Game-level score adjustment already lives inside players.score, so
   * it flows into this SUM automatically — there is no separate Series-level score store to double-count against. */
  seriesStandings(seriesId: string): LeaderboardEntry[] {
    const rows = this.db.prepare(`
      SELECT sp.id AS id, sp.display_name AS displayName, COALESCE(SUM(p.score), 0) AS score,
             COALESCE(SUM(p.correct_count), 0) AS correctCount, COALESCE(SUM(p.incorrect_count), 0) AS incorrectCount
        FROM series_participants sp
        LEFT JOIN series_game_players m ON m.series_participant_id = sp.id
        LEFT JOIN players p ON p.id = m.player_id
       WHERE sp.series_id = ? AND sp.removed_at IS NULL
       GROUP BY sp.id, sp.display_name`).all(seriesId) as { id: string; displayName: string; score: number; correctCount: number; incorrectCount: number }[];
    return denseRank(rows);
  }
  /** Cumulative per-participant stats for the "Series Players" roster — distinct from seriesStandings' ranked
   * projection: this always lists every non-removed participant (even one who hasn't played a Game yet, at 0/0/0),
   * unsorted by rank, alongside their removal state for the host's remove control. */
  private seriesParticipantStats(seriesId: string) {
    return this.db.prepare(`
      SELECT sp.id AS id, sp.display_name AS displayName, sp.removed_at AS removedAt,
             COALESCE(SUM(p.score), 0) AS score, COALESCE(SUM(p.correct_count), 0) AS correctCount, COALESCE(SUM(p.incorrect_count), 0) AS incorrectCount
        FROM series_participants sp
        LEFT JOIN series_game_players m ON m.series_participant_id = sp.id
        LEFT JOIN players p ON p.id = m.player_id
       WHERE sp.series_id = ?
       GROUP BY sp.id, sp.display_name, sp.removed_at
       ORDER BY sp.joined_at`).all(seriesId) as { id: string; displayName: string; removedAt: string | null; score: number; correctCount: number; incorrectCount: number }[];
  }
  seriesState(owner: string, id: string) {
    const s = this.seriesForOwner(owner, id);
    const games = this.db.prepare("SELECT g.id,g.game_name AS gameName,g.state,sg.sequence_ordinal AS sequenceOrdinal FROM series_games sg JOIN games g ON g.id=sg.game_id WHERE sg.series_id=? ORDER BY sg.sequence_ordinal").all(id) as any[];
    const participants = this.seriesParticipantStats(id).map((p) => ({ id: p.id, displayName: p.displayName, removed: !!p.removedAt, score: p.score, correctCount: p.correctCount, incorrectCount: p.incorrectCount }));
    return { id: s.id, name: s.name, state: s.state, joinCode: s.join_code, playerUrl: `${this.config.publicBaseUrl}/play/${s.join_code}`, currentGameId: s.current_game_id, games, participants, standings: this.seriesStandings(id) };
  }
  startNextGameInSeries(owner: string, seriesId: string, input: { venueName: string; gameName: string; questionSet: QuestionSet; orderingMode: "inOrder" | "shuffleOnce"; scoring?: Partial<Scoring>; questionTimeLimitSeconds?: number }) {
    const s = this.seriesForOwner(owner, seriesId);
    if (s.state !== "active") this.fail(409, "series_finished", "This series has already ended.");
    if (s.current_game_id) { const current = this.gameRow(s.current_game_id); if (current && current.state !== "finished") this.fail(409, "game_active", "End the current game before starting the next one in this series."); }
    const game = this.createGame(owner, { ...input, cumulativeScoring: false });
    const sequenceOrdinal = ((this.db.prepare("SELECT COALESCE(MAX(sequence_ordinal),0) AS n FROM series_games WHERE series_id=?").get(seriesId) as { n: number }).n) + 1;
    const participants = this.db.prepare("SELECT id,display_name AS displayName FROM series_participants WHERE series_id=? AND removed_at IS NULL").all(seriesId) as { id: string; displayName: string }[];
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO series_games VALUES(?,?,?,?,?)").run(randomUUID(), seriesId, game.id, sequenceOrdinal, now());
      this.db.prepare("UPDATE series SET current_game_id=?,updated_at=? WHERE id=?").run(game.id, now(), seriesId);
      for (const participant of participants) this.enrollParticipantInGame(participant.id, participant.displayName, game.id);
      this.seriesHistory(seriesId, "series.gameStarted", { gameId: game.id, sequenceOrdinal });
    })();
    this.seriesChanged(seriesId);
    return this.hostState(owner, game.id);
  }
  endSeries(owner: string, seriesId: string): SeriesCompleteResult {
    const s = this.seriesForOwner(owner, seriesId);
    if (s.state === "finished") this.fail(409, "series_finished", "This series has already ended.");
    if (s.current_game_id) { const current = this.gameRow(s.current_game_id); if (current && current.state !== "finished") this.fail(409, "game_active", "End the current game before ending the series."); }
    this.db.prepare("UPDATE series SET state='finished',ended_at=?,updated_at=? WHERE id=?").run(now(), now(), seriesId);
    this.seriesHistory(seriesId, "series.ended", {});
    this.seriesChanged(seriesId);
    const standings = this.seriesStandings(seriesId);
    return { champions: standings.filter((e) => e.rank === 1), standings };
  }
  removeFromSeries(owner: string, seriesId: string, participantId: string) {
    const s = this.seriesForOwner(owner, seriesId);
    const participant = this.db.prepare("SELECT id FROM series_participants WHERE id=? AND series_id=?").get(participantId, s.id);
    if (!participant) this.fail(404, "participant_not_found", "That participant is not part of this series.");
    this.db.transaction(() => {
      this.db.prepare("UPDATE series_participants SET removed_at=? WHERE id=?").run(now(), participantId);
      if (s.current_game_id) { const mapped = this.db.prepare("SELECT player_id AS playerId FROM series_game_players WHERE series_participant_id=? AND game_id=?").get(participantId, s.current_game_id) as { playerId: string } | undefined; if (mapped) this.db.prepare("UPDATE players SET removed_at=? WHERE id=?").run(now(), mapped.playerId); }
      this.seriesHistory(s.id, "participant.removed", { participantId });
    })();
    this.seriesChanged(s.id);
    return this.seriesState(owner, s.id);
  }

  private shuffle<T>(items: T[]): T[] { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[items[i], items[j]] = [items[j], items[i]]; } return items; }
}
