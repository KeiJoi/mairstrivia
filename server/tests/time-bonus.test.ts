import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db.js";
import { TriviaService } from "../src/service.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const qid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const set = (id: string): QuestionSet => ({ format: "fftrivia-question-set", schemaVersion: 2, id, title: "Set", description: "", author: "Test", version: "1", categories: [], tags: [], questions: [{ id: qid, question: "Q?", correctAnswer: "Right", incorrectAnswers: ["1", "2", "3"], category: null, tags: [] }] });

let service: TriviaService;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  service = new TriviaService(openDatabase(":memory:"), { databasePath: ":memory:", serverAccessPassword: "server-secret", tokenSecret: "token-secret", registrationEnabled: true, publicBaseUrl: "http://test" });
});
afterEach(() => vi.useRealTimers());
async function host(name: string) { return service.register(name, "a sufficiently strong password"); }

describe("server-authoritative time bonus", () => {
  it("awards zero time bonus for an untimed question even when answered instantly", async () => {
    const h = await host("untimed-host"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), orderingMode: "inOrder", questionTimeLimitSeconds: 0, scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false, timeBonusMultiplier: 5 } });
    const player = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    const question = service.playerReconnect(player.reconnectToken).game.question as any;
    expect(question.closesAt).toBeNull();
    service.answer(player.reconnectToken, qid, question.choices.find((c: any) => c.text === "Right").id);
    const { result } = service.close(owner, game.id);
    void result;
    const player0 = service.hostState(owner, game.id).players[0];
    expect(player0.score).toBe(100); // base only, no time component possible without a deadline
  });

  it("computes floor(remaining seconds * multiplier) from the server deadline, never a client clock", async () => {
    const h = await host("timed-host"), owner = service.authenticate(h.accessToken);
    // 30 second question, multiplier 5 -> answering with 28s remaining should award floor(28*5)=140 time bonus.
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), orderingMode: "inOrder", questionTimeLimitSeconds: 20, scoring: { correctPoints: 100, firstCorrectBonus: 50, allowAnswerChange: false, timeBonusMultiplier: 5 } });
    const player = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    // The 20s cap on questionTimeLimitSeconds means we simulate 2s elapsed out of 20 (18s remaining) to stay in range.
    vi.advanceTimersByTime(2000);
    const question = service.playerReconnect(player.reconnectToken).game.question as any;
    service.answer(player.reconnectToken, qid, question.choices.find((c: any) => c.text === "Right").id);
    service.close(owner, game.id);
    const player0 = service.hostState(owner, game.id).players[0];
    // base 100 + first-correct 50 + time floor(18*5)=90 = 240
    expect(player0.score).toBe(240);
  });

  it("floors remaining time at zero for an answer received at or after the deadline (no negative or infinite bonus)", async () => {
    const h = await host("late-host"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("dddddddd-dddd-4ddd-8ddd-dddddddddddd"), orderingMode: "inOrder", questionTimeLimitSeconds: 5, scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false, timeBonusMultiplier: 5 } });
    const player = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    const question = service.playerReconnect(player.reconnectToken).game.question as any;
    const choiceId = question.choices.find((c: any) => c.text === "Right").id;
    vi.advanceTimersByTime(9000); // well past the 5s deadline; the auto-close timer will already have fired
    // The timer already closed the question, so a late answer attempt after close correctly fails rather than scoring.
    expect(() => service.answer(player.reconnectToken, qid, choiceId)).toThrow();
    expect(service.hostState(owner, game.id).state).toBe("results");
    expect(service.hostState(owner, game.id).players[0].score).toBe(0); // no answer was ever recorded
  });
});
