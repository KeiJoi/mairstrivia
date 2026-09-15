import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ServiceError, TriviaService } from "../src/service.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const q = (id: string, correct: string) => ({ id, question: "Q?", correctAnswer: correct, incorrectAnswers: ["1", "2", "3"], category: null, tags: [] });
const set = (id: string, qid: string, correct: string): QuestionSet => ({ format: "fftrivia-question-set", schemaVersion: 2, id, title: "Set", description: "", author: "Test", version: "1", categories: [], tags: [], questions: [q(qid, correct)] });

let service: TriviaService;
beforeEach(() => { service = new TriviaService(openDatabase(":memory:"), { databasePath: ":memory:", serverAccessPassword: "server-secret", tokenSecret: "token-secret", registrationEnabled: true, publicBaseUrl: "http://test" }); });
async function host(name: string) { return service.register(name, "a sufficiently strong password"); }

describe("no-answer scoring — an unanswered question is scored exactly like an incorrect one", () => {
  it("gives an eligible player who never answers the SAME configured incorrectPoints as a player who answers wrong", async () => {
    const h = await host("host-a"), owner = service.authenticate(h.accessToken);
    const qid = "aaaaaaaa-0000-4000-8000-000000000001";
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("aaaaaaaa-0000-4000-8000-000000000002", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, incorrectPoints: -100, firstCorrectBonus: 50, allowAnswerChange: false } });
    const wrongAnswerer = service.join(game.joinCode, "Wanda");
    const noAnswerer = service.join(game.joinCode, "Nadia");
    service.preview(owner, game.id); service.open(owner, game.id);
    const question = service.playerReconnect(wrongAnswerer.reconnectToken).game.question as any;
    const wrongChoice = question.choices.find((c: any) => c.text !== "Right");
    service.answer(wrongAnswerer.reconnectToken, qid, wrongChoice.id);
    // Nadia deliberately never answers.
    service.close(owner, game.id);

    const players = service.hostState(owner, game.id).players;
    const wanda = players.find((p) => p.displayName === "Wanda")!;
    const nadia = players.find((p) => p.displayName === "Nadia")!;
    expect(wanda.score).toBe(-100);
    expect(wanda.incorrectCount).toBe(1);
    expect(nadia.score).toBe(-100);
    expect(nadia.incorrectCount).toBe(1);
    expect(nadia.correctCount).toBe(0);
  });

  it("gives 0 for no-answer when incorrectPoints is configured as 0", async () => {
    const h = await host("host-b"), owner = service.authenticate(h.accessToken);
    const qid = "bbbbbbbb-0000-4000-8000-000000000001";
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("bbbbbbbb-0000-4000-8000-000000000002", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, incorrectPoints: 0, firstCorrectBonus: 0, allowAnswerChange: false } });
    const noAnswerer = service.join(game.joinCode, "Nadia");
    service.preview(owner, game.id); service.open(owner, game.id);
    service.close(owner, game.id);
    void noAnswerer;
    expect(service.hostState(owner, game.id).players[0]).toMatchObject({ score: 0, incorrectCount: 1, correctCount: 0 });
  });

  it("does not double-penalize: closing an already-closed question is rejected, never re-scored", async () => {
    const h = await host("host-c"), owner = service.authenticate(h.accessToken);
    const qid = "cccccccc-0000-4000-8000-000000000001";
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("cccccccc-0000-4000-8000-000000000002", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, incorrectPoints: -50, firstCorrectBonus: 0, allowAnswerChange: false } });
    service.join(game.joinCode, "Nadia");
    service.preview(owner, game.id); service.open(owner, game.id);
    service.close(owner, game.id);
    expect(service.hostState(owner, game.id).players[0].score).toBe(-50);
    // A second close attempt on the same (now-closed) question must be rejected, not silently re-apply the penalty.
    expect(() => service.close(owner, game.id)).toThrow(ServiceError);
    expect(service.hostState(owner, game.id).players[0].score).toBe(-50);
    // Repeated host-state reads (simulating operator refresh / reconnect polling) must never re-trigger scoring.
    service.hostState(owner, game.id); service.hostState(owner, game.id);
    expect(service.hostState(owner, game.id).players[0].score).toBe(-50);
  });

  it("does not penalize a player kicked before the question closes", async () => {
    const h = await host("host-d"), owner = service.authenticate(h.accessToken);
    const qid = "dddddddd-0000-4000-8000-000000000001";
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("dddddddd-0000-4000-8000-000000000002", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, incorrectPoints: -100, firstCorrectBonus: 0, allowAnswerChange: false } });
    service.join(game.joinCode, "Innocent");
    const kicked = service.join(game.joinCode, "Kicked");
    service.preview(owner, game.id); service.open(owner, game.id);
    const kickedPlayerId = service.hostState(owner, game.id).players.find((p) => p.displayName === "Kicked")!.id;
    service.kickFromGame(owner, game.id, kickedPlayerId);
    service.close(owner, game.id);
    const players = service.hostState(owner, game.id).players;
    expect(players.find((p) => p.displayName === "Kicked")).toMatchObject({ score: 0, removed: true });
    expect(players.find((p) => p.displayName === "Innocent")).toMatchObject({ score: -100 }); // still-eligible non-answerer IS penalized
  });

  it("penalizes a player who joins mid-question (and is therefore eligible) but still never answers", async () => {
    const h = await host("host-e"), owner = service.authenticate(h.accessToken);
    const qid = "eeeeeeee-0000-4000-8000-000000000001";
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("eeeeeeee-0000-4000-8000-000000000002", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, incorrectPoints: -25, firstCorrectBonus: 0, allowAnswerChange: false } });
    service.preview(owner, game.id); service.open(owner, game.id);
    const lateJoiner = service.join(game.joinCode, "LateJoiner"); // joins while question_open -> gets a layout, is eligible
    service.close(owner, game.id);
    void lateJoiner;
    expect(service.hostState(owner, game.id).players[0]).toMatchObject({ displayName: "LateJoiner", score: -25, incorrectCount: 1 });
  });

  it("distinguishes 'no answer' from 'answered incorrectly' in the player's own reveal payload while scoring both identically", async () => {
    const h = await host("host-f"), owner = service.authenticate(h.accessToken);
    const qid = "ffffffff-0000-4000-8000-000000000001";
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("ffffffff-0000-4000-8000-000000000002", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, incorrectPoints: -10, firstCorrectBonus: 0, allowAnswerChange: false } });
    const noAnswerer = service.join(game.joinCode, "Nadia");
    service.preview(owner, game.id); service.open(owner, game.id);
    service.close(owner, game.id);
    const result = (service.playerReconnect(noAnswerer.reconnectToken).game as any).result;
    expect(result.selectedAnswer).toBeNull();
    expect(result.isCorrect).toBe(false);
    expect(result.pointsAwarded).toBe(-10); // same penalty as an incorrect answer, applied authoritatively server-side
  });

  it("applies no-answer scoring identically inside a Series game, and it rolls up into series standings", async () => {
    const h = await host("host-g"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "No-Answer Series");
    const qid = "12121212-0000-4000-8000-000000000001";
    const game = service.startNextGameInSeries(owner, series.id, { venueName: "Venue", gameName: "Game 1", questionSet: set("12121212-0000-4000-8000-000000000002", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, incorrectPoints: -30, firstCorrectBonus: 0, allowAnswerChange: false } });
    const noAnswerer = service.join(series.joinCode, "Nadia");
    service.preview(owner, game.id); service.open(owner, game.id);
    service.close(owner, game.id);
    void noAnswerer;
    expect(service.hostState(owner, game.id).players[0].score).toBe(-30);
    const standings = service.seriesStandings(series.id);
    expect(standings.find((e) => e.displayName === "Nadia")?.score).toBe(-30);
  });
});
