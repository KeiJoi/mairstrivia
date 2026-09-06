import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { TriviaService, ServiceError } from "../src/service.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const q = (id: string, text: string, correct: string) => ({ id, question: text, correctAnswer: correct, incorrectAnswers: ["1", "2", "3"], category: null, tags: [] });
const setWith = (id: string, title: string, questions: ReturnType<typeof q>[]): QuestionSet => ({ format: "fftrivia-question-set", schemaVersion: 2, id, title, description: "", author: "Test", version: "1", categories: [], tags: [], questions });

let service: TriviaService;
beforeEach(() => { service = new TriviaService(openDatabase(":memory:"), { databasePath: ":memory:", serverAccessPassword: "server-secret", tokenSecret: "token-secret", registrationEnabled: true, publicBaseUrl: "http://test" }); });
async function host(name: string) { return service.register(name, "a sufficiently strong password"); }

describe("question occurrence identity", () => {
  it("does not let two attached sets that reuse a question UUID collide in layouts, answers, or scoring", async () => {
    const shared = "44444444-4444-4444-8444-444444444444";
    const setA = setWith("55555555-5555-4555-8555-555555555555", "Set A", [q(shared, "Shared?", "A-correct"), q("66666666-6666-4666-8666-666666666666", "Other A", "X")]);
    const setB = setWith("77777777-7777-4777-8777-777777777777", "Set B", [q(shared, "Shared?", "B-correct")]);
    const h = await host("occurrence-host"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: setA, orderingMode: "inOrder", scoring: { correctPoints: 10, firstCorrectBonus: 0 } });
    const player = service.join(game.joinCode, "Alice");

    service.preview(owner, game.id); service.open(owner, game.id);
    const openedA = service.playerReconnect(player.reconnectToken).game.question as any;
    const correctA = openedA.choices.find((c: any) => c.text === "A-correct");
    service.answer(player.reconnectToken, shared, correctA.id);
    service.close(owner, game.id);
    expect(service.hostState(owner, game.id).players[0].score).toBe(10);

    const added = service.addSet(owner, game.id, setB, "inOrder");
    service.selectSet(owner, game.id, added.gameSetId);
    const previewB = service.preview(owner, game.id);
    expect(previewB.id).toBe(shared); // same source question UUID as Set A's played question
    service.open(owner, game.id);
    const openedB = service.playerReconnect(player.reconnectToken).game.question as any;
    // A fresh layout was generated for Set B's occurrence — not the stale one reused from Set A's occurrence.
    expect(openedB.choices.some((c: any) => c.text === "B-correct")).toBe(true);
    const wrongB = openedB.choices.find((c: any) => c.text !== "B-correct");
    service.answer(player.reconnectToken, shared, wrongB.id); // answer incorrectly this time
    service.close(owner, game.id);

    // Set A's original occurrence score (10) was not re-settled or doubled by Set B's independent occurrence.
    expect(service.hostState(owner, game.id).players[0].score).toBe(10);
    const occurrences = openDatabaseOccurrenceCount(service);
    expect(occurrences).toBe(2); // one per (game_set, question) occurrence, never shared across sets
  });

  it("repeat creates a brand-new scored occurrence and leaves the original occurrence's history untouched", async () => {
    const qid = "88888888-8888-4888-8888-888888888888";
    const set = setWith("99999999-9999-4999-8999-999999999999", "Repeatable", [q(qid, "Repeat me?", "Right")]);
    const h = await host("repeat-host"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set, orderingMode: "inOrder", scoring: { correctPoints: 10, firstCorrectBonus: 5 } });
    const player = service.join(game.joinCode, "Alice");

    service.preview(owner, game.id); service.open(owner, game.id);
    const first = service.playerReconnect(player.reconnectToken).game.question as any;
    service.answer(player.reconnectToken, qid, first.choices.find((c: any) => c.text === "Right").id);
    const firstClose = service.close(owner, game.id);
    expect(firstClose.result.firstResponder).toMatchObject({ displayName: "Alice" });
    expect(service.hostState(owner, game.id).players[0].score).toBe(15);

    expect(() => service.repeatQuestion(owner, game.id, "not-a-real-question-id")).toThrow(ServiceError);
    const repeated = service.repeatQuestion(owner, game.id, qid);
    expect(repeated.id).toBe(qid);
    service.open(owner, game.id);
    const second = service.playerReconnect(player.reconnectToken).game.question as any;
    service.answer(player.reconnectToken, qid, second.choices.find((c: any) => c.text === "Right").id);
    const secondClose = service.close(owner, game.id);
    expect(secondClose.result.firstResponder).toMatchObject({ displayName: "Alice" }); // first-correct can be earned again on a repeat

    // Points were awarded a second time — repeats are additive, not a rewind of the original occurrence.
    expect(service.hostState(owner, game.id).players[0].score).toBe(30);
    expect(() => service.repeatQuestion(owner, game.id, qid)).not.toThrow(); // still repeatable; a second repeat is allowed
  });
});

/** Small helper reaching into the private db only for occurrence-count assertions this test needs. */
function openDatabaseOccurrenceCount(service: TriviaService): number {
  return ((service as any).db.prepare("SELECT COUNT(*) AS n FROM question_occurrences").get() as { n: number }).n;
}
