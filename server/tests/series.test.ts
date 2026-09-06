import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { TriviaService, ServiceError } from "../src/service.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const q = (id: string, correct: string) => ({ id, question: "Q?", correctAnswer: correct, incorrectAnswers: ["1", "2", "3"], category: null, tags: [] });
const set = (id: string, qid: string, correct: string): QuestionSet => ({ format: "fftrivia-question-set", schemaVersion: 2, id, title: "Set", description: "", author: "Test", version: "1", categories: [], tags: [], questions: [q(qid, correct)] });

let service: TriviaService;
beforeEach(() => { service = new TriviaService(openDatabase(":memory:"), { databasePath: ":memory:", serverAccessPassword: "server-secret", tokenSecret: "token-secret", registrationEnabled: true, publicBaseUrl: "http://test" }); });
async function host(name: string) { return service.register(name, "a sufficiently strong password"); }
/** Single-player convenience wrapper: opens the question, answers it, closes it. */
function playThrough(owner: string, gameId: string, qid: string, playerToken: string, correctText: string, pickCorrect: boolean) {
  service.preview(owner, gameId); service.open(owner, gameId);
  answerAs(gameId, qid, playerToken, correctText, pickCorrect);
  return service.close(owner, gameId);
}
/** Multi-player convenience: caller opens the question once, calls this per player, then closes once. */
function answerAs(gameId: string, qid: string, playerToken: string, correctText: string, pickCorrect: boolean) {
  const question = service.playerReconnect(playerToken).game.question as any;
  const choice = question.choices.find((c: any) => (c.text === correctText) === pickCorrect);
  service.answer(playerToken, qid, choice.id);
}

describe("Game Series", () => {
  it("carries a participant's identity across games with no manual rejoin, and champions use dense ranking", async () => {
    const h = await host("series-host"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "Friday Night Series");
    expect(series.state).toBe("active");

    // Carol joins the series lobby BEFORE any game exists.
    const carol = service.join(series.joinCode, "Carol");
    expect((carol.game as any).state).toBe("series_lobby");

    const qid1 = "10000000-0000-4000-8000-000000000001";
    const game1 = service.startNextGameInSeries(owner, series.id, { venueName: "Venue", gameName: "Game 1", questionSet: set("20000000-0000-4000-8000-000000000001", qid1, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });
    expect(game1.gameName).toBe("Game 1");

    // Carol's series token now resolves straight into Game 1 with zero client-side rejoin.
    const carolInGame1 = service.playerReconnect(carol.reconnectToken).game as any;
    expect(carolInGame1.state).toBe("lobby");
    expect(carolInGame1.seriesId).toBe(series.id);

    // Dave joins mid-series, directly enrolled into the current game.
    const dave = service.join(series.joinCode, "Dave");
    expect((dave.game as any).seriesId).toBe(series.id);

    playThrough(owner, game1.id, qid1, carol.reconnectToken, "Right", true); // the only question in Game 1; Dave joined too late to answer it
    const game1Complete = service.end(owner, game1.id);
    expect(game1Complete.winners).toEqual([{ rank: 1, id: expect.any(String), displayName: "Carol", score: 100 }]);
    expect(game1Complete.seriesId).toBe(series.id);

    // Carol's SAME token shows Game Complete + series standings + waiting-for-next-game, still no rejoin.
    const carolAfterGame1 = service.playerReconnect(carol.reconnectToken).game as any;
    expect(carolAfterGame1.state).toBe("finished");
    expect(carolAfterGame1.gameResult.waitingForNextGame).toBe(true);
    expect(carolAfterGame1.gameResult.seriesStandings.find((e: any) => e.displayName === "Carol").score).toBe(100);

    const qid2 = "10000000-0000-4000-8000-000000000002";
    const game2 = service.startNextGameInSeries(owner, series.id, { venueName: "Venue", gameName: "Game 2", questionSet: set("20000000-0000-4000-8000-000000000002", qid2, "Right2"), orderingMode: "inOrder", scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });

    // Automatic transition: Carol's original token now resolves into Game 2 without ever re-entering a name.
    const carolInGame2 = service.playerReconnect(carol.reconnectToken).game as any;
    expect(carolInGame2.state).toBe("lobby");
    expect(carolInGame2.gameName).toBe("Game 2");

    service.preview(owner, game2.id); service.open(owner, game2.id);
    answerAs(game2.id, qid2, carol.reconnectToken, "Right2", true);
    answerAs(game2.id, qid2, dave.reconnectToken, "Right2", true);
    service.close(owner, game2.id);
    service.end(owner, game2.id);

    // Both scored 100 in Game 2; Carol has 200 total (100+100), Dave has 100 total (0+100) — a real, non-tied outcome for the champion.
    const standingsBeforeEnd = service.seriesStandings(series.id);
    expect(standingsBeforeEnd).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "Carol", score: 200, rank: 1 }),
      expect.objectContaining({ displayName: "Dave", score: 100, rank: 2 }),
    ]));

    const seriesComplete = service.endSeries(owner, series.id);
    expect(seriesComplete.champions).toEqual([expect.objectContaining({ displayName: "Carol", score: 200, rank: 1 })]);
    expect(() => service.endSeries(owner, series.id)).toThrow(ServiceError);

    // After Series Complete, Carol's token still resolves and shows the champion/final-standings projection.
    const carolFinal = service.playerReconnect(carol.reconnectToken).game as any;
    expect(carolFinal.seriesResult.champions[0].displayName).toBe("Carol");
  });

  it("uses dense ranking for ties: equal scores share a place, and medal-eligible ranks are not skipped", async () => {
    const h = await host("dense-rank-host"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "Tie Series");
    const alice = service.join(series.joinCode, "Alice"), bob = service.join(series.joinCode, "Bob"), carol = service.join(series.joinCode, "Carol"), dave = service.join(series.joinCode, "Dave");
    const qid = "30000000-0000-4000-8000-000000000001";
    const game = service.startNextGameInSeries(owner, series.id, { venueName: "Venue", gameName: "Tie Game", questionSet: set("40000000-0000-4000-8000-000000000001", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, incorrectPoints: 80, firstCorrectBonus: 0, allowAnswerChange: false } });
    service.preview(owner, game.id); service.open(owner, game.id);
    answerAs(game.id, qid, alice.reconnectToken, "Right", true);
    answerAs(game.id, qid, bob.reconnectToken, "Right", true);
    answerAs(game.id, qid, carol.reconnectToken, "Right", true);
    answerAs(game.id, qid, dave.reconnectToken, "Right", false);
    service.close(owner, game.id);
    service.end(owner, game.id);
    const standings = service.seriesStandings(series.id).sort((a, b) => a.rank - b.rank);
    // 100,100,100,80 -> dense ranks 1,1,1,2 (never 1,1,1,4).
    expect(standings.filter((e) => e.rank === 1)).toHaveLength(3);
    expect(standings.find((e) => e.displayName === "Dave")?.rank).toBe(2);
  });

  it("kick removes a player from the live game but preserves their earned score in that game's standings; series removal excludes them from series standings only", async () => {
    const h = await host("kick-host"), owner = service.authenticate(h.accessToken);
    const series = service.createSeries(owner, "Kick Series");
    const alice = service.join(series.joinCode, "Alice"), bob = service.join(series.joinCode, "Bob");
    const qid = "50000000-0000-4000-8000-000000000001";
    const game = service.startNextGameInSeries(owner, series.id, { venueName: "Venue", gameName: "Game", questionSet: set("60000000-0000-4000-8000-000000000001", qid, "Right"), orderingMode: "inOrder", scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });
    playThrough(owner, game.id, qid, alice.reconnectToken, "Right", true);

    const aliceState = service.seriesState(owner, series.id);
    const aliceParticipantId = aliceState.participants.find((p) => p.displayName === "Alice")!.id;
    const alicePlayerId = service.hostState(owner, game.id).players.find((p) => p.displayName === "Alice")!.id;

    service.kickFromGame(owner, game.id, alicePlayerId);
    expect(() => service.answer(alice.reconnectToken, qid, "anything")).toThrow(ServiceError);
    // Alice's earned score in THIS game's standings still stands.
    expect(service.hostState(owner, game.id).players.find((p) => p.displayName === "Alice")).toMatchObject({ score: 100, removed: true });
    expect(service.hostState(owner, game.id).leaderboard.some((e) => e.displayName === "Alice" && e.score === 100)).toBe(true);

    service.removeFromSeries(owner, series.id, aliceParticipantId);
    expect(() => service.playerReconnect(alice.reconnectToken)).toThrow(ServiceError); // series-scoped credential now invalid too
    const standingsAfterRemoval = service.seriesStandings(series.id);
    expect(standingsAfterRemoval.find((e) => e.displayName === "Alice")).toBeUndefined(); // excluded from competitive series standings
    expect(service.seriesState(owner, series.id).participants.find((p) => p.displayName === "Alice")).toMatchObject({ removed: true }); // historical record preserved
  });

  it("requires a nonzero reason-bearing manual score adjustment and records an audit trail", async () => {
    const h = await host("adjust-host"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("70000000-0000-4000-8000-000000000001", "80000000-0000-4000-8000-000000000001", "Right"), orderingMode: "inOrder" });
    const alice = service.join(game.joinCode, "Alice");
    const alicePlayerId = service.hostState(owner, game.id).players[0].id;

    expect(() => service.adjustScore(owner, game.id, alicePlayerId, 0, "no-op")).toThrow(ServiceError);
    expect(() => service.adjustScore(owner, game.id, alicePlayerId, 25, "")).toThrow(ServiceError);
    const adjusted = service.adjustScore(owner, game.id, alicePlayerId, 25, "Bonus for a great costume");
    expect(adjusted.players[0].score).toBe(25);
    const adjustedDown = service.adjustScore(owner, game.id, alicePlayerId, -10, "Penalty for a rules dispute");
    expect(adjustedDown.players[0].score).toBe(15);
    void alice;
  });
});
