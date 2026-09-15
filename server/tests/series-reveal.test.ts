import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { TriviaService } from "../src/service.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const q = (id: string, correct: string) => ({ id, question: "Q?", correctAnswer: correct, incorrectAnswers: ["1", "2", "3"], category: null, tags: [] });
const set = (id: string, qid: string, correct: string): QuestionSet => ({ format: "fftrivia-question-set", schemaVersion: 2, id, title: "Set", description: "", author: "Test", version: "1", categories: [], tags: [], questions: [q(qid, correct)] });

let service: TriviaService;
beforeEach(() => { service = new TriviaService(openDatabase(":memory:"), { databasePath: ":memory:", serverAccessPassword: "server-secret", tokenSecret: "token-secret", registrationEnabled: true, publicBaseUrl: "http://test" }); });
async function host(name: string) { return service.register(name, "a sufficiently strong password"); }
function answerAs(gameId: string, qid: string, playerToken: string, correctText: string, pickCorrect: boolean) {
  const question = service.playerReconnect(playerToken).game.question as any;
  const choice = question.choices.find((c: any) => (c.text === correctText) === pickCorrect);
  service.answer(playerToken, qid, choice.id);
}

// Regression coverage for the "Answer Reveal shows Series standings instead of current-game standings" bug.
// The bug itself lived in the player web page (server/public/app.js resultSection(), fixed to always render
// result.leaderboard instead of conditionally substituting result.seriesStandings) — the server-side payload was
// already correct. These tests pin the server contract the fix depends on: BOTH fields must be present and,
// from a Series' second game onward, must legitimately DIVERGE, proving a client can never treat one as a stand-in
// for the other.
describe("Series Answer Reveal — server payload carries distinct current-game and series standings", () => {
  it("Game 1 of a Series: game-scoped leaderboard and series standings coincide (only one game played so far)", async () => {
    const h = await host("reveal-host-1"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "Reveal Series");
    const qid1 = "10000000-1000-4000-8000-000000000001";
    const game1 = service.startNextGameInSeries(owner, series.id, { venueName: "Venue", gameName: "Game 1", questionSet: set("20000000-1000-4000-8000-000000000001", qid1, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });
    const alice = service.join(series.joinCode, "Alice");
    service.preview(owner, game1.id); service.open(owner, game1.id);
    answerAs(game1.id, qid1, alice.reconnectToken, "Right", true);
    service.close(owner, game1.id);

    const aliceReveal = (service.playerReconnect(alice.reconnectToken).game as any).result;
    expect(aliceReveal.leaderboard.find((e: any) => e.displayName === "Alice").score).toBe(100);
    expect(aliceReveal.seriesStandings.find((e: any) => e.displayName === "Alice").score).toBe(100);
  });

  it("Game 2 of a Series: game-scoped leaderboard reflects ONLY Game 2, while series standings correctly include Game 1 too — the two MUST diverge", async () => {
    const h = await host("reveal-host-2"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "Reveal Series");
    const qid1 = "30000000-1000-4000-8000-000000000001";
    const game1 = service.startNextGameInSeries(owner, series.id, { venueName: "Venue", gameName: "Game 1", questionSet: set("40000000-1000-4000-8000-000000000001", qid1, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });
    const alice = service.join(series.joinCode, "Alice");
    service.preview(owner, game1.id); service.open(owner, game1.id);
    answerAs(game1.id, qid1, alice.reconnectToken, "Right", true);
    service.close(owner, game1.id);
    service.end(owner, game1.id);

    const qid2 = "30000000-1000-4000-8000-000000000002";
    const game2 = service.startNextGameInSeries(owner, series.id, { venueName: "Venue", gameName: "Game 2", questionSet: set("40000000-1000-4000-8000-000000000002", qid2, "Right2"), orderingMode: "inOrder", scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });
    service.preview(owner, game2.id); service.open(owner, game2.id);
    answerAs(game2.id, qid2, alice.reconnectToken, "Right2", true);
    service.close(owner, game2.id);

    const aliceReveal = (service.playerReconnect(alice.reconnectToken).game as any).result;
    // This is the exact bug scenario: at Game 2's per-question reveal, the game-scoped leaderboard must show
    // Game 2's score alone (100), NOT the series cumulative (200). A client that substitutes seriesStandings
    // for leaderboard here would incorrectly display 200 as "current game" standings.
    expect(aliceReveal.leaderboard.find((e: any) => e.displayName === "Alice").score).toBe(100);
    expect(aliceReveal.seriesStandings.find((e: any) => e.displayName === "Alice").score).toBe(200);
    expect(aliceReveal.leaderboard.find((e: any) => e.displayName === "Alice").score).not.toBe(aliceReveal.seriesStandings.find((e: any) => e.displayName === "Alice").score);
  });

  it("a standalone (non-Series) game's reveal has no seriesStandings field to be confused with", async () => {
    const h = await host("reveal-host-3"), owner = service.authenticate(h.accessToken);
    const qid = "50000000-1000-4000-8000-000000000001";
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Solo Game", questionSet: set("60000000-1000-4000-8000-000000000001", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });
    const alice = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    answerAs(game.id, qid, alice.reconnectToken, "Right", true);
    service.close(owner, game.id);
    const aliceReveal = (service.playerReconnect(alice.reconnectToken).game as any).result;
    expect(aliceReveal.seriesStandings).toBeNull();
    expect(aliceReveal.leaderboard.find((e: any) => e.displayName === "Alice").score).toBe(100);
  });
});
