import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { TriviaService } from "../src/service.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const q = (id: string, correct: string) => ({ id, question: "Q?", correctAnswer: correct, incorrectAnswers: ["1", "2", "3"], category: null, tags: [] });
const set = (id: string, qid: string, correct: string): QuestionSet => ({ format: "fftrivia-question-set", schemaVersion: 2, id, title: "Set", description: "", author: "Test", version: "1", categories: [], tags: [], questions: [q(qid, correct)] });

let service: TriviaService;
beforeEach(() => { service = new TriviaService(openDatabase(":memory:"), { databasePath: ":memory:", serverAccessPassword: "server-secret", tokenSecret: "token-secret", registrationEnabled: true, publicBaseUrl: "https://mairs-trivia.example" }); });
async function host(name: string) { return service.register(name, "a sufficiently strong password"); }
function answerAs(gameId: string, qid: string, playerToken: string, correctText: string, pickCorrect: boolean) {
  const question = service.playerReconnect(playerToken).game.question as any;
  const choice = question.choices.find((c: any) => (c.text === correctText) === pickCorrect);
  service.answer(playerToken, qid, choice.id);
}

describe("Series: one persistent public join link", () => {
  it("creates exactly one persistent join code and player URL, unchanged across multiple Games", async () => {
    const h = await host("link-host"), owner = service.authenticate(h.accessToken);
    const created = service.createSeries(owner, "Persistent Link Series");
    expect(created.joinCode).toMatch(/^[A-Z0-9]{6}$/);

    const qid1 = "10000000-0000-4000-8000-000000000001";
    const game1 = service.startNextGameInSeries(owner, created.id, { venueName: "Venue", gameName: "Game 1", questionSet: set("20000000-0000-4000-8000-000000000001", qid1, "Right"), orderingMode: "inOrder" });
    const afterGame1 = service.seriesState(owner, created.id);
    expect(afterGame1.joinCode).toBe(created.joinCode); // unchanged after Game 1 starts

    service.preview(owner, game1.id); service.open(owner, game1.id); service.close(owner, game1.id); service.end(owner, game1.id);
    const qid2 = "10000000-0000-4000-8000-000000000002";
    service.startNextGameInSeries(owner, created.id, { venueName: "Venue", gameName: "Game 2", questionSet: set("20000000-0000-4000-8000-000000000002", qid2, "Right2"), orderingMode: "inOrder" });
    const afterGame2 = service.seriesState(owner, created.id);
    expect(afterGame2.joinCode).toBe(created.joinCode); // still unchanged after Game 2 starts — this IS the one public link for the whole Series
  });

  it("exposes a playerUrl built from the persistent series join code, exactly like a standalone game's playerUrl", async () => {
    const h = await host("url-host"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "URL Series");
    expect((series as any).playerUrl).toBe(`https://mairs-trivia.example/play/${series.joinCode}`);

    const standaloneSet = set("30000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000001", "Right");
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Standalone", questionSet: standaloneSet, orderingMode: "inOrder" });
    expect(game.playerUrl).toBe(`https://mairs-trivia.example/play/${game.joinCode}`);
    expect(game.joinCode).not.toBe(series.joinCode); // one shared uniqueness namespace — never colliding
  });

  it("never issues a Series join code that collides with a standalone Game's join code", async () => {
    const h = await host("collision-host"), owner = service.authenticate(h.accessToken);
    const codes = new Set<string>();
    for (let i = 0; i < 15; i++) {
      const s = set(randomUUID(), randomUUID(), "Right");
      codes.add(service.createGame(owner, { venueName: "V", gameName: `G${i}`, questionSet: s, orderingMode: "inOrder" }).joinCode);
      codes.add(service.createSeries(owner, `S${i}`).joinCode);
    }
    expect(codes.size).toBe(30); // 15 games + 15 series, all globally unique — /play/<code> is never ambiguous
  });
});

describe("Series standings: authoritative cumulative aggregation", () => {
  it("aggregates score, correct count, and incorrect count across Game 1 + Game 2, distinct from each Game's own standings", async () => {
    const h = await host("agg-host"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "Aggregate Series");
    const alice = service.join(series.joinCode, "Alice");

    const qid1 = "10000000-0000-4000-8000-000000000001";
    const game1 = service.startNextGameInSeries(owner, series.id, { venueName: "V", gameName: "Game 1", questionSet: set("20000000-0000-4000-8000-000000000001", qid1, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });
    service.preview(owner, game1.id); service.open(owner, game1.id);
    answerAs(game1.id, qid1, alice.reconnectToken, "Right", true); // correct
    service.close(owner, game1.id); service.end(owner, game1.id);

    const gameStandingsAfter1 = service.hostState(owner, game1.id).leaderboard;
    expect(gameStandingsAfter1[0]).toMatchObject({ displayName: "Alice", score: 100, correctCount: 1, incorrectCount: 0 });

    const qid2 = "10000000-0000-4000-8000-000000000002";
    const game2 = service.startNextGameInSeries(owner, series.id, { venueName: "V", gameName: "Game 2", questionSet: set("20000000-0000-4000-8000-000000000002", qid2, "Right2"), orderingMode: "inOrder", scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });
    service.preview(owner, game2.id); service.open(owner, game2.id);
    answerAs(game2.id, qid2, alice.reconnectToken, "Right2", false); // incorrect this time
    service.close(owner, game2.id);

    // Game 2's OWN standings reflect only Game 2 (0 correct, 1 incorrect, 0 points) — Game standings never leak Series totals.
    const game2Standings = service.hostState(owner, game2.id).leaderboard;
    expect(game2Standings[0]).toMatchObject({ displayName: "Alice", score: 0, correctCount: 0, incorrectCount: 1 });

    // Series standings aggregate BOTH games: 1 correct + 1 incorrect = 2 answered, 100 total points.
    const seriesStandings = service.seriesStandings(series.id);
    expect(seriesStandings[0]).toMatchObject({ displayName: "Alice", score: 100, correctCount: 1, incorrectCount: 1 });
  });

  it("reflects a Game-level manual score adjustment in the Series aggregate exactly once", async () => {
    const h = await host("adjust-host"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "Adjustment Series");
    const alice = service.join(series.joinCode, "Alice");
    const qid = "10000000-0000-4000-8000-000000000001";
    const game = service.startNextGameInSeries(owner, series.id, { venueName: "V", gameName: "Game 1", questionSet: set("20000000-0000-4000-8000-000000000001", qid, "Right"), orderingMode: "inOrder" });
    const alicePlayerId = service.hostState(owner, game.id).players[0].id;

    service.adjustScore(owner, game.id, alicePlayerId, 50, "Bonus for enthusiasm");

    expect(service.hostState(owner, game.id).players[0].score).toBe(50);
    expect(service.seriesStandings(series.id)[0]).toMatchObject({ displayName: "Alice", score: 50 }); // counted once, not double-counted against a separate Series-level total
  });

  it("exposes every active Series participant, including one who has not yet played a Game, for the Series Players roster", async () => {
    const h = await host("roster-host"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "Roster Series");
    service.join(series.joinCode, "Alice"); // joins the series lobby; no Game has started yet

    const state = service.seriesState(owner, series.id);

    expect(state.participants).toHaveLength(1);
    expect(state.participants[0]).toMatchObject({ displayName: "Alice", removed: false, score: 0, correctCount: 0, incorrectCount: 0 });
  });

  it("keeps a removed participant out of ranked standings but still visible (marked removed) in the Series Players roster", async () => {
    const h = await host("removed-roster-host"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "Removed Roster Series");
    const alice = service.join(series.joinCode, "Alice");
    void alice;
    const participantId = service.seriesState(owner, series.id).participants[0].id;

    service.removeFromSeries(owner, series.id, participantId);

    expect(service.seriesStandings(series.id)).toHaveLength(0);
    const roster = service.seriesState(owner, series.id).participants;
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ displayName: "Alice", removed: true });
  });
});
